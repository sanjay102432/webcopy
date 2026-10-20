/**
 * crawl.js — follows the internal links a site publishes and reads those pages
 * with the same static pipeline, so the report shows how the whole site works
 * rather than a single document.
 *
 * The module is deliberately free of imports from analyzer.js: orchestration
 * lives there, and calls into crawl.js with dependency injection — visitPage()
 * is provided by analyzer.js, so there is no require cycle.
 */

import { collapse, hostnameFromUrl } from './analyzer-utils.js';
import { FetchProblem } from './fetcher.js';

/* ------------------------------------------------------------- boundaries */

const HARD_MAX_PAGES = 12;
const HARD_MAX_DEPTH = 3;
const FRONTIER_CAP = 600;
const CHILD_LINK_CAP = 40;
const CRAWL_WORKERS = 2;

/** File extensions that are assets, not pages — never worth crawling. */
const ASSET_URL_RE =
  /\.(?:pdf|png|jpe?g|gif|webp|avif|bmp|tiff?|svgz?|ico|css|js|mjs|cjs|json|jsonld|xml|rss|atom|txt|md|csv|woff2?|ttf|otf|eot|mp4|m4v|webm|mov|avi|mp3|wav|ogg|m4a|flac|zip|rar|7z|gz|tgz|dmg|exe|apk|xlsx?|docx?|pptx?|dxf|psd|ai|indd)(?:$|[?#])/i;

/** Routes that are gated or boilerplate — rarely a design surface. */
const LOW_VALUE_PATH_RE =
  /(?:^|\/)(?:login|log-in|sign-?in|sign-?up|register|password|account|cart|checkout|basket|admin|wp-admin|wp-login)(?:$|[/?#])/i;

/** Utility endpoints — real, but not design surfaces. */
const UTILITY_PATH_RE = /(?:^|\/)(?:sitemap|feed|rss|atom|robots)(?:$|[.?/])|\/(?:wp-json|oembed)/i;

/** Query parameters that identify the same page to a human. */
const TRACKING_PARAM_EXACT = new Set(['gclid', 'gclsrc', 'dclid', 'fbclid', 'mc_cid', 'mc_eid', 'msclkid', 'igshid', '_ga', 'si']);

const ROLE_HINTS = [
  ['Work', /\b(?:work|projects?|portfolio|cases?|reel|showcase|gallery)\b/i],
  ['About', /\b(?:about|team|founders?|story|mission|approach|studio|practice|people)\b/i],
  ['Contact', /\b(?:contact|connect|booking|start-a-project|hire)\b/i],
  ['Writing', /\b(?:blog|journal|news|insights?|articles?|writing|notes|press)\b/i],
  ['Service', /\b(?:services?|offerings?|expertise|capabilities|consult)/i],
  ['Pricing', /\b(?:pricing|plans?|rates?|packages?)\b/i],
  ['Store', /\b(?:shop|store|products?|collection|merch)\b/i],
  ['Careers', /\b(?:careers?|jobs?|join-us|hiring)\b/i],
  ['Legal', /\b(?:legal|privacy|terms|imprint|cookies)\b/i],
  ['Help', /\b(?:faq|help|support|docs?)\b/i],
];

/* ----------------------------------------------------------------- settings */

function clampInt(value, { min, max, fallback }) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return Math.min(max, Math.max(min, fallback));
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/**
 * Public crawl settings for one scan. Users can raise or lower them per
 * request; the server environment sets ceilings so no single scan can stampede.
 */
export function readCrawlOptions(source = {}, env = process.env) {
  const defaultPages = clampInt(env.MAX_CRAWL_PAGES, { min: 0, max: HARD_MAX_PAGES, fallback: 6 });
  const defaultDepth = clampInt(env.MAX_CRAWL_DEPTH, { min: 0, max: HARD_MAX_DEPTH, fallback: 1 });
  /*
   * On Vercel the whole API runs inside a serverless function with a hard
   * duration limit (see api/[[...route]].js), so keep the crawl comfortably
   * inside it unless the operator set their own budget via env.
   */
  const onVercel = Boolean(env.VERCEL);
  const defaultBudget = onVercel ? 45_000 : 90_000;
  const hardBudget = onVercel ? 55_000 : 240_000;
  return {
    pages: clampInt(source.pages, { min: 0, max: HARD_MAX_PAGES, fallback: defaultPages }),
    depth: clampInt(source.depth, { min: 0, max: HARD_MAX_DEPTH, fallback: defaultDepth }),
    budgetMs: clampInt(env.CRAWL_BUDGET_MS, { min: 5_000, max: hardBudget, fallback: defaultBudget }),
  };
}

/* -------------------------------------------------------------- URL logic */

/**
 * Normalize a candidate URL for dedupe + fetching: hash stripped, tracking
 * parameters dropped, `www.` folded to the apex host, trailing slash trimmed.
 */
export function normalizeCrawlUrl(raw, baseUrl, entryUrl) {
  const value = String(raw ?? '').trim();
  if (!value || value.startsWith('#')) return null;
  let url;
  try {
    url = new URL(value, baseUrl || entryUrl || undefined);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;

  url.hash = '';
  if (url.search) {
    for (const [key] of [...url.searchParams]) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAM_EXACT.has(lower)) url.searchParams.delete(key);
    }
    const search = url.searchParams.toString();
    url.search = search ? `?${search}` : '';
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const entry = entryUrl ? new URL(entryUrl) : null;
  const entryHost = entry ? entry.hostname.replace(/^www\./, '').toLowerCase() : '';
  const path = (url.pathname === '/' || !url.pathname.endsWith('/')
    ? url.pathname || '/'
    : url.pathname.replace(/\/+$/, '') || '/');

  url.pathname = path;

  return {
    url: url.toString(),
    key: `${host}${path === '/' ? '/' : path.toLowerCase()}${url.search.toLowerCase()}`,
    host,
    path,
    internal: entry ? host === entryHost || host.endsWith(`.${entryHost}`) : false,
  };
}

/** True when a normalized URL is worth reading as a page of this site. */
export function isCrawlableUrl(candidate, { internal, assetPattern = ASSET_URL_RE } = {}) {
  if (!candidate) return false;
  if (internal && candidate.internal === false) return false;
  if (/^(?:mailto|tel|javascript|data|blob):/i.test(candidate.url)) return false;

  let search = '';
  try {
    search = new URL(candidate.url).search || '';
  } catch {
    return false;
  }
  if (ASSET_URL_RE.test(`${candidate.path}${search}`)) return false;
  if (assetPattern !== ASSET_URL_RE && assetPattern.test(`${candidate.path}${search}`)) return false;
  if (LOW_VALUE_PATH_RE.test(candidate.path)) return false;
  if (UTILITY_PATH_RE.test(candidate.path)) return false;
  return true;
}

function pathnameOf(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

/**
 * Priority for "which linked pages should we read first": shallow,
 * human-labelled, conventionally-named routes win. Crawl order matters,
 * because the page cap is usually below the number of links a site has.
 */
export function scoreCrawlTarget(candidate) {
  let score = 0;
  const path = String(candidate.path || '/').toLowerCase();
  const text = String(candidate.text || '').toLowerCase();

  for (const [, hint] of ROLE_HINTS) {
    if (hint.test(path)) score += 6;
    else if (hint.test(text)) score += 3;
  }

  score -= candidate.path.split('/').filter(Boolean).length;
  if (candidate.text) score += 1;
  if (path.length <= 20) score += 1;
  if (path === '/') score -= 50; // the seed page is already read
  return score;
}

/* -------------------------------------------------------------- condensing */

const CONDENSE = {
  keyframes: 24,
  animationUses: 36,
  transitions: 36,
  easings: 10,
  libraries: 12,
  dataAttributes: 10,
  inlineEvents: 8,
  signals: 10,
  colors: 40,
  fonts: 10,
  fontFaces: 6,
  fontFiles: 8,
  fontSizes: 14,
  specimens: 8,
  radii: 10,
  shadows: 6,
  gradients: 6,
  customProperties: 28,
  breakpoints: 10,
  registered: 6,
  headings: 36,
  sections: 10,
  warnings: 5,
};

function slice(array, max) {
  return Array.isArray(array) ? array.slice(0, max) : [];
}

function inferPageRole(url, title = '') {
  const path = pathnameOf(url).toLowerCase();
  const haystack = `${path} ${String(title).toLowerCase()}`;
  for (const [role, hint] of ROLE_HINTS) {
    if (hint.test(path)) return role;
  }
  for (const [role, hint] of ROLE_HINTS) {
    if (hint.test(haystack)) return role;
  }
  return 'Page';
}

/**
 * One linked page becomes a compact report that carries exactly what the entry
 * report carries for motion + design, at reduced depth — the same animation
 * tables, tokens and structure, without the payload of a full read.
 */
export function condensePageReport(report, context = {}) {
  const s = report.summary || {};
  const m = report.motion || {};
  const design = report.design || {};
  const structure = report.structure || {};
  const stats = report.stats || {};

  return {
    url: report.finalUrl || report.requestedUrl,
    requestedUrl: report.requestedUrl,
    key: context.key || '',
    host: report.host,
    title: collapse(report.meta?.title || '', 180),
    description: collapse(report.meta?.description || '', 200),
    role: inferPageRole(report.finalUrl || report.requestedUrl, report.meta?.title),
    depth: context.depth ?? 1,
    via: context.via || '',
    viaText: collapse(context.viaText, 80),
    summary: {
      motionScore: s.motionScore,
      motionLabel: s.motionLabel,
      motionSignatures: s.motionSignatures,
      keyframes: s.keyframes,
      keyframeNames: s.keyframeNames,
      animationUses: s.animationUses,
      animatedSelectors: s.animatedSelectors,
      transitions: s.transitions,
      transitionedSelectors: s.transitionedSelectors,
      libraries: s.libraries,
      jsTriggers: s.jsTriggers,
      scrollSignals: s.scrollSignals,
      images: s.images,
      videos: s.videos,
      stylesheets: s.stylesheets,
      styleBlocks: s.styleBlocks,
      scripts: s.scripts,
      inlineScripts: s.inlineScripts,
      fonts: s.fonts,
      fontFamilies: s.fontFamilies,
      colors: s.colors,
      links: s.links,
      words: stats.words,
      readingMinutes: stats.readingMinutes,
    },
    motion: {
      keyframes: slice(m.keyframes, CONDENSE.keyframes),
      keyframesTotal: m.keyframesTotal,
      keyframeNames: m.keyframeNames,
      animationUses: slice(m.animationUses, CONDENSE.animationUses),
      animationUsesTotal: m.animationUsesTotal,
      animatedSelectors: m.animatedSelectors,
      transitions: slice(m.transitions, CONDENSE.transitions),
      transitionsTotal: m.transitionsTotal,
      transitionedSelectors: m.transitionedSelectors,
      easings: slice(m.easings, CONDENSE.easings),
      durationStats: m.durationStats,
      libraries: slice(m.libraries, CONDENSE.libraries).map((library) => ({
        name: library.name,
        key: library.key,
        category: library.category,
        count: library.count,
      })),
      signals: slice(m.signals, CONDENSE.signals),
      reducedMotion: m.reducedMotion,
      scroll: {
        animationTimelineUses: m.scroll?.animationTimelineUses,
        scrollTimelines: m.scroll?.scrollTimelines,
        smoothScrolling: m.scroll?.smoothScrolling,
        scrollSnap: m.scroll?.scrollSnap,
        stickyRules: m.scroll?.stickyRules,
        viewTransitions: m.scroll?.viewTransitions,
        signals: slice(m.scroll?.signals, CONDENSE.signals),
        total: m.scroll?.total,
        libraries: slice(m.scroll?.libraries, 6).map((library) => ({
          name: library.name,
          key: library.key,
          category: library.category,
        })),
      },
      special: m.special,
      dataAttributes: slice(m.dataAttributes, CONDENSE.dataAttributes),
      inlineEvents: slice(m.inlineEvents, CONDENSE.inlineEvents),
    },
    design: {
      colors: slice(design.colors, CONDENSE.colors),
      colorTotal: design.colorTotal,
      fonts: slice(design.fonts, CONDENSE.fonts),
      fontTotal: design.fontTotal,
      fontFaces: slice(design.fontFaces, CONDENSE.fontFaces),
      fontFiles: slice(design.fontFiles, CONDENSE.fontFiles),
      fontSizes: slice(design.fontSizes, CONDENSE.fontSizes),
      typography: {
        ...design.typography,
        specimens: slice(design.typography?.specimens, CONDENSE.specimens),
      },
      radii: slice(design.radii, CONDENSE.radii),
      shadows: slice(design.shadows, CONDENSE.shadows),
      gradients: slice(design.gradients, CONDENSE.gradients),
      customProperties: slice(design.customProperties, CONDENSE.customProperties),
      breakpoints: slice(design.breakpoints, CONDENSE.breakpoints),
      registeredProperties: slice(design.registeredProperties, CONDENSE.registered),
    },
    structure: {
      headings: slice(structure.headings, CONDENSE.headings),
      h1Count: structure.h1Count,
      wordCount: structure.wordCount,
      readingMinutes: structure.readingMinutes,
      landmarks: structure.landmarks,
      sections: slice(structure.sections, CONDENSE.sections),
    },
    tech: report.tech || [],
    stats: {
      pageStatus: stats.pageStatus,
      contentType: stats.pageContentType,
      htmlBytes: stats.htmlBytes,
      cssBytes: stats.cssBytes,
      jsBytes: stats.jsBytes,
      transferredBytes: stats.transferredBytes,
      resourcesRead: stats.resourcesRead,
      analyzedInMs: stats.analyzedInMs,
    },
    warnings: slice(report.warnings, CONDENSE.warnings),
  };
}

/* ------------------------------------------------------------- BFS crawler */

/**
 * Read the site breadth-first per level, only same-host pages. `visitPage(url,
 * { depth, signal })` is injected by analyzer.js and must return a report
 * shaped object (the outcome of the full analysis pipeline).
 */
export async function crawlLinkedPages({
  seedUrl,
  candidates,
  maxPages,
  maxDepth,
  budgetMs,
  startedAt,
  signal,
  visitPage,
  onVisit = () => {},
  warn = () => {},
}) {
  const seed = new URL(seedUrl);
  const seedHost = seed.hostname.replace(/^www\./, '').toLowerCase();
  const seedPath = seed.pathname === '/' ? '/' : seed.pathname.replace(/\/+$/, '');
  const seedKey = `${seedHost}${seedPath.toLowerCase()}${seed.search.toLowerCase()}`;

  const frontier = [];
  const seen = new Set([seedKey]);
  const pages = [];
  const failed = [];
  let discovered = 0;
  let claimed = 0;
  let excluded = 0;
  let stoppedByBudget = false;

  const enqueue = (candidate, depth, viaKey, viaText) => {
    if (seen.size > FRONTIER_CAP) {
      excluded += 1;
      return;
    }
    if (seen.has(candidate.key)) return;
    seen.add(candidate.key);
    discovered += 1;
    frontier.push({
      ...candidate,
      depth,
      via: viaKey,
      viaText: collapse(viaText, 80),
      score: scoreCrawlTarget(candidate),
    });
  };

  for (const link of Array.isArray(candidates) ? candidates.slice(0, 120) : []) {
    const candidate = normalizeCrawlUrl(link.url, seedUrl, seedUrl);
    if (!candidate || !isCrawlableUrl(candidate, { internal: true })) continue;
    enqueue(candidate, 1, seedKey, link.text);
  }

  const takeBest = () => {
    if (!frontier.length) return null;
    frontier.sort(
      (a, b) => b.score - a.score || a.depth - b.depth || a.path.localeCompare(b.path),
    );
    return frontier.shift();
  };

  const visitOne = async (next) => {
    try {
      const report = await visitPage(next.url, { depth: next.depth, signal });
      pages.push(
        condensePageReport(report, {
          depth: next.depth,
          via: next.via,
          viaText: next.viaText,
          key: next.key,
        }),
      );
      onVisit({ done: pages.length + failed.length, page: pages[pages.length - 1] });

      if (next.depth < maxDepth) {
        const links = report.assets?.links?.internal || [];
        let added = 0;
        for (const link of links) {
          if (added >= CHILD_LINK_CAP) break;
          const candidate = normalizeCrawlUrl(link.url, report.finalUrl || next.url, seedUrl);
          if (!candidate || candidate.key === next.key) continue;
          if (!isCrawlableUrl(candidate, { internal: true })) continue;
          enqueue(candidate, next.depth + 1, next.key, link.text);
          added += 1;
        }
      }
    } catch (error) {
      const reason =
        error instanceof FetchProblem
          ? `${error.code}: ${collapse(error.message, 140)}`
          : collapse(error?.message || 'The page could not be read.', 140);
      failed.push({ url: next.url, depth: next.depth, reason, label: 'failed', via: next.viaText || '' });
      onVisit({ done: pages.length + failed.length });
    }
  };

  const worker = async () => {
    for (;;) {
      if (
        claimed >= maxPages ||
        (Date.now() - startedAt > budgetMs && (stoppedByBudget = true) === true)
      ) {
        break;
      }
      const next = takeBest();
      if (!next) break;
      claimed += 1;
      await visitOne(next);
    }
  };

  await Promise.all(Array.from({ length: CRAWL_WORKERS }, () => worker()));

  const skipped = Math.max(0, discovered - claimed);
  if (skipped > 0) {
    warn(
      `The crawl stopped with ${skipped} linked page${skipped === 1 ? '' : 's'} unread (${
        stoppedByBudget ? 'read budget reached' : 'page cap reached'
      }).`,
    );
  }

  return { pages, failed, discovered, skipped, stoppedByBudget, excluded, frontierLeft: frontier.length };
}

/* -------------------------------------------------------- site aggregation */

function labelOf(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : collapse(parsed.pathname.replace(/\/+$/, ''), 60);
    return `${parsed.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return collapse(String(url || ''), 60);
  }
}

function entryAsPage(entryReport, seedUrl) {
  return {
    url: entryReport.finalUrl || seedUrl,
    requestedUrl: entryReport.requestedUrl,
    host: entryReport.host,
    title: collapse(entryReport.meta?.title || '', 180),
    role: 'Entry',
    depth: 0,
    summary: {
      ...entryReport.summary,
      words: entryReport.stats?.words,
      readingMinutes: entryReport.stats?.readingMinutes,
    },
    motion: entryReport.motion,
    design: entryReport.design,
    tech: entryReport.tech,
    stats: entryReport.stats || {},
  };
}

/**
 * Fold the entry read and every crawled page into one description of how the
 * site works: page inventory, the tokens that repeat across pages, the motion
 * system and a site blueprint. The entry page stays the main report; this maps
 * everything onto it.
 */
export function summarizeCrawl({ entryReport, crawl, seedUrl, options }) {
  const entryPage = entryAsPage(entryReport, seedUrl);
  const all = [entryPage, ...crawl.pages];
  const pageCount = all.length;

  const fontMap = new Map();
  const colorMap = new Map();
  const libraryMap = new Map();
  const keyframeNameCount = new Map();
  const techMap = new Map();

  for (const page of all) {
    for (const font of page.design?.fonts || []) {
      const key = String(font.family || '').toLowerCase();
      if (!key || key === 'unknown') continue;
      const existing = fontMap.get(key) || { family: font.family, pages: 0, count: 0 };
      existing.pages += 1;
      existing.count += font.count ?? 1;
      fontMap.set(key, existing);
    }
    for (const color of page.design?.colors || []) {
      const value = String(color.value || '');
      if (!/^(?:#|rgb)/i.test(value)) continue;
      const key = value.toLowerCase();
      const existing = colorMap.get(key) || { value: color.value, pages: 0, count: 0 };
      existing.pages += 1;
      existing.count += color.count ?? 1;
      colorMap.set(key, existing);
    }
    for (const library of page.motion?.libraries || []) {
      const key = String(library.name || '').toLowerCase();
      if (!key) continue;
      const existing = libraryMap.get(key) || {
        name: library.name,
        category: library.category,
        pages: 0,
        count: 0,
      };
      existing.pages += 1;
      existing.count += library.count ?? 1;
      libraryMap.set(key, existing);
    }
    for (const frame of page.motion?.keyframes || []) {
      const key = String(frame.name || '').toLowerCase();
      if (!key) continue;
      keyframeNameCount.set(key, (keyframeNameCount.get(key) || 0) + 1);
    }
    for (const tech of page.tech || []) {
      const key = String(tech.name || '').toLowerCase();
      if (!key) continue;
      const existing = techMap.get(key) || { name: tech.name, category: tech.category, pages: 0 };
      existing.pages += 1;
      techMap.set(key, existing);
    }
  }

  const scores = all.map((page) => Number(page.summary?.motionScore ?? 0));


  /* Nav labels: how often each human-facing link text appears on the seed.
     Card copy and long titles are not navigation — keep short labels only. */
  const navMap = new Map();
  for (const link of entryReport?.assets?.links?.internal || []) {
    const text = collapse(String(link.text || ''), 40).toLowerCase().trim();
    const words = text ? text.split(/\s+/).length : 0;
    if (!text || text.length > 28 || words > 4) continue;
    if (!/[\p{L}\p{N}]/u.test(text)) continue; // '#', '→', '…' are not navigation
    navMap.set(text, (navMap.get(text) || 0) + 1);
  }

  const payload = {
    enabled: true,
    seedUrl,
    options: { pages: options.pages, depth: options.depth },
    discovered: crawl.discovered,
    skipped: crawl.skipped,
    stoppedByBudget: crawl.stoppedByBudget,
    failed: crawl.failed.map((failure) => ({
      url: failure.url,
      depth: failure.depth,
      reason: failure.reason,
      label: labelOf(failure.url),
    })),
    pages: crawl.pages,
    totals: {
      pagesRead: pageCount,
      failed: crawl.failed.length,
      discovered: crawl.discovered,
      words: all.reduce((sum, page) => sum + Number(page.summary?.words || 0), 0),
      transferredBytes:
        Number(entryReport.stats?.transferredBytes || 0) +
        crawl.pages.reduce((sum, page) => sum + Number(page.stats?.transferredBytes || 0), 0),
      avgMotionScore: pageCount ? Math.round(scores.reduce((a, b) => a + b, 0) / pageCount) : 0,
      minMotionScore: scores.length ? Math.min(...scores) : 0,
      maxMotionScore: scores.length ? Math.max(...scores) : 0,
    },
    shared: {
      fonts: [...fontMap.values()].sort((a, b) => b.pages - a.pages || b.count - a.count).slice(0, 12),
      colors: [...colorMap.values()].sort((a, b) => b.pages - a.pages || b.count - a.count).slice(0, 24),
      libraries: [...libraryMap.values()].sort((a, b) => b.pages - a.pages || b.count - a.count).slice(0, 10),
      keyframes: [...keyframeNameCount.entries()]
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16)
        .map(([name, count]) => ({ name, pages: count })),
      tech: [...techMap.values()].sort((a, b) => b.pages - a.pages).slice(0, 12),
    },
    navLabels: [...navMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([label, count]) => ({ label, count })),
  };

  payload.blueprint = renderBlueprint({ entryReport, payload, seedUrl });
  return payload;
}

/**
 * The plain-language closing deliverable: how this website works, what its
 * design system is, how its pages differ — written from the numbers.
 */
export function renderBlueprint({ entryReport, payload, seedUrl }) {
  const { pages, failed, totals, shared, options } = payload;
  const lines = [];
  const host = entryReport.host || hostnameFromUrl(seedUrl);
  const timestamp = entryReport.fetchedAt || new Date().toISOString();

  lines.push(`Site blueprint — ${host}`);
  lines.push(
    `Read ${totals.pagesRead} pages (entry + ${Math.max(0, totals.pagesRead - 1)} linked) · depth ${options?.depth ?? 1} · ${timestamp}`,
  );
  lines.push('');

  lines.push('## Pages read');
  const entryPage = entryAsPage(entryReport, seedUrl);
  lines.push(
    `- ${labelOf(entryPage.url) || 'home'} — “${collapse(entryPage.title || '(no title)', 70)}” · entry page · ${
      entryPage.summary?.words ?? 0
    } words · motion ${entryPage.summary?.motionScore ?? 0}/100 (${entryPage.summary?.motionLabel ?? '—'})`,
  );
  for (const page of pages) {
    lines.push(
      `- ${labelOf(page.url)} — “${collapse(page.title || '(no title)', 70)}” · ${page.role.toLowerCase()} · ${
        page.summary?.words ?? 0
      } words · motion ${page.summary?.motionScore ?? 0}/100 (${page.summary?.motionLabel ?? '—'})`,
    );
    if (page.viaText) lines.push(`    found via “${page.viaText}” (depth ${page.depth})`);
  }
  for (const failure of failed) {
    lines.push(`- ${failure.label || labelOf(failure.url)} — failed to read (${collapse(failure.reason, 90)})`);
  }
  lines.push('');

  lines.push('## How the site works');
  const everywhere = shared.tech.filter((tech) => tech.pages === totals.pagesRead).map((tech) => tech.name);
  const somewhere = shared.tech
    .filter((tech) => tech.pages < totals.pagesRead)
    .map((tech) => `${tech.name} (${tech.pages}/${totals.pagesRead})`);
  if (totals.pagesRead > 1) {
    lines.push(
      `- Shape: ${totals.pagesRead} pages read, all sharing one host — ${
        shared.libraries.some((library) => library.pages === totals.pagesRead)
          ? 'the same motion stack repeats on every page'
          : 'the motion stack changes between pages'
      }.`,
    );
  } else {
    lines.push('- Shape: single page read; internal navigation is thin, or nothing qualified as crawlable.');
  }
  if (everywhere.length) lines.push(`- Tech present on every page read: ${everywhere.join(', ')}.`);
  if (somewhere.length) lines.push(`- Tech on some pages only: ${somewhere.join(', ')}.`);

  const stylesheets = entryReport.summary?.stylesheets ?? 0;
  const styleBlocks = entryReport.summary?.styleBlocks ?? 0;
  const scripts = entryReport.summary?.scripts ?? 0;
  lines.push(
    `- Styling: the entry page ships ${stylesheets} linked stylesheet${stylesheets === 1 ? '' : 's'} plus ${styleBlocks} inline style block${styleBlocks === 1 ? '' : 's'}; linked pages were read against the same limits.`,
  );
  lines.push(
    `- Behaviour: ${scripts} linked script${scripts === 1 ? '' : 's'} on the entry page; motion libraries across pages: ${
      shared.libraries.slice(0, 5).map((library) => `${library.name} (${library.pages}/${totals.pagesRead})`).join(', ') || 'none'
    }.`,
  );

  const navNotes = payload.navLabels.slice(0, 6);
  if (navNotes.length) {
    lines.push(
      `- Navigation from the entry page points at: ${navNotes.map((entry) => `“${entry.label}” ×${entry.count}`).join(', ')}.`,
    );
  }
  lines.push(
    `- Internal links found while crawling: ${totals.discovered}${payload.skipped ? ` (${payload.skipped} left unread)` : ''}; ${
      entryReport.summary?.links ?? 0
    } anchors on the entry page alone.`,
  );
  lines.push('');

  lines.push('## The design system, as read');
  if (shared.fonts.length) {
    lines.push(
      `- Type reused across pages: ${shared.fonts.slice(0, 6).map((font) => `${font.family} (${font.pages}/${totals.pagesRead})`).join(', ')}.`,
    );
  }
  if (shared.colors.length) {
    lines.push(
      `- Palette that repeats across pages: ${shared.colors.slice(0, 10).map((color) => color.value).join(', ')}${
        shared.colors.length > 10 ? ' …' : ''
      }.`,
    );
  }
  const breakpoints = entryReport.design?.breakpoints || [];
  if (breakpoints.length) {
    lines.push(`- Breakpoints: ${breakpoints.slice(0, 6).map((item) => item.value).join(', ')}.`);
  }
  if (entryReport.design?.radii?.length) {
    lines.push(`- Radii language: ${entryReport.design.radii.slice(0, 5).map((item) => item.value).join(', ')}.`);
  }
  lines.push('');

  lines.push('## Motion, site-wide');
  lines.push(
    `- Motion score: entry ${entryReport.summary?.motionScore ?? 0}/100, site average ${totals.avgMotionScore}, spread ${totals.minMotionScore}–${totals.maxMotionScore}.`,
  );
  if (shared.keyframes.length) {
    lines.push(
      `- Keyframes reused across pages: ${shared.keyframes.slice(0, 8).map((frame) => `${frame.name} ×${frame.pages}`).join(', ')}.`,
    );
  } else {
    lines.push('- No keyframe name repeats across pages — each page defines its own animation vocabulary.');
  }
  if (pages.length > 1) {
    const ranked = [...pages].sort((a, b) => (b.summary?.motionScore ?? 0) - (a.summary?.motionScore ?? 0));
    const loudest = ranked[0];
    const quietest = ranked[ranked.length - 1];
    lines.push(
      `- Quietest page: ${labelOf(quietest.url)} (${quietest.summary?.motionScore ?? 0}); loudest: ${labelOf(loudest.url)} (${loudest.summary?.motionScore ?? 0}).`,
    );
  }
  const guards = [entryReport.motion?.reducedMotion, ...pages.map((page) => page.motion?.reducedMotion)].filter(
    Boolean,
  );
  lines.push(`- prefers-reduced-motion guards on ${guards.filter((entry) => entry.present).length}/${guards.length} pages read.`);
  lines.push('');

  lines.push('## Read the fine print');
  lines.push('- Every page was read statically, the same way: fetched HTML, then its declared CSS and JS within per-scan caps.');
  lines.push('- Client-side routes, hash links and login walls were never followed; JS-rendered content is outside any static read.');
  lines.push('- Shared tokens are counted only over sources the crawl could actually read; the full JSON carries the per-page tables.');

  return lines.join('\n');
}
