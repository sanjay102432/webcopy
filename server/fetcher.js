import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import ipaddr from 'ipaddr.js';

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1';
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Webcopy/1.0';

export class FetchProblem extends Error {
  constructor(message, { code = 'FETCH_FAILED', status = 502, detail = '' } = {}) {
    super(message);
    this.name = 'FetchProblem';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function normalizeUrl(input) {
  let value = String(input || '').trim();
  if (!value) {
    throw new FetchProblem('Paste a website address first.', {
      code: 'EMPTY_URL',
      status: 400,
    });
  }
  if (value.length > 2048) {
    throw new FetchProblem('That address is too long to analyze.', {
      code: 'URL_TOO_LONG',
      status: 400,
    });
  }
  if (value.startsWith('//')) value = `https:${value}`;
  else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = `https://${value.replace(/^\/+/, '')}`;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new FetchProblem('That does not look like a valid website address.', {
      code: 'INVALID_URL',
      status: 400,
    });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new FetchProblem('Only public http:// and https:// pages can be read.', {
      code: 'UNSUPPORTED_PROTOCOL',
      status: 400,
    });
  }
  if (parsed.username || parsed.password) {
    throw new FetchProblem('URLs containing usernames or passwords are not supported.', {
      code: 'URL_CREDENTIALS',
      status: 400,
    });
  }
  parsed.hash = '';
  return parsed;
}

export function isPrivateAddress(address) {
  try {
    let addr = ipaddr.parse(address);
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
      addr = addr.toIPv4Address();
    }
    return addr.range() !== 'unicast';
  } catch {
    return true;
  }
}

function resolveHost(hostname) {
  const clean = hostname.replace(/^\[|\]$/g, '');
  return new Promise((resolve, reject) => {
    dns.lookup(clean, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return reject(error);
      resolve(addresses);
    });
  });
}

export async function assertPublicHost(hostname) {
  const clean = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!clean) {
    throw new FetchProblem('That address has no hostname.', { code: 'INVALID_URL', status: 400 });
  }
  if (
    !ALLOW_PRIVATE &&
    (clean === 'localhost' ||
      clean.endsWith('.localhost') ||
      clean.endsWith('.local') ||
      clean.endsWith('.internal') ||
      clean.endsWith('.home.arpa'))
  ) {
    throw new FetchProblem('Private and local addresses are off limits.', {
      code: 'PRIVATE_ADDRESS',
      status: 403,
    });
  }

  if (net.isIP(clean)) {
    if (!ALLOW_PRIVATE && isPrivateAddress(clean)) {
      throw new FetchProblem('Private and local addresses are off limits.', {
        code: 'PRIVATE_ADDRESS',
        status: 403,
      });
    }
    return;
  }

  let addresses;
  try {
    addresses = await resolveHost(clean);
  } catch {
    throw new FetchProblem('We could not resolve that domain. Check the address and try again.', {
      code: 'DNS_FAILED',
      status: 422,
    });
  }

  if (!addresses.length) {
    throw new FetchProblem('That domain has no public address.', {
      code: 'DNS_EMPTY',
      status: 422,
    });
  }
  if (!ALLOW_PRIVATE && addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new FetchProblem('That domain points at a private network, so it is off limits.', {
      code: 'PRIVATE_ADDRESS',
      status: 403,
    });
  }
}

const safeLookup = (hostname, options, callback) => {
  dns.lookup(
    hostname.replace(/^\[|\]$/g, ''),
    { all: true, verbatim: true },
    (error, addresses) => {
      if (error) return callback(error);
      const allowed = ALLOW_PRIVATE
        ? addresses
        : addresses.filter((entry) => !isPrivateAddress(entry.address));

      if (!allowed.length) {
        const blocked = new FetchProblem('Connection to a private network was blocked.', {
          code: 'PRIVATE_ADDRESS',
          status: 403,
        });
        blocked.code = 'PRIVATE_ADDRESS';
        return callback(blocked);
      }

      if (options?.all) return callback(null, allowed);
      const family = options?.family === 6 ? 6 : 4;
      const chosen = allowed.find((entry) => entry.family === family) || allowed[0];
      return callback(null, chosen.address, chosen.family);
    },
  );
};

const dispatcher = new Agent({
  connect: {
    lookup: safeLookup,
    timeout: 12_000,
  },
  headersTimeout: 20_000,
  bodyTimeout: 25_000,
  keepAliveTimeout: 4_000,
  connections: 8,
});

function decodeBody(buffer, contentType) {
  let charset = 'utf-8';
  const match = /charset\s*=\s*"?([^";]+)"?/i.exec(contentType || '');
  if (match) charset = match[1].trim().toLowerCase();
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}

async function readResponse(response, url, maxBytes) {
  const chunks = [];
  let total = 0;
  let truncated = false;

  if (response.body) {
    try {
      for await (const raw of response.body) {
        const chunk = Buffer.from(raw);
        total += chunk.length;
        if (total > maxBytes) {
          const remaining = Math.max(0, maxBytes - (total - chunk.length));
          if (remaining) chunks.push(chunk.subarray(0, remaining));
          truncated = true;
          response.body.destroy?.();
          break;
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (!truncated) throw error;
    }
  }

  const buffer = Buffer.concat(chunks);
  const contentType = response.headers.get('content-type') || '';

  return {
    url: url.toString(),
    status: response.status,
    ok: response.ok,
    contentType,
    text: decodeBody(buffer, contentType),
    bytes: buffer.length,
    downloadedBytes: total,
    truncated,
    headers: {
      server: response.headers.get('server') || '',
      poweredBy: response.headers.get('x-powered-by') || '',
      contentType,
    },
  };
}

function fetchProblemFromError(error, url) {
  if (error instanceof FetchProblem) return error;
  const cause = error?.cause?.code || error?.code || '';
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || cause === 'UND_ERR_CONNECT_TIMEOUT') {
    return new FetchProblem('That page took too long to answer. Try again in a moment.', {
      code: 'TIMEOUT',
      status: 504,
      detail: `${url.hostname} · ${cause || error.name}`,
    });
  }
  if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') {
    return new FetchProblem('We could not find that domain.', {
      code: 'DNS_FAILED',
      status: 422,
      detail: cause,
    });
  }
  if (cause === 'ECONNREFUSED') {
    return new FetchProblem('That site refused the connection.', {
      code: 'CONNECTION_REFUSED',
      status: 502,
      detail: cause,
    });
  }
  if (String(cause).startsWith('CERT_') || String(cause).includes('TLS')) {
    return new FetchProblem('That site has an invalid or unsupported security certificate.', {
      code: 'TLS_FAILED',
      status: 502,
      detail: cause,
    });
  }
  return new FetchProblem('We could not fetch that page. It may block automated readers.', {
    code: 'FETCH_FAILED',
    status: 502,
    detail: cause || error?.message || 'Unknown network error',
  });
}

/**
 * Fetch a public URL with a size ceiling, manual redirect validation and a
 * connect-time private-network guard.
 */
export async function safeFetch(inputUrl, options = {}) {
  const {
    maxBytes = 2_000_000,
    timeoutMs = 15_000,
    maxRedirects = 5,
    signal,
    accept = '*/*',
    headers: extraHeaders = {},
  } = options;

  let current = inputUrl instanceof URL ? new URL(inputUrl.toString()) : normalizeUrl(inputUrl);
  const started = Date.now();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Timeout')), timeoutMs);
    const signals = [controller.signal];
    if (signal) signals.push(signal);
    const combinedSignal = AbortSignal.any(signals);

    let response;
    try {
      response = await undiciFetch(current, {
        method: 'GET',
        redirect: 'manual',
        dispatcher,
        signal: combinedSignal,
        headers: {
          'user-agent': DEFAULT_UA,
          accept,
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          'cache-control': 'no-cache',
          ...extraHeaders,
        },
      });
    } catch (error) {
      throw fetchProblemFromError(error, current);
    } finally {
      clearTimeout(timeout);
    }

    if (REDIRECT_CODES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new FetchProblem('That page redirected without a destination.', {
          code: 'BAD_REDIRECT',
          status: 502,
        });
      }
      try {
        current = new URL(location, current);
      } catch {
        throw new FetchProblem('That page sent an invalid redirect.', {
          code: 'BAD_REDIRECT',
          status: 502,
        });
      }
      if (!['http:', 'https:'].includes(current.protocol)) {
        throw new FetchProblem('That page redirected outside of the web.', {
          code: 'BAD_REDIRECT',
          status: 502,
        });
      }
      await response.body?.cancel().catch(() => {});
      continue;
    }

    let result;
    try {
      result = await readResponse(response, current, maxBytes);
    } catch (error) {
      throw fetchProblemFromError(error, current);
    }
    result.elapsedMs = Date.now() - started;
    result.finalUrl = current.toString();
    return result;
  }

  throw new FetchProblem('That page redirected too many times.', {
    code: 'TOO_MANY_REDIRECTS',
    status: 502,
  });
}

export function describeFetchFailure(report) {
  if (!report) return '';
  if (report.truncated) return 'The response was larger than our read limit and was cut short.';
  return '';
}
