import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSite } from './analyzer.js';
import { buildDemoReport } from './demo.js';
import { FetchProblem } from './fetcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const app = express();
const PORT = Number(process.env.PORT) || 4173;
const RATE_LIMIT = Math.max(1, Number(process.env.RATE_LIMIT_PER_10M) || 60);
const RATE_WINDOW_MS = 10 * 60 * 1000;
const rateHits = new Map();

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  );
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(
  compression({
    filter: (req, res) => {
      const type = String(res.getHeader('Content-Type') || '');
      if (type.includes('text/event-stream')) return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(express.json({ limit: '8kb' }));

function clientKey(req) {
  return req.socket.remoteAddress || 'unknown';
}

function rateStatus(req) {
  const key = clientKey(req);
  const now = Date.now();
  const active = (rateHits.get(key) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
  if (active.length >= RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - active[0])) / 1000));
    rateHits.set(key, active);
    return { allowed: false, retryAfter };
  }
  active.push(now);
  rateHits.set(key, active);
  return { allowed: true, remaining: RATE_LIMIT - active.length };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, stamps] of rateHits.entries()) {
    const active = stamps.filter((stamp) => now - stamp < RATE_WINDOW_MS);
    if (active.length) rateHits.set(key, active);
    else rateHits.delete(key);
  }
}, 5 * 60 * 1000).unref();

function publicError(error) {
  if (error instanceof FetchProblem) {
    return {
      message: error.message,
      code: error.code,
      detail: error.detail || '',
    };
  }
  return {
    message: 'Something went wrong while reading the page. Try another public URL.',
    code: 'INTERNAL_ERROR',
    detail: '',
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'webcopy', version: '1.1.0' });
});

app.get('/api/demo', (req, res) => {
  try {
    const report = buildDemoReport();
    res.json(report);
  } catch (error) {
    console.error('[webcopy] demo failed', error);
    res.status(500).json({ error: publicError(error) });
  }
});

async function handleJsonScan(req, res, next) {
  const limit = rateStatus(req);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({
      error: {
        message: `That is a lot of scanning. Try again in ${Math.ceil(limit.retryAfter / 60)} minute${limit.retryAfter > 60 ? 's' : ''}.`,
        code: 'RATE_LIMITED',
      },
    });
  }

  const demo = req.query.demo === '1' || req.body?.demo === true;
  const url = req.body?.url || req.query.url || '';
  const crawl = {
    pages: req.body?.pages ?? req.query.pages,
    depth: req.body?.depth ?? req.query.depth,
  };

  try {
    const report = demo ? buildDemoReport() : await analyzeSite(url, { crawl });
    return res.json(report);
  } catch (error) {
    return next(error);
  }
}

app.get('/api/analyze', handleJsonScan);
app.post('/api/analyze', handleJsonScan);

const DEMO_PROGRESS = [
  { key: 'fetch', label: 'Opening specimen file', percent: 12, detail: 'aurelia-studio.example' },
  { key: 'styles', label: 'Reading styles and design tokens', percent: 42, detail: '1 stylesheet' },
  { key: 'scripts', label: 'Tracing scripts and libraries', percent: 68, detail: '2 scripts' },
  { key: 'motion', label: 'Counting motion signatures', percent: 88, detail: 'demo readout' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.get('/api/analyze/stream', async (req, res) => {
  const demo = req.query.demo === '1';
  const limit = rateStatus(req);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 6000\n\n');

  let closed = false;
  let ended = false;
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);
  heartbeat.unref?.();

  const finish = () => {
    if (ended) return;
    ended = true;
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };

  const send = (payload) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      closed = true;
    }
  };

  res.on('close', () => {
    if (!res.writableEnded) {
      closed = true;
      controller.abort();
    }
    clearInterval(heartbeat);
  });

  if (!limit.allowed) {
    send({
      type: 'fail',
      error: {
        message: `That is a lot of scanning. Try again in ${Math.ceil(limit.retryAfter / 60)} minute${limit.retryAfter > 60 ? 's' : ''}.`,
        code: 'RATE_LIMITED',
      },
    });
    return finish();
  }

  try {
    if (demo) {
      for (const step of DEMO_PROGRESS) {
        if (closed) return finish();
        send({ type: 'progress', ...step });
        await sleep(170);
      }
      const report = buildDemoReport();
      send({ type: 'result', report });
      return finish();
    }

    const url = req.query.url || '';
    const report = await analyzeSite(url, {
      signal: controller.signal,
      onProgress: (progress) => send({ type: 'progress', ...progress }),
      crawl: { pages: req.query.pages, depth: req.query.depth },
    });
    send({ type: 'result', report });
    return finish();
  } catch (error) {
    if (!(error instanceof FetchProblem)) {
      console.error('[webcopy] scan failed', error);
    }
    send({ type: 'fail', error: publicError(error) });
    return finish();
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: { message: 'That API route does not exist.', code: 'NOT_FOUND' } });
});

app.use(express.static(publicDir, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(publicDir, '404.html'), (error) => {
    if (error) res.status(404).type('text').send('Not found');
  });
});

app.use((error, req, res, next) => {
  if (!(error instanceof FetchProblem)) console.error('[webcopy] request failed', error);
  if (res.headersSent) return next(error);
  const status = error instanceof FetchProblem ? error.status || 400 : 500;
  return res.status(status).json({ error: publicError(error) });
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = app.listen(PORT, () => {
    console.log(`\n  webcopy - motion forensics`);
    console.log(`  http://localhost:${PORT}\n`);
  });
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 65_000;
}

export { app };
