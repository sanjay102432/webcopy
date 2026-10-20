import { load } from 'cheerio';
import { safeFetch, FetchProblem, normalizeUrl } from './fetcher.js';
import { analyzeDocument } from './html-analysis.js';
import { analyzeStyles } from './css-analysis.js';
import { analyzeScripts } from './js-analysis.js';
import { detectTech } from './tech.js';
import { buildAgentPrompt } from './prompt.js';
import { readCrawlOptions, crawlLinkedPages, summarizeCrawl } from './crawl.js';
import {
  basenameFromUrl,
  collapse,
  hostnameFromUrl,
  limitArray,
  toHttpUrl,
  uniqueBy,
} from './analyzer-utils.js';

const MAX_EXTERNAL_STYLES = 14;
const MAX_EXTERNAL_SCRIPTS = 14;
/* Crawl limits: linked pages are read tighter, and shared assets are cached. */
const CRAWL_MAX_STYLES = 6;
const CRAWL_MAX_SCRIPTS = 6;

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/**
 * Per-scan fetch cache. Sites load the same stylesheets and scripts on every
 * page; crawled pages re-read them from this in-memory cache instead of the
 * network. Keyed by URL; values are in-flight promises so concurrent crawls
 * dedupe too.
 */
function createResourceCache() {
  return { styles: new Map(), scripts: new Map() };
}

async function cachedFetch(cache, bucket, url, run) {
  if (!cache || !(bucket in cache)) return run();
  const map = cache[bucket];
  const key = url.toString();
  if (map.has(key)) return map.get(key);
  const promise = run().catch((error) => {
    map.delete(key);
    throw error;
  });
  map.set(key, promise);
  return promise;
}

const SCORE_LABELS = [
  [15, 'Still'],
  [30, 'Quiet'],
  [50, 'Measured'],
  [70, 'Expressive'],
  [85, 'Kinetic'],
  [101, 'Cinematic'],
];

const SCROLL_LIBRARY_KEYS = new Set([
  'aos',
  'scrollreveal',
  'locomotive',
  'lenis',
  'rellax',
  'simpleParallax',
  'scrollmagic',
  'fullpage',
  'wow',
  'sal',
]);

function scoreLabel(score) {
  for (const [ceiling, label] of SCORE_LABELS) {
    if (score < ceiling) return label;
  }
  return 'Cinematic';
}

function pushWarning(warnings, message) {
  const clean = collapse(message, 300);
  if (!clean || warnings.length >= 30) return;
  if (!warnings.includes(clean)) warnings.push(clean);
}

async function mapLimit(items, limit, iterator) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await iterator(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () => worker()),
  );
  return results;
}

function isHtmlErrorPage(response) {
  return (
    /text\/html|application\/xhtml/i.test(response.contentType || '') &&
    /^\s*(?:<!doctype\s+html|<html)/i.test(response.text || '')
  );
}

function makeProgress(onProgress) {
  return (key, label, percent, detail = '') => {
    try {
      onProgress({ key, label, percent, detail });
    } catch {
      // A disconnected client should not stop an in-flight analysis.
    }
  };
}

function extractImports(source) {
  if (!source.content || !source.content.includes('@import')) return [];
  const results = [];
  const regex = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?/gi;
  let match;
  while ((match = regex.exec(source.content))) {
    if (results.length >= 8) break;
    const resolved = toHttpUrl(match[2], source.url || source.baseUrl);
    if (resolved) results.push(resolved);
  }
  return results;
}

async function fetchStyles(doc, baseUrl, warnings, signal, options = {}) {
  const { cache = null, maxStyles = MAX_EXTERNAL_STYLES, maxImports = 6 } = options;
  const links = doc.styleLinks.slice(0, maxStyles);
  const skippedLinkCount = Math.max(0, doc.styleLinks.length - links.length);
  if (skippedLinkCount) {
    pushWarning(
      warnings,
      `${skippedLinkCount} extra stylesheet${skippedLinkCount === 1 ? '' : 's'} were skipped after the first ${maxStyles}.`,
    );
  }

  const external = await mapLimit(links, 4, async (link, index) => {
    const label = link.title || basenameFromUrl(link.url, `Stylesheet ${index + 1}`);
    const fetchOne = async () => {
      try {
        const response = await safeFetch(link.url, {
          maxBytes: 1_200_000,
          timeoutMs: 12_000,
          accept: 'text/css,*/*;q=0.1',
          signal,
        });

        if (!response.ok) {
          return {
            content: '',
            bytes: 0,
            status: `HTTP ${response.status}`,
            baseUrl: link.url,
            error: `HTTP ${response.status}`,
            warning: `A stylesheet answered with HTTP ${response.status}: ${label}.`,
          };
        }
        if (isHtmlErrorPage(response)) {
          return {
            content: '',
            bytes: 0,
            status: 'HTML response',
            baseUrl: link.url,
            error: 'HTML response',
            warning: `A stylesheet returned an HTML error page instead of CSS: ${label}.`,
          };
        }

        return {
          content: response.text,
          bytes: response.bytes,
          status: response.status,
          baseUrl: response.finalUrl || link.url,
          truncated: response.truncated,
          truncatedWarning: response.truncated
            ? `A stylesheet was cut at the 1.2 MB read limit: ${label}.`
            : '',
        };
      } catch (error) {
        const message = error instanceof FetchProblem ? error.message : 'Could not read stylesheet.';
        return {
          content: '',
          bytes: 0,
          status: 'failed',
          baseUrl: link.url,
          error: message,
          warning: `${message} (${label})`,
        };
      }
    };

    const payload = await cachedFetch(cache, 'styles', link.url, fetchOne);

    if (payload.warning) pushWarning(warnings, payload.warning);
    if (payload.truncatedWarning) pushWarning(warnings, payload.truncatedWarning);

    return {
      url: link.url,
      label,
      content: payload.content || '',
      bytes: payload.bytes || 0,
      status: payload.status,
      media: link.media,
      baseUrl: payload.baseUrl || link.url,
      error: payload.error,
      truncated: Boolean(payload.truncated),
    };
  });

  const importUrls = [];
  const seen = new Set(external.map((source) => source.url));
  for (const source of external) {
    if (!source.content) continue;
    if (!source.content.includes('@import')) continue;
    const urlSet = extractImports({ content: source.content, url: source.url, baseUrl: source.baseUrl });
    for (const url of urlSet) {
      if (seen.has(url) || importUrls.length >= maxImports) continue;
      seen.add(url);
      importUrls.push({ url, parent: source.label });
    }
  }

  const imported = await mapLimit(importUrls, 3, async ({ url, parent }) => {
    const label = basenameFromUrl(url, 'Imported stylesheet');
    const fetchImport = async () => {
      try {
        const response = await safeFetch(url, {
          maxBytes: 600_000,
          timeoutMs: 10_000,
          accept: 'text/css,*/*;q=0.1',
          signal,
        });
        if (!response.ok || isHtmlErrorPage(response)) {
          return {
            content: '',
            bytes: 0,
            status: response.ok ? 'HTML response' : `HTTP ${response.status}`,
            baseUrl: url,
            error: `HTTP ${response.status}`,
            warning: `An imported stylesheet could not be read: ${label}.`,
          };
        }
        return {
          content: response.text,
          bytes: response.bytes,
          status: response.status,
          baseUrl: response.finalUrl || url,
          truncated: response.truncated,
        };
      } catch (error) {
        const message = error instanceof FetchProblem ? error.message : 'Could not read import.';
        return {
          content: '',
          bytes: 0,
          status: 'failed',
          baseUrl: url,
          error: message,
          warning: `${message} (${label})`,
        };
      }
    };

    const payload = await cachedFetch(cache, 'styles', url, fetchImport);
    if (payload.warning) pushWarning(warnings, payload.warning);

    return {
      url,
      label,
      content: payload.content || '',
      bytes: payload.bytes || 0,
      status: payload.status,
      baseUrl: payload.baseUrl || url,
      truncated: Boolean(payload.truncated),
      imported: true,
      parent,
    };
  });

  const inline = doc.styleBlocks.map((block) => ({
    ...block,
    baseUrl,
    inline: true,
    status: 'inline',
  }));

  const sources = [...external, ...imported, ...inline];
  const externalSources = sources.filter((source) => source.url);
  const failed = externalSources.filter((source) => typeof source.status !== 'number');
  const fetched = externalSources.filter((source) => typeof source.status === 'number');

  return {
    sources,
    skipped: skippedLinkCount,
    stats: {
      external: externalSources.length,
      inline: inline.length,
      fetched: fetched.length,
      failed: failed.length,
      skipped: skippedLinkCount,
      imported: imported.length,
      bytes: sources.reduce((sum, source) => sum + (source.bytes || 0), 0),
      externalBytes: externalSources.reduce((sum, source) => sum + (source.bytes || 0), 0),
      cached: cache ? [...cache.styles.keys()].length : 0,
    },
  };
}

async function fetchScripts(doc, warnings, signal, options = {}) {
  const { cache = null, maxScripts = MAX_EXTERNAL_SCRIPTS } = options;
  const tags = doc.scripts.external.slice(0, maxScripts);
  const skippedTagCount = Math.max(0, doc.scripts.external.length - tags.length);
  if (skippedTagCount) {
    pushWarning(
      warnings,
      `${skippedTagCount} extra script${skippedTagCount === 1 ? '' : 's'} were skipped after the first ${maxScripts}.`,
    );
  }

  const external = await mapLimit(tags, 4, async (tag, index) => {
    const label = basenameFromUrl(tag.url, `Script ${index + 1}`);
    const fetchOne = async () => {
      try {
        const response = await safeFetch(tag.url, {
          maxBytes: 950_000,
          timeoutMs: 12_000,
          accept: 'text/javascript,application/javascript,*/*;q=0.1',
          signal,
        });

        if (!response.ok) {
          return {
            content: '',
            bytes: 0,
            status: `HTTP ${response.status}`,
            error: `HTTP ${response.status}`,
            warning: `A script answered with HTTP ${response.status}: ${label}.`,
          };
        }
        if (isHtmlErrorPage(response)) {
          return {
            content: '',
            bytes: 0,
            status: 'HTML response',
            error: 'HTML response',
            warning: `A script returned an HTML page instead of JavaScript: ${label}.`,
          };
        }

        return {
          content: response.text,
          bytes: response.bytes,
          status: response.status,
          truncated: response.truncated,
          truncatedWarning: response.truncated
            ? `A script was cut at the 950 KB read limit: ${label}.`
            : '',
        };
      } catch (error) {
        const message = error instanceof FetchProblem ? error.message : 'Could not read script.';
        return {
          content: '',
          bytes: 0,
          status: 'failed',
          error: message,
          warning: `${message} (${label})`,
        };
      }
    };

    const payload = await cachedFetch(cache, 'scripts', tag.url, fetchOne);

    if (payload.warning) pushWarning(warnings, payload.warning);
    if (payload.truncatedWarning) pushWarning(warnings, payload.truncatedWarning);

    return {
      url: tag.url,
      label,
      content: payload.content || '',
      bytes: payload.bytes || 0,
      status: payload.status,
      inline: false,
      module: tag.module,
      async: tag.async,
      defer: tag.defer,
      error: payload.error,
      truncated: Boolean(payload.truncated),
    };
  });

  const inline = doc.scripts.inline.map((script) => ({
    ...script,
    url: null,
    inline: true,
    status: 'inline',
  }));

  const sources = [...external, ...inline];
  const externalSources = sources.filter((source) => source.url);
  const failed = externalSources.filter((source) => typeof source.status !== 'number');
  const fetched = externalSources.filter((source) => typeof source.status === 'number');

  return {
    sources,
    skipped: skippedTagCount,
    stats: {
      external: externalSources.length,
      inline: inline.length,
      fetched: fetched.length,
      failed: failed.length,
      skipped: skippedTagCount,
      bytes: sources.reduce((sum, source) => sum + (source.bytes || 0), 0),
      externalBytes: externalSources.reduce((sum, source) => sum + (source.bytes || 0), 0),
    },
  };
}

function mergeFonts(styleFonts, googleFamilies) {
  const fonts = new Map();
  for (const font of styleFonts) {
    fonts.set(font.family.toLowerCase(), {
      ...font,
      evidence: [...(font.evidence || [])],
    });
  }
  for (const family of googleFamilies) {
    const key = family.toLowerCase();
    const existing = fonts.get(key);
    if (existing) {
      if (!existing.evidence.includes('Google Fonts')) existing.evidence.push('Google Fonts');
      existing.count += 1;
    } else {
      fonts.set(key, {
        family,
        count: 1,
        evidence: ['Google Fonts'],
      });
    }
  }
  return [...fonts.values()].sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

function mergeFontAssets(styleFontAssets, preloads) {
  const map = new Map();
  for (const asset of styleFontAssets) {
    map.set(asset.url, { ...asset });
  }
  for (const preload of preloads) {
    if (map.has(preload.url)) continue;
    map.set(preload.url, {
      url: preload.url,
      family: '',
      weight: '',
      style: '',
      format: (preload.url.split('.').pop() || '').split(/[?#]/)[0],
      source: 'preload',
      crossorigin: preload.crossorigin,
      count: 1,
    });
  }
  return [...map.values()].slice(0, 100);
}

/**
 * Group typographic rules into reusable specimens: one row per distinct
 * family/size/weight/line-height/spacing signature, with representative
 * selectors — the shape an agent needs to rebuild the type system.
 */
function buildTypeSpecimens(rules, limit = 16) {
  const groups = new Map();
  for (const rule of rules || []) {
    if (!rule.size && !rule.family) continue;
    const signature = [rule.family, rule.size, rule.weight, rule.lineHeight, rule.letterSpacing, rule.transform]
      .map((value) => String(value || '').toLowerCase())
      .join('|');
    let group = groups.get(signature);
    if (!group) {
      group = {
        family: rule.family || '',
        size: rule.size || '',
        weight: rule.weight || '',
        lineHeight: rule.lineHeight || '',
        letterSpacing: rule.letterSpacing || '',
        transform: rule.transform || '',
        count: 0,
        selectors: [],
      };
      groups.set(signature, group);
    }
    group.count += 1;
    if (group.selectors.length < 3 && !group.selectors.includes(rule.selector)) {
      group.selectors.push(collapse(rule.selector, 90));
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || String(a.size).localeCompare(String(b.size)))
    .slice(0, limit);
}

function buildScrollSignals(styles, js, libraries, motionMarkup) {
  const signals = [];
  const scroll = styles.scroll;

  if (scroll.animationTimelineUses) {
    signals.push({
      kind: 'CSS',
      label: 'animation-timeline uses',
      count: scroll.animationTimelineUses,
    });
  }
  if (scroll.scrollTimelines) {
    signals.push({ kind: 'CSS', label: 'Scroll / view timelines', count: scroll.scrollTimelines });
  }
  if (scroll.smoothScrolling) {
    signals.push({ kind: 'CSS', label: 'Smooth-scroll rules', count: scroll.smoothScrolling });
  }
  if (scroll.scrollSnap) {
    signals.push({ kind: 'CSS', label: 'Scroll-snap rules', count: scroll.scrollSnap });
  }
  if (scroll.viewTransitions) {
    signals.push({ kind: 'CSS', label: 'View-transition names', count: scroll.viewTransitions });
  }
  if (js.scrollTriggerCount) {
    signals.push({ kind: 'JS', label: 'ScrollTrigger references', count: js.scrollTriggerCount });
  }
  if (js.scrollListenerCount) {
    signals.push({ kind: 'JS', label: 'Scroll / wheel listeners', count: js.scrollListenerCount });
  }
  if (js.scrollTimelineCount) {
    signals.push({
      kind: 'JS',
      label: 'ScrollTimeline / ViewTimeline',
      count: js.scrollTimelineCount,
    });
  }

  const scrollDataAttributes = motionMarkup.dataAttributes
    .filter((entry) =>
      /^data-(?:scroll|parallax|aos|sal|scrolly|speed|lag|reveal)/.test(entry.name),
    )
    .reduce((sum, entry) => sum + entry.count, 0);
  if (scrollDataAttributes) {
    signals.push({ kind: 'Markup', label: 'Scroll-reveal data attributes', count: scrollDataAttributes });
  }

  const scrollLibraries = libraries.filter((library) => SCROLL_LIBRARY_KEYS.has(library.key));
  for (const library of scrollLibraries) {
    signals.push({ kind: 'Library', label: library.name, count: 1 });
  }

  const total =
    scroll.animationTimelineUses +
    scroll.scrollTimelines +
    scroll.smoothScrolling +
    scroll.scrollSnap +
    scroll.viewTransitions +
    js.scrollTriggerCount +
    js.scrollListenerCount +
    js.scrollTimelineCount +
    scrollDataAttributes +
    scrollLibraries.length;

  return { signals, total, libraries: scrollLibraries };
}

function computeMotionScore(summary) {
  const parts = [
    {
      label: 'Keyframes',
      value: Math.min(summary.keyframes * 3, 20),
      max: 20,
      note: `${summary.keyframes} keyframe definitions`,
    },
    {
      label: 'Animation assignments',
      value: Math.min(summary.animatedSelectors * 2.5, 18),
      max: 18,
      note: `${summary.animatedSelectors} animated selectors`,
    },
    {
      label: 'Transitions',
      value: Math.min(summary.transitions * 0.6, 14),
      max: 14,
      note: `${summary.transitions} transition uses`,
    },
    {
      label: 'Motion libraries',
      value: Math.min(summary.libraries * 6, 18),
      max: 18,
      note: `${summary.libraries} libraries detected`,
    },
    {
      label: 'JS triggers',
      value: Math.min(summary.jsTriggers * 0.8, 18),
      max: 18,
      note: `${summary.jsTriggers} runtime signals`,
    },
    {
      label: 'Scroll systems',
      value: Math.min(summary.scrollSignals * 2, 12),
      max: 12,
      note: `${summary.scrollSignals} scroll signals`,
    },
  ].map((part) => ({ ...part, value: Math.round(part.value * 10) / 10 }));

  const score = Math.min(100, Math.round(parts.reduce((sum, part) => sum + part.value, 0)));
  return {
    score,
    label: scoreLabel(score),
    parts,
    method:
      'A composite of declared keyframes, animated selectors, transition uses, motion libraries, runtime triggers and scroll systems. It measures motion density in the source, not visual quality, performance or accessibility.',
  };
}

/**
 * Analyze an already-fetched page and its stylesheet/script sources.
 * Kept separate from network orchestration so the demo fixture and tests can
 * exercise the exact same code path.
 */
export function analyzeSources({
  requestedUrl,
  finalUrl,
  html,
  cssSources = [],
  jsSources = [],
  warnings: initialWarnings = [],
  responseHeaders = {},
  pageInfo = {},
  fetchMeta = {},
  fetchedAt = new Date().toISOString(),
  onProgress = () => {},
  demo = false,
  preloadedDocument = null,
  deferFinish = false,
}) {
  const started = Date.now();
  const emit = makeProgress(onProgress);
  const warnings = [...initialWarnings];
  const hasPreloadedDocument = Boolean(preloadedDocument?.doc);

  if (!hasPreloadedDocument) {
    emit('parse', 'Reading the document', 24, hostnameFromUrl(finalUrl));
  }

  let $ = preloadedDocument?.$ || null;
  if (!$) {
    try {
      $ = load(html, { xmlMode: false });
    } catch {
      throw new FetchProblem('That page could not be parsed as HTML.', {
        code: 'HTML_PARSE_FAILED',
        status: 422,
      });
    }
  }

  let baseUrl = preloadedDocument?.baseUrl || finalUrl;
  if (!preloadedDocument?.baseUrl) {
    const baseHref = $('base[href]').first().attr('href');
    if (baseHref) {
      try {
        const candidate = new URL(baseHref, finalUrl);
        if (['http:', 'https:'].includes(candidate.protocol)) baseUrl = candidate.toString();
      } catch {
        // Keep the final page URL as the base.
      }
    }
  }

  const doc = preloadedDocument?.doc || analyzeDocument({ $, html, baseUrl, finalUrl });

  // Inline <style> and <script> blocks belong to the document, not to the
  // external fetch pass. Merge them in when the caller has not already done
  // so (analyzeSite includes them via fetchStyles/fetchScripts).
  const pageBase = baseUrl;
  const styleSources = [
    ...cssSources,
    ...doc.styleBlocks
      .filter(
        (block) =>
          !cssSources.some(
            (source) =>
              source.inline &&
              (source.content === block.content || (!source.content && source.label === block.label)),
          ),
      )
      .map((block) => ({ ...block, baseUrl: block.baseUrl || pageBase })),
  ];
  const scriptSources = [
    ...jsSources,
    ...doc.scripts.inline
      .filter((script) => !jsSources.some((source) => source.inline && source.content === script.content))
      .map((script) => ({ ...script, label: script.label || 'Inline script' })),
  ];

  if (/just a moment|verify you are human|attention required|cf-chl|challenge-platform/i.test(html)) {
    pushWarning(
      warnings,
      'The page looks like a bot challenge or access screen. The report may describe that screen rather than the real site.',
    );
  }
  if (pageInfo.truncated) {
    pushWarning(warnings, 'The HTML was cut at the 5 MB read limit; later markup was not inspected.');
  }

  emit(
    'styles',
    'Parsing styles and design tokens',
    hasPreloadedDocument ? 74 : 48,
    `${styleSources.length} sources`,
  );

  const styles = analyzeStyles(styleSources, doc.styleAttributes.items, {
    pageBase: baseUrl,
    warnings,
    inlineStyleCount: doc.styleAttributes.total,
  });

  emit(
    'scripts',
    'Tracing scripts and libraries',
    hasPreloadedDocument ? 84 : 66,
    `${scriptSources.length} sources`,
  );

  const js = analyzeScripts(scriptSources, {
    motionMarkup: doc.motionMarkup,
    html,
  });

  const tech = detectTech({
    html,
    jsSources: scriptSources,
    cssSources: styleSources,
    finalUrl,
    meta: doc.meta,
    responseHeaders,
  });

  emit('motion', 'Counting motion signatures', 86);

  const fonts = mergeFonts(styles.design.fonts, doc.googleFontFamilies);
  const fontFiles = mergeFontAssets(styles.fontAssets, doc.fontPreloads);

  const colors = [...styles.design.colors];
  if (doc.meta.themeColor && /^(?:#|rgb|hsl|oklch)/i.test(doc.meta.themeColor)) {
    const key = doc.meta.themeColor.toLowerCase();
    if (!colors.some((color) => color.value === key)) {
      colors.unshift({ value: doc.meta.themeColor, count: 1, type: 'meta' });
    }
  }

  const gifUrls = new Set(styles.animatedGifUrls);
  for (const image of doc.images.items) {
    for (const candidate of [image.url, ...image.srcset]) {
      if (candidate && /\.gif(?:[?#]|$)/i.test(candidate)) gifUrls.add(candidate);
    }
  }
  for (const source of doc.images.pictureSources) {
    for (const candidate of source.srcset) {
      if (/\.gif(?:[?#]|$)/i.test(candidate)) gifUrls.add(candidate);
    }
  }

  const scroll = buildScrollSignals(styles, js, js.libraries, doc.motionMarkup);
  const special = {
    svgAnimations: doc.specialMedia.smilAnimationCount,
    svgCount: doc.specialMedia.svgCount,
    canvasElements: doc.specialMedia.canvasCount,
    marqueeElements: doc.specialMedia.marqueeCount,
    audioElements: doc.specialMedia.audioCount,
    animatedGifs: gifUrls.size,
    autoplayVideos: doc.videos.autoplay,
    backgroundVideos: styles.backgroundVideoUrls.length,
    videoEmbeds: doc.iframes.videoEmbeds.length,
    webglContexts: js.webglContexts,
  };

  const externalStyles = styleSources.filter((source) => source.url);
  const externalScripts = scriptSources.filter((source) => source.url);

  const assetReferences =
    doc.images.total +
    doc.videos.total +
    externalStyles.length +
    externalScripts.length +
    fontFiles.length +
    doc.iframes.total +
    styles.cssAssetsTotal;

  const summary = {
    motionScore: 0,
    motionLabel: 'Still',
    motionSignatures: 0,
    keyframes: styles.keyframesTotal,
    keyframeNames: styles.keyframeNames,
    animationUses: styles.animationUsesTotal,
    animatedSelectors: styles.animatedSelectors,
    transitions: styles.transitionsTotal,
    transitionedSelectors: styles.transitionedSelectors,
    libraries: js.libraries.length,
    jsTriggers: js.triggersTotal,
    scrollSignals: scroll.total,
    images: doc.images.total,
    imagesMissingAlt: doc.images.missingAlt,
    videos: doc.videos.total,
    stylesheets: externalStyles.length,
    styleBlocks: doc.styleBlocks.length,
    scripts: externalScripts.length,
    inlineScripts: doc.scripts.inline.length,
    fonts: fontFiles.length,
    fontFamilies: fonts.length,
    colors: Math.max(styles.design.colorTotal, colors.length),
    links: doc.links.total,
    assets: assetReferences,
  };

  summary.motionSignatures =
    summary.keyframes +
    summary.animationUses +
    summary.transitions +
    summary.libraries +
    summary.jsTriggers +
    summary.scrollSignals;

  const score = computeMotionScore(summary);
  summary.motionScore = score.score;
  summary.motionLabel = score.label;

  const styleBytes = styleSources.reduce((sum, source) => sum + (source.bytes || 0), 0);
  const scriptBytes = scriptSources.reduce((sum, source) => sum + (source.bytes || 0), 0);
  const externalStyleBytes = externalStyles.reduce((sum, source) => sum + (source.bytes || 0), 0);
  const externalScriptBytes = externalScripts.reduce((sum, source) => sum + (source.bytes || 0), 0);
  const htmlBytes = pageInfo.bytes || Buffer.byteLength(html, 'utf8');
  const transferredBytes =
    (pageInfo.downloadedBytes ?? pageInfo.bytes ?? htmlBytes) +
    externalStyleBytes +
    externalScriptBytes;

  const resourcesRead =
    1 +
    externalStyles.filter((source) => typeof source.status === 'number').length +
    externalScripts.filter((source) => typeof source.status === 'number').length;
  const resourcesFailed =
    externalStyles.filter((source) => typeof source.status !== 'number').length +
    externalScripts.filter((source) => typeof source.status !== 'number').length;
  const resourcesSkipped = (fetchMeta.styleSkipped || 0) + (fetchMeta.scriptSkipped || 0);

  const stats = {
    fetchedAt,
    analyzedInMs: Date.now() - started,
    pageElapsedMs: pageInfo.elapsedMs || 0,
    pageStatus: pageInfo.status || 200,
    pageContentType: pageInfo.contentType || 'text/html',
    pageTruncated: Boolean(pageInfo.truncated),
    htmlBytes,
    cssBytes: styleBytes,
    jsBytes: scriptBytes,
    transferredBytes,
    resourcesRead,
    resourcesFailed,
    resourcesSkipped,
    words: doc.structure.wordCount,
    readingMinutes: doc.structure.readingMinutes,
    stylesheetStats: fetchMeta.styleStats || null,
    scriptStats: fetchMeta.scriptStats || null,
  };

  const notes = [
    'This is a static read of delivered source. Browser-computed styles, canvas frames, video contents and animations injected only at runtime are not rendered.',
    'Cross-origin iframes, shadow DOM internals and dynamically imported modules are not inspected. Scripts loaded after an interaction may not appear here.',
    'Animation counts describe declarations and code signatures, not rendered frames. A keyframe may be defined and never used, and a single transition may affect many elements.',
    'Images, fonts and videos are inventoried from markup and CSS; they are not downloaded or re-hosted by this report.',
  ];

  if (!styles.keyframesTotal && !styles.animationUsesTotal && !styles.transitionsTotal) {
    notes.push('No declared CSS motion was found. The site may rely on JavaScript we could not identify, or it may genuinely be still.');
  }
  if (!externalStyles.length) {
    notes.push('No external stylesheets were available to read. Styling may be inline, rendered through JavaScript, or blocked.');
  }

  if (styles.limits.keyframes) {
    pushWarning(warnings, 'Some keyframe definitions were omitted from the table after the report limit was reached.');
  }
  if (styles.limits.animations) {
    pushWarning(warnings, 'Some animation assignments were omitted from the table after the report limit was reached.');
  }
  if (styles.limits.transitions) {
    pushWarning(warnings, 'Some transition rules were omitted from the table after the report limit was reached.');
  }

  const librarySources = js.libraries.map((library) => ({
    ...library,
    sources: limitArray(library.sources, 5),
  }));

  const motion = {
    ...score,
    keyframes: styles.keyframes,
    keyframesTotal: styles.keyframesTotal,
    keyframeNames: styles.keyframeNames,
    animationUses: styles.animationUses,
    animationUsesTotal: styles.animationUsesTotal,
    animatedSelectors: styles.animatedSelectors,
    transitions: styles.transitions,
    transitionsTotal: styles.transitionsTotal,
    transitionedSelectors: styles.transitionedSelectors,
    easings: styles.easings,
    durationStats: styles.durationStats,
    reducedMotion: {
      ...styles.reducedMotion,
      jsChecks: js.reducedMotionChecks,
      present: styles.reducedMotion.mediaBlocks > 0 || js.reducedMotionChecks > 0,
    },
    scroll: {
      ...styles.scroll,
      signals: scroll.signals,
      total: scroll.total,
      libraries: scroll.libraries,
      jsDetails: js.scrollDetails,
    },
    libraries: librarySources,
    signals: js.signals,
    triggersTotal: js.triggersTotal,
    special,
    dataAttributes: doc.motionMarkup.dataAttributes,
    inlineEvents: doc.motionMarkup.inlineEvents,
    limits: styles.limits,
  };

  const design = {
    colors,
    colorTotal: Math.max(styles.design.colorTotal, colors.length),
    fonts,
    fontTotal: Math.max(styles.design.fontTotal, fonts.length),
    fontFaces: styles.design.fontFaces,
    fontFiles,
    radii: styles.design.radii,
    shadows: styles.design.shadows,
    gradients: styles.design.gradients,
    customProperties: styles.design.customProperties,
    breakpoints: styles.design.breakpoints,
    fontSizes: styles.design.fontSizes,
    typography: {
      ...styles.design.typography,
      specimens: buildTypeSpecimens(styles.design.typography.rules),
    },
    registeredProperties: styles.design.registeredProperties,
    inlineStyleCount: styles.design.inlineStyleCount,
  };

  const assets = {
    counts: {
      images: doc.images.total,
      imagesMissingAlt: doc.images.missingAlt,
      videos: doc.videos.total,
      videoEmbeds: doc.iframes.videoEmbeds.length,
      autoplayVideos: doc.videos.autoplay,
      iframes: doc.iframes.total,
      stylesheets: externalStyles.length,
      styleBlocks: doc.styleBlocks.length,
      scripts: externalScripts.length,
      inlineScripts: doc.scripts.inline.length,
      fonts: fontFiles.length,
      fontFamilies: fonts.length,
      cssAssets: styles.cssAssetsTotal,
      animatedGifs: gifUrls.size,
      links: doc.links.total,
      internalLinks: doc.links.internalCount,
      externalLinks: doc.links.externalCount,
      anchorsWithHref: doc.links.withHref,
      pictureSources: doc.images.pictureSources.length,
    },
    images: doc.images.items,
    imagesTotal: doc.images.total,
    imagesMissingAlt: doc.images.missingAlt,
    pictureSources: doc.images.pictureSources,
    videos: doc.videos.items,
    videosTotal: doc.videos.total,
    videoEmbeds: doc.iframes.videoEmbeds,
    iframes: doc.iframes.items,
    iframesTotal: doc.iframes.total,
    stylesheets: styleSources.map((source) => ({
      url: source.url || null,
      label: source.label,
      inline: Boolean(source.inline),
      imported: Boolean(source.imported),
      media: source.media || '',
      status: source.status,
      bytes: source.bytes || 0,
      truncated: Boolean(source.truncated),
      error: source.error || '',
    })),
    scripts: scriptSources.map((source) => ({
      url: source.url || null,
      label: source.label,
      inline: Boolean(source.inline),
      module: Boolean(source.module),
      async: Boolean(source.async),
      defer: Boolean(source.defer),
      status: source.status,
      bytes: source.bytes || 0,
      truncated: Boolean(source.truncated),
      error: source.error || '',
    })),
    fontFiles,
    cssAssets: styles.cssAssets,
    links: doc.links,
    metaImages: {
      favicon: doc.meta.favicon,
      openGraph: doc.meta.og.image,
      twitter: doc.meta.twitter.image,
      manifest: doc.meta.manifest,
    },
    externalDomains: doc.links.externalDomains,
  };

  const structure = {
    ...doc.structure,
    meta: doc.meta,
  };

  const report = {
    requestedUrl,
    finalUrl,
    host: hostnameFromUrl(finalUrl),
    fetchedAt,
    demo: Boolean(demo),
    meta: doc.meta,
    summary,
    motion,
    design,
    assets,
    structure,
    tech,
    stats,
    warnings: uniqueBy(warnings.map((warning) => collapse(warning, 300)), (item) => item).slice(0, 30),
    notes,
  };

  report.prompt = buildAgentPrompt(report);

  /*
   * The assembling step normally closes the progress ladder. When a link crawl
   * will run after this, analyzeSite emits that event itself once the crawl
   * completes, so the overlay never shows "assembling" mid-crawl.
   */
  if (!deferFinish) {
    emit('finish', 'Assembling the report', 97);
  }
  return report;
}

/**
 * Read one linked page with the reduced crawl limits. Mirrors the entry scan,
 * but always against the per-scan resource cache so shared stylesheets and
 * scripts are fetched once. Progress is intentionally silent — the crawl
 * orchestrator owns the progress line.
 */
async function analyzePage(url, { signal, cache }, warnings) {
  const page = await safeFetch(url, {
    maxBytes: 2_500_000,
    timeoutMs: 15_000,
    accept: HTML_ACCEPT,
    signal,
  });

  if (!page.ok) {
    let message = `A linked page answered with HTTP ${page.status}.`;
    if (page.status === 403) message = 'A linked page refused access (HTTP 403).';
    else if (page.status === 404) message = 'A linked page could not be found (HTTP 404).';
    else if (page.status === 429) message = 'The site limited a linked page request (HTTP 429).';
    else if (page.status >= 500) message = `A linked page returned a server error (HTTP ${page.status}).`;
    throw new FetchProblem(message, { code: 'HTTP_STATUS', status: 422, detail: `HTTP ${page.status}` });
  }

  const contentType = page.headers.contentType || '';
  const looksLikeHtml =
    /text\/html|application\/xhtml/i.test(contentType) || (!contentType && /^\s*</.test(page.text));
  if (!looksLikeHtml || !page.text.trim()) {
    throw new FetchProblem('That link does not return an HTML page.', {
      code: 'NOT_HTML',
      status: 415,
      detail: contentType || 'empty',
    });
  }

  const finalUrl = page.finalUrl || url;
  const $ = load(page.text, { xmlMode: false });
  let baseUrl = finalUrl;
  const baseHref = $('base[href]').first().attr('href');
  if (baseHref) {
    try {
      const candidate = new URL(baseHref, finalUrl);
      if (['http:', 'https:'].includes(candidate.protocol)) baseUrl = candidate.toString();
    } catch {
      // Ignore malformed base tags.
    }
  }

  const doc = analyzeDocument({ $, html: page.text, baseUrl, finalUrl });
  const styleFetch = await fetchStyles(doc, baseUrl, warnings, signal, {
    cache,
    maxStyles: CRAWL_MAX_STYLES,
    maxImports: 2,
  });
  const scriptFetch = await fetchScripts(doc, warnings, signal, {
    cache,
    maxScripts: CRAWL_MAX_SCRIPTS,
  });

  return analyzeSources({
    requestedUrl: url,
    finalUrl,
    html: page.text,
    cssSources: styleFetch.sources,
    jsSources: scriptFetch.sources,
    warnings,
    responseHeaders: page.headers,
    preloadedDocument: { $, doc, baseUrl },
    pageInfo: {
      bytes: page.bytes,
      downloadedBytes: page.downloadedBytes,
      status: page.status,
      contentType: page.headers.contentType,
      elapsedMs: page.elapsedMs,
      truncated: page.truncated,
    },
    fetchMeta: {
      styleSkipped: styleFetch.skipped,
      scriptSkipped: scriptFetch.skipped,
      styleStats: styleFetch.stats,
      scriptStats: scriptFetch.stats,
    },
    onProgress: () => {},
  });
}

/**
 * Follow the entry page's internal links and read them with the same pipeline.
 * Never throws: a failed crawl only degrades report.crawl, the entry report is
 * already complete.
 */
async function buildCrawl({ entryReport, seedUrl, options, cache, warnings, signal, onProgress, startedAt }) {
  const emit = makeProgress(onProgress);
  const payload = {
    enabled: options.pages <= 0 ? false : true,
    seedUrl,
    options: { pages: options.pages, depth: options.depth },
    discovered: 0,
    skipped: 0,
    stoppedByBudget: false,
    failed: [],
    pages: [],
    totals: {
      pagesRead: 1,
      failed: 0,
      discovered: 0,
      words: entryReport.stats?.words || 0,
      transferredBytes: entryReport.stats?.transferredBytes || 0,
      avgMotionScore: entryReport.summary?.motionScore || 0,
      minMotionScore: entryReport.summary?.motionScore || 0,
      maxMotionScore: entryReport.summary?.motionScore || 0,
    },
    shared: { fonts: [], colors: [], libraries: [], keyframes: [], tech: [] },
    navLabels: [],
    blueprint: '',
  };

  if (options.pages <= 0) {
    return payload;
  }

  try {
    emit(
      'crawl',
      'Following internal links',
      87,
      `up to ${options.pages} pages · depth ${options.depth} · same host only`,
    );

    const crawl = await crawlLinkedPages({
      seedUrl,
      candidates: entryReport.assets?.links?.internal || [],
      maxPages: options.pages,
      maxDepth: options.depth,
      budgetMs: options.budgetMs,
      startedAt,
      signal,
      visitPage: (url, context) => analyzePage(url, { signal, cache }, []),
      onVisit: ({ done }) => {
        emit(
          'crawl',
          'Reading linked pages',
          Math.min(96, 87 + Math.round((done / Math.max(1, options.pages)) * 9)),
          `${done} of up to ${options.pages} pages read`,
        );
      },
      warn: (message) => pushWarning(warnings, message),
    });

    const summary = summarizeCrawl({ entryReport, crawl, seedUrl, options });
    emit(
      'finish',
      'Assembling the report',
      97,
      `${summary.pages.length} linked page${summary.failed.length === 0 && summary.pages.length === 1 ? '' : 's'} · ${summary.failed.length} failed · average motion ${summary.totals.avgMotionScore}/100`,
    );
    return summary;
  } catch (error) {
    pushWarning(
      warnings,
      `The linked-page pass stopped early: ${collapse(error?.message || 'unknown error', 180)}`,
    );
    return payload;
  }
}

/**
 * Fetch a public page, read its linked CSS and JS within safe limits, then
 * return a complete static motion + design report.
 */
export async function analyzeSite(input, options = {}) {
  const { onProgress = () => {}, signal, demo = false, crawl = {} } = options;
  const emit = makeProgress(onProgress);
  const started = Date.now();
  const crawlOptions = readCrawlOptions(crawl);
  const requested = normalizeUrl(input);
  const requestedUrl = requested.toString();
  const warnings = [];

  emit('fetch', 'Fetching the document', 8, requested.hostname);

  const page = await safeFetch(requested, {
    maxBytes: 5_000_000,
    timeoutMs: 20_000,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    signal,
  });

  if (!page.ok) {
    let message = `That page answered with HTTP ${page.status}.`;
    if (page.status === 403) message = 'The site refused access (HTTP 403). It may block automated readers.';
    else if (page.status === 404) message = 'That page could not be found (HTTP 404).';
    else if (page.status === 429) message = 'The site is rate-limiting requests. Try again later.';
    else if (page.status >= 500) message = `The site returned a server error (HTTP ${page.status}).`;
    throw new FetchProblem(message, {
      code: 'HTTP_STATUS',
      status: 422,
      detail: `HTTP ${page.status}`,
    });
  }

  const contentType = page.headers.contentType || '';
  const looksLikeHtml =
    /text\/html|application\/xhtml/i.test(contentType) || (!contentType && /^\s*</.test(page.text));
  if (!looksLikeHtml) {
    throw new FetchProblem('That link does not return an HTML page, so there is no site to read.', {
      code: 'NOT_HTML',
      status: 415,
      detail: contentType || 'unknown content type',
    });
  }
  if (!page.text.trim()) {
    throw new FetchProblem('That page returned an empty document.', {
      code: 'EMPTY_PAGE',
      status: 422,
    });
  }

  if (page.truncated) {
    pushWarning(warnings, 'The page is larger than 5 MB, so only the first part was read.');
  }

  const finalUrl = page.finalUrl || requestedUrl;

  emit('parse', 'Reading the document', 18, hostnameFromUrl(finalUrl));

  let $;
  try {
    $ = load(page.text, { xmlMode: false });
  } catch {
    throw new FetchProblem('That page could not be parsed as HTML.', {
      code: 'HTML_PARSE_FAILED',
      status: 422,
    });
  }

  let baseUrl = finalUrl;
  const baseHref = $('base[href]').first().attr('href');
  if (baseHref) {
    try {
      const candidate = new URL(baseHref, finalUrl);
      if (['http:', 'https:'].includes(candidate.protocol)) baseUrl = candidate.toString();
    } catch {
      // Ignore malformed base tags.
    }
  }

  const doc = analyzeDocument({ $, html: page.text, baseUrl, finalUrl });

  emit('styles', 'Fetching stylesheets', 28, `${doc.styleLinks.length} linked`);
  const cache = createResourceCache();
  const styles = await fetchStyles(doc, baseUrl, warnings, signal, { cache });

  emit('scripts', 'Fetching scripts', 55, `${doc.scripts.external.length} linked`);
  const scripts = await fetchScripts(doc, warnings, signal, { cache });

  const report = analyzeSources({
    requestedUrl,
    finalUrl,
    html: page.text,
    cssSources: styles.sources,
    jsSources: scripts.sources,
    warnings,
    responseHeaders: page.headers,
    preloadedDocument: { $, doc, baseUrl },
    pageInfo: {
      bytes: page.bytes,
      downloadedBytes: page.downloadedBytes,
      status: page.status,
      contentType: page.headers.contentType,
      elapsedMs: page.elapsedMs,
      truncated: page.truncated,
    },
    fetchMeta: {
      styleSkipped: styles.skipped,
      scriptSkipped: scripts.skipped,
      styleStats: styles.stats,
      scriptStats: scripts.stats,
    },
    onProgress,
    demo,
    deferFinish: crawlOptions.pages > 0,
  });

  /* ------------------------------------------------------- linked pages */
  report.crawl = await buildCrawl({
    entryReport: report,
    seedUrl: finalUrl,
    options: crawlOptions,
    cache,
    warnings,
    signal,
    onProgress,
    startedAt: Date.now(),
  });

  /* The crawl may have added warnings; rebuild the escape hatch lists. */
  if (report.crawl?.enabled) {
    report.warnings = uniqueBy(
      warnings.map((warning) => collapse(warning, 300)),
      (item) => item,
    ).slice(0, 30);

    /* The agent prompt benefits from knowing the other pages exist. */
    report.prompt = buildAgentPrompt(report);
  }

  report.stats.analyzedInMs = Date.now() - started;
  report.fetchedAt = new Date().toISOString();
  return report;
}
