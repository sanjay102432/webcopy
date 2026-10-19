import postcss from 'postcss';
import safeParser from 'postcss-safe-parser';

export const GENERIC_FONTS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

export function collapse(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export function limitArray(array, max) {
  return array.length > max ? array.slice(0, max) : array;
}

export function uniqueBy(array, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of array) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function splitTopLevel(value, separators = ',') {
  const input = String(value ?? '');
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote && input[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && separators.includes(char)) {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

export function tokenizeTopLevel(value) {
  const input = String(value ?? '');
  const tokens = [];
  let depth = 0;
  let quote = null;
  let start = -1;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote && input[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      if (start < 0) start = index;
      continue;
    }
    if (char === '(' || char === '[') {
      if (start < 0) start = index;
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (/\s/.test(char) && depth === 0) {
      if (start >= 0) {
        tokens.push(input.slice(start, index).trim());
        start = -1;
      }
      continue;
    }
    if (start < 0) start = index;
  }
  if (start >= 0) tokens.push(input.slice(start).trim());
  return tokens.filter(Boolean);
}

export function stripQuotes(value) {
  const text = String(value ?? '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

export function toHttpUrl(value, base) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw || /^(?:data|blob|javascript|mailto|tel|about):/i.test(raw)) return null;
  try {
    const url = new URL(raw, base);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseCssRoot(css) {
  try {
    return postcss.parse(css, { from: undefined });
  } catch {
    try {
      return postcss.parse(css, { from: undefined, parser: safeParser });
    } catch {
      return null;
    }
  }
}

export function ancestorAtRule(node, predicate) {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'atrule' && predicate(parent.name.toLowerCase(), parent.params || '')) {
      return parent;
    }
    parent = parent.parent;
  }
  return null;
}

export function inAtRule(node, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return Boolean(ancestorAtRule(node, (name) => wanted.has(name) || [...wanted].some((item) => name.endsWith(item))));
}

export function mediaContext(node) {
  const contexts = [];
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'atrule') {
      const name = parent.name.toLowerCase();
      if (name === 'media' || name === 'supports' || name === 'container') {
        contexts.unshift(`@${name} ${collapse(parent.params, 160)}`);
      }
    }
    parent = parent.parent;
  }
  return contexts.join(' · ').slice(0, 220);
}

export function cleanSelector(selector) {
  return collapse(selector, 240);
}

export function basenameFromUrl(value, fallback = 'resource') {
  try {
    const url = new URL(value);
    const filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    return filename || url.hostname || fallback;
  } catch {
    return fallback;
  }
}

export function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function parseCssTime(value, customProps, depth = 0) {
  if (depth > 3 || value == null) return null;
  let current = String(value).trim().toLowerCase();
  if (!current) return null;

  const varMatch = /^var\(\s*(--[^,\s)]+)\s*(?:,\s*(.+))?\)$/.exec(current);
  if (varMatch) {
    const prop = customProps instanceof Map ? customProps.get(varMatch[1]) : null;
    const fallback = varMatch[2];
    if (prop?.value) return parseCssTime(prop.value, customProps, depth + 1);
    if (fallback) return parseCssTime(fallback, customProps, depth + 1);
    return null;
  }

  const match = /^(-?(?:\d+|\d*\.\d+))(ms|s)$/.exec(current);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2] === 's' ? Math.round(amount * 1000) : Math.round(amount);
}

export function formatSourceLabel(source) {
  if (!source) return 'unknown';
  return source.label || (source.url ? basenameFromUrl(source.url) : 'inline');
}

export function addCount(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

export function sortedCounts(map, limit = 20, min = 1) {
  return [...map.entries()]
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

export function prepareSource(source, index = 0) {
  return {
    ...source,
    label: source.label || basenameFromUrl(source.url, `resource-${index + 1}`),
    baseUrl: source.baseUrl || source.url || '',
    content: source.content || '',
    bytes: source.bytes ?? Buffer.byteLength(source.content || '', 'utf8'),
  };
}

export function mergeSignals(signalMap, key, label, category, count, sourceLabel) {
  if (!count) return;
  const existing = signalMap.get(key) || {
    key,
    label,
    category,
    count: 0,
    sources: [],
  };
  existing.count += count;
  if (sourceLabel && !existing.sources.includes(sourceLabel) && existing.sources.length < 5) {
    existing.sources.push(sourceLabel);
  }
  signalMap.set(key, existing);
}
