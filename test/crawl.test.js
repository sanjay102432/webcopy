import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCrawlOptions,
  normalizeCrawlUrl,
  isCrawlableUrl,
  scoreCrawlTarget,
  condensePageReport,
  crawlLinkedPages,
  summarizeCrawl,
  renderBlueprint,
} from '../server/crawl.js';
import { analyzeSources } from '../server/analyzer.js';
import { FetchProblem } from '../server/fetcher.js';

/* ------------------------------------------------------------------ options */

test('readCrawlOptions clamps pages and depth with sane defaults', () => {
  const options = readCrawlOptions({});
  assert.equal(options.pages, 6);
  assert.equal(options.depth, 1);
  assert.ok(options.budgetMs >= 5_000);
});

test('readCrawlOptions honours explicit values and hard caps', () => {
  assert.equal(readCrawlOptions({ pages: 0 }).pages, 0);
  assert.equal(readCrawlOptions({ pages: '10' }).pages, 10);
  assert.equal(readCrawlOptions({ pages: 500 }).pages, 12);
  assert.equal(readCrawlOptions({ pages: -3 }).pages, 0);
  assert.equal(readCrawlOptions({ depth: 9 }).depth, 3);
  assert.equal(readCrawlOptions({ pages: 'garbage' }).pages, 6);
});

test('readCrawlOptions reads environment ceilings', () => {
  const options = readCrawlOptions({}, { MAX_CRAWL_PAGES: '3', MAX_CRAWL_DEPTH: '2' });
  assert.equal(options.pages, 3);
  assert.equal(options.depth, 2);
});

test('readCrawlOptions shortens the budget on serverless runtimes', () => {
  const options = readCrawlOptions({}, { VERCEL: '1' });
  assert.ok(options.budgetMs <= 55_000, 'the crawl budget must stay inside a 60 s function limit');
  assert.ok(Number(options.budgetMs) > 0);

  // An explicit env budget is still honoured, but clamped to the function limit.
  const raised = readCrawlOptions({}, { VERCEL: '1', CRAWL_BUDGET_MS: '300000' });
  assert.equal(raised.budgetMs, 55_000);
});

/* --------------------------------------------------------------------- urls */

test('normalizeCrawlUrl strips the hash and trailing slash', () => {
  const candidate = normalizeCrawlUrl('https://example.com/work/#top', 'https://example.com/', 'https://example.com/');
  assert.equal(candidate.url, 'https://example.com/work');
  assert.equal(candidate.key, 'example.com/work');
  assert.equal(candidate.internal, true);
});

test('normalizeCrawlUrl drops tracking parameters and folds www', () => {
  const candidate = normalizeCrawlUrl(
    'https://www.example.com/studio?utm_source=.newsletter&id=7',
    'https://example.com/',
    'https://example.com/',
  );
  assert.equal(candidate.url, 'https://www.example.com/studio?id=7');
  assert.equal(candidate.key, 'example.com/studio?id=7');
});

test('normalizeCrawlUrl marks other hosts as external', () => {
  const candidate = normalizeCrawlUrl('https://cdn.other.org/lib', 'https://example.com/', 'https://example.com/');
  assert.equal(candidate.internal, false);
});

test('isCrawlableUrl rejects assets, external hosts and utility routes', () => {
  const entry = 'https://example.com/';
  assert.equal(isCrawlableUrl(normalizeCrawlUrl('/about', entry, entry), { internal: true }), true);
  assert.equal(isCrawlableUrl(normalizeCrawlUrl('/logo.svg', entry, entry), { internal: true }), false);
  assert.equal(isCrawlableUrl(normalizeCrawlUrl('/files/report.pdf', entry, entry), { internal: true }), false);
  assert.equal(isCrawlableUrl(normalizeCrawlUrl('/site.css', entry, entry), { internal: true }), false);
  assert.equal(isCrawlableUrl(normalizeCrawlUrl('/wp-json/wp/v2', entry, entry), { internal: true }), false);
  assert.equal(isCrawlableUrl(normalizeCrawlUrl('/feed/rss', entry, entry), { internal: true }), false);
  assert.equal(isCrawlableUrl(normalizeCrawlUrl('/login', entry, entry), { internal: true }), false);
  assert.equal(isCrawlableUrl(normalizeCrawlUrl('https://else.org/page', entry, entry), { internal: true }), false);
  assert.equal(isCrawlableUrl(null), false);
});

test('scoreCrawlTarget prefers labelled, conventional routes', () => {
  const entry = 'https://example.com/';
  const about = scoreCrawlTarget(normalizeCrawlUrl('/about', entry, entry));
  const work = scoreCrawlTarget(normalizeCrawlUrl('/work', entry, entry));
  const deep = scoreCrawlTarget({
    ...normalizeCrawlUrl('/a/b/c/d/e/thing', entry, entry),
    text: '',
  });
  assert.ok(work >= about);
  assert.ok(about > deep);
  const tagged = scoreCrawlTarget({ ...normalizeCrawlUrl('/studio', entry, entry), text: 'Our approach' });
  assert.ok(tagged > 0);
});

/* ----------------------------------------------------------------- condensing */

function tinyPageReport(url, html) {
  return analyzeSources({
    requestedUrl: url,
    finalUrl: url,
    html,
    cssSources: [],
    jsSources: [],
    warnings: [],
    responseHeaders: {},
    onProgress: () => {},
  });
}

const TINY_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Approach — Tiny Studio</title>
  <meta name="description" content="How we work.">
  <style>
    .t h2 { animation: settle 0.9s ease both; }
    .t a { transition: opacity 0.3s ease; }
    @keyframes settle { from { opacity: 0; } to { opacity: 1; } }
  </style>
</head>
<body>
  <main>
    <section class="t">
      <h2>Slow work, shipped weekly.</h2>
      <a href="/team">The team</a>
      <a href="/press">Press</a>
      <p>Three principles, one cadence, zero decks, four links.</p>
    </section>
  </main>
</body>
</html>`;

test('condensePageReport keeps motion + design tables and page identity', () => {
  const report = tinyPageReport('https://tiny.example/about', TINY_HTML.replace('/team', '/team'));
  const page = condensePageReport(report, { depth: 1, via: 'tiny.example/', viaText: 'Approach', key: 'tiny.example/about' });

  assert.equal(page.role, 'About');
  assert.equal(page.title, 'Approach — Tiny Studio');
  assert.equal(page.key, 'tiny.example/about');
  assert.equal(page.via, 'tiny.example/');
  assert.equal(page.summary.motionScore, report.summary.motionScore);
  assert.ok(Array.isArray(page.motion.keyframes));
  assert.ok(page.motion.keyframes.length >= 1);
  assert.ok(Array.isArray(page.motion.animationUses));
  assert.ok(Array.isArray(page.motion.transitions));
  assert.ok(Array.isArray(page.structure.headings));
  assert.equal(page.summary.words, report.stats.words);
  assert.equal(page.summary.libraries, report.summary.libraries);
  assert.ok(Array.isArray(page.warnings));
});

test('condensePageReport rolls a crawl-length stop-motion report through safely', () => {
  const report = tinyPageReport('https://tiny.example/still', '<!doctype html><html><head><title>Still</title></head><body><p>Still.</p></body></html>');
  const page = condensePageReport(report, { depth: 2 });
  assert.equal(page.role, 'Page');
  assert.equal(page.motion.keyframes.length, 0);
  assert.equal(page.depth, 2);
});

/* --------------------------------------------------------------------- BFS */

function fakeReport(url, childLinks = []) {
  const key = url.replace(/^https?:\/\//, '');
  return {
    requestedUrl: url,
    finalUrl: url,
    host: 'tiny.example',
    meta: { title: `Page ${key}` },
    summary: { motionScore: 30, motionLabel: 'Measured', keyframes: 1, transitions: 2, words: 120 },
    stats: { words: 120, readingMinutes: 1, transferredBytes: 800 },
    motion: {
      keyframes: [{ name: 'settle', frames: 2, properties: ['opacity'], source: 'inline', usedCount: 1 }],
      keyframesTotal: 1,
      keyframeNames: 1,
      animationUses: [],
      animationUsesTotal: 0,
      animatedSelectors: 0,
      transitions: [],
      transitionsTotal: 2,
      transitionedSelectors: 1,
      easings: [],
      libraries: [{ name: 'gsap', category: 'library', count: 2 }],
      signals: [],
      reducedMotion: { present: false, jsChecks: 0 },
      scroll: {},
      special: {},
      dataAttributes: [],
      inlineEvents: [],
    },
    design: {
      colors: [{ value: '#11120e', count: 6, type: 'hex' }],
      colorTotal: 1,
      fonts: [{ family: 'Space Grotesk', count: 3 }],
      fontTotal: 1,
      fontFaces: [],
      fontFiles: [],
      fontSizes: [],
      typography: {},
      radii: [],
      shadows: [],
      gradients: [],
      customProperties: [{ prop: '--ease', value: 'cubic-bezier(.16,1,.3,1)', count: 2 }],
      breakpoints: [],
      registeredProperties: [],
    },
    structure: { headings: [{ level: 2, text: 'Slow work' }], h1Count: 0, wordCount: 120, readingMinutes: 1, sections: [] },
    tech: [{ category: 'framework', name: 'Next.js', evidence: 'script' }],
    warnings: [],
    assets: { links: { internal: childLinks.map(([href, text]) => ({ url: `https://tiny.example${href}`, text })) } },
  };
}

test('crawlLinkedPages follows links in priority order up to the cap', async () => {
  const visited = [];
  const result = await crawlLinkedPages({
    seedUrl: 'https://tiny.example/',
    candidates: [
      { url: 'https://tiny.example/work', text: 'Work' },
      { url: 'https://tiny.example/about', text: 'About us' },
      { url: 'https://tiny.example/logo.svg', text: 'Logo' },
      { url: 'https://tiny.example/login', text: 'Log in' },
      { url: 'https://tiny.example/missing', text: 'Broken' },
      { url: 'https://other.example/no', text: 'Elsewhere' },
    ],
    maxPages: 2,
    maxDepth: 1,
    budgetMs: 10_000,
    startedAt: Date.now(),
    visitPage: async (url) => {
      visited.push(url);
      return fakeReport(url);
    },
  });

  assert.equal(result.pages.length, 2);
  assert.deepEqual(visited, ['https://tiny.example/about', 'https://tiny.example/work']);
  assert.equal(result.discovered, 3);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.failed.map((failure) => failure.url), []);
  assert.equal(result.pages[0].role, 'About');
  assert.equal(result.pages[0].viaText, 'About us');
});

test('crawlLinkedPages expands depth from each visited page', async () => {
  const result = await crawlLinkedPages({
    seedUrl: 'https://tiny.example/',
    candidates: [{ url: 'https://tiny.example/about', text: 'About' }],
    maxPages: 4,
    maxDepth: 2,
    budgetMs: 10_000,
    startedAt: Date.now(),
    visitPage: async (url) => {
      const child = url === 'https://tiny.example/about' ? [['/journal/january', 'Notes']] : [];
      return fakeReport(url, child);
    },
  });

  assert.equal(result.pages.length, 2);
  const child = result.pages.find((page) => page.depth === 2);
  assert.ok(child, 'a depth-2 page was read');
  assert.equal(child.via, 'tiny.example/about');
  assert.equal(child.viaText, 'Notes');
});

test('crawlLinkedPages records FetchProblem rejects as failures', async () => {
  const result = await crawlLinkedPages({
    seedUrl: 'https://tiny.example/',
    candidates: [{ url: 'https://tiny.example/gone', text: 'Gone' }],
    maxPages: 3,
    maxDepth: 1,
    budgetMs: 10_000,
    startedAt: Date.now(),
    visitPage: async () => {
      throw new FetchProblem('HTTP 404', { code: 'HTTP_STATUS', status: 404 });
    },
  });

  assert.equal(result.pages.length, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /HTTP 404/);
});

/* --------------------------------------------------------------- aggregation */

test('summarizeCrawl folds the entry page and linked pages into shared tokens', () => {
  const entryReport = fakeReport('https://tiny.example/');
  entryReport.summary.words = 500;
  entryReport.stats = { words: 500, transferredBytes: 5_000 };
  entryReport.assets = {
    links: {
      internal: [
        { url: 'https://tiny.example/about', text: 'About' },
        { url: 'https://tiny.example/work', text: 'Work' },
        { url: 'https://tiny.example/card', text: 'architecture kinetic house a home that moves' },
      ],
    },
  };

  const crawl = {
    pages: [
      condensePageReport(fakeReport('https://tiny.example/about'), { depth: 1, via: 'tiny.example/', viaText: 'About', key: 'tiny.example/about' }),
      condensePageReport(fakeReport('https://tiny.example/work'), { depth: 1, via: 'tiny.example/', viaText: 'Work', key: 'tiny.example/work' }),
    ],
    failed: [{ url: 'https://tiny.example/gone', depth: 1, reason: 'HTTP 404', label: 'gone' }],
    discovered: 5,
    skipped: 0,
    stoppedByBudget: false,
  };

  const payload = summarizeCrawl({
    entryReport,
    crawl,
    seedUrl: 'https://tiny.example/',
    options: { pages: 6, depth: 1 },
  });

  assert.equal(payload.enabled, true);
  assert.equal(payload.totals.pagesRead, 3);
  assert.equal(payload.totals.words, 120 * 2 + 500);
  assert.equal(payload.totals.avgMotionScore, 30);
  assert.ok(payload.shared.fonts.some((font) => font.family === 'Space Grotesk' && font.pages === 3));
  assert.ok(payload.shared.colors.some((color) => color.value === '#11120e' && color.pages === 3));
  assert.ok(payload.shared.libraries.some((library) => library.name === 'gsap' && library.pages === 3));
  assert.ok(payload.shared.keyframes.some((frame) => frame.name === 'settle' && frame.pages === 3));
  assert.ok(payload.navLabels.length === 2);
  assert.ok(payload.navLabels.some((entry) => entry.label === 'about'));
  assert.ok(!payload.navLabels.some((entry) => entry.label.includes('architecture')));
  assert.ok(payload.blueprint.includes('Site blueprint'));
  assert.ok(payload.blueprint.includes('Pages read'));
  assert.ok(payload.blueprint.includes('Space Grotesk'));
  assert.ok(payload.blueprint.includes('motion 30/100'));
  assert.ok(payload.blueprint.includes('prefers-reduced-motion guards'));
});

test('renderBlueprint describes a single-page read without crashing', () => {
  const entryReport = fakeReport('https://tiny.example/');
  entryReport.stats = { words: 500, transferredBytes: 5_000 };
  const payload = summarizeCrawl({
    entryReport,
    crawl: { pages: [], failed: [], discovered: 1, skipped: 0, stoppedByBudget: false },
    seedUrl: 'https://tiny.example/',
    options: { pages: 0, depth: 1 },
  });
  const text = renderBlueprint({ entryReport, payload, seedUrl: 'https://tiny.example/' });
  assert.ok(text.includes('single page read'));
  assert.ok(text.includes('motion 30/100'));
});
