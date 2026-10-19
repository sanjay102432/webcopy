import {
  collapse,
  hostnameFromUrl,
  limitArray,
  splitTopLevel,
  toHttpUrl,
  uniqueBy,
} from './analyzer-utils.js';

const MAX_IMAGES = 260;
const MAX_VIDEOS = 80;
const MAX_IFRAMES = 80;
const MAX_STYLE_ATTRIBUTES = 600;
const MAX_INTERNAL_LINKS = 140;
const MAX_EXTERNAL_LINKS = 100;
const MAX_HEADINGS = 120;
const MAX_INLINE_SCRIPTS = 60;
const MAX_STYLE_BLOCKS = 40;
const MAX_JSON_LD = 20;

const JS_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'text/babel',
  'text/jsx',
]);

const MOTION_DATA_ATTRIBUTES = [
  'data-aos',
  'data-scroll',
  'data-scroll-speed',
  'data-scroll-direction',
  'data-parallax',
  'data-lottie',
  'data-reveal',
  'data-animate',
  'data-wow-duration',
  'data-wow-delay',
  'data-speed',
  'data-lag',
  'data-sal',
  'data-scrolly',
  'data-framer-appear-id',
  'data-motion',
  'data-tilt',
  'data-depth',
  'data-splitting',
];

const MOTION_EVENTS = new Set([
  'onclick',
  'ondblclick',
  'onmouseover',
  'onmouseout',
  'onmouseenter',
  'onmouseleave',
  'onmousemove',
  'onpointermove',
  'onpointerover',
  'onscroll',
  'onwheel',
  'ontouchstart',
  'ontouchmove',
  'onanimationstart',
  'onanimationend',
  'ontransitionend',
]);

function metaMap($) {
  const map = new Map();
  $('meta').each((_, node) => {
    const key = (
      $(node).attr('name') ||
      $(node).attr('property') ||
      $(node).attr('http-equiv') ||
      ''
    )
      .trim()
      .toLowerCase();
    if (!key) return;
    const content = ($(node).attr('content') || '').trim();
    if (!map.has(key)) map.set(key, content);
  });
  return map;
}

function firstResolved(baseUrl, ...values) {
  for (const value of values) {
    const resolved = toHttpUrl(value, baseUrl);
    if (resolved) return resolved;
  }
  return '';
}

function parseSrcset(value, baseUrl) {
  if (!value) return [];
  return uniqueBy(
    splitTopLevel(value, ',')
      .map((candidate) => toHttpUrl(candidate.trim().split(/\s+/)[0], baseUrl))
      .filter(Boolean),
    (url) => url,
  );
}

function elementLabel(node, index = 0) {
  const tag = String(node.tagName || 'node').toLowerCase();
  const attribs = node.attribs || {};
  const id = attribs.id ? `#${String(attribs.id).replace(/[^\w-]/g, '').slice(0, 40)}` : '';
  const firstClass = String(attribs.class || '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\w-]/g, '')
    .slice(0, 40);
  const className = firstClass ? `.${firstClass}` : '';
  return `${tag}${id}${className}` || `element-${index + 1}`;
}

function countWords($) {
  const clone = $('body').clone();
  clone.find('script, style, noscript, svg, template').remove();
  const text = collapse(clone.text(), 1_500_000);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function collectJsonLd($) {
  const types = new Set();
  let blocks = 0;

  function walk(value, depth = 0) {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) walk(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const type = value['@type'];
    if (Array.isArray(type)) type.slice(0, 10).forEach((item) => types.add(collapse(item, 60)));
    else if (typeof type === 'string') types.add(collapse(type, 60));
    if (value['@graph']) walk(value['@graph'], depth + 1);
    if (value.mainEntity) walk(value.mainEntity, depth + 1);
    if (value.itemListElement) walk(value.itemListElement, depth + 1);
  }

  $('script[type="application/ld+json"]').each((_, node) => {
    if (blocks >= MAX_JSON_LD) return;
    blocks += 1;
    const content = $(node).text().trim();
    if (!content) return;
    try {
      walk(JSON.parse(content));
    } catch {
      // Ignore malformed structured data.
    }
  });

  return { types: [...types].slice(0, 20), blocks };
}

/**
 * Read the document tree: metadata, assets, links, structure, style/script
 * discovery and inline motion markers. No network access happens here.
 */
export function analyzeDocument({ $, html, baseUrl, finalUrl }) {
  const metas = metaMap($);
  const title = collapse($('title').first().text(), 220);
  const linksByRel = new Map();
  const faviconCandidates = [];
  const styleLinks = [];
  const styleLinkSeen = new Set();
  const fontPreloads = [];
  const googleFontFamilies = new Set();
  let manifest = '';
  let canonical = '';

  $('link').each((_, node) => {
    const el = $(node);
    const href = el.attr('href');
    const rel = (el.attr('rel') || '').toLowerCase();
    const relTokens = rel.split(/\s+/).filter(Boolean);
    if (!linksByRel.has(rel)) linksByRel.set(rel, href || '');

    if (href && /(?:^|\s)stylesheet(?:\s|$)/.test(rel)) {
      const resolved = toHttpUrl(href, baseUrl);
      if (resolved && !styleLinkSeen.has(resolved)) {
        styleLinkSeen.add(resolved);
        styleLinks.push({
          url: resolved,
          media: el.attr('media') || '',
          title: el.attr('title') || '',
          disabled: el.attr('disabled') !== undefined,
        });
      }
    }

    if (href && (relTokens.includes('icon') || relTokens.includes('apple-touch-icon'))) {
      const resolved = toHttpUrl(href, baseUrl);
      if (resolved) {
        faviconCandidates.push({
          url: resolved,
          sizes: el.attr('sizes') || '',
          type: el.attr('type') || '',
          rel,
        });
      }
    }

    if (href && relTokens.includes('canonical')) canonical = toHttpUrl(href, baseUrl) || '';
    if (href && relTokens.includes('manifest')) manifest = toHttpUrl(href, baseUrl) || '';

    if (href && relTokens.includes('preload') && (el.attr('as') || '').toLowerCase() === 'font') {
      const resolved = toHttpUrl(href, baseUrl);
      if (resolved) {
        fontPreloads.push({
          url: resolved,
          type: el.attr('type') || '',
          crossorigin: el.attr('crossorigin') || '',
        });
      }
    }

    if (href && /fonts\.googleapis\.com\/css/i.test(href)) {
      try {
        const fontUrl = new URL(href, baseUrl);
        for (const familyParam of fontUrl.searchParams.getAll('family')) {
          const family = familyParam.split(':')[0].replace(/\+/g, ' ').trim();
          if (family) googleFontFamilies.add(collapse(family, 80));
        }
      } catch {
        // Ignore malformed font URLs.
      }
    }
  });

  const favicon =
    firstResolved(baseUrl, faviconCandidates[0]?.url) ||
    toHttpUrl('/favicon.ico', finalUrl) ||
    '';

  const images = [];
  const pictureSources = [];
  let imagesTotal = 0;
  let imagesMissingAlt = 0;
  let imagesWithAlt = 0;

  $('img').each((_, node) => {
    imagesTotal += 1;
    const el = $(node);
    const altAttr = el.attr('alt');
    if (altAttr === undefined) imagesMissingAlt += 1;
    else imagesWithAlt += 1;

    const srcCandidates = parseSrcset(el.attr('srcset') || el.attr('data-srcset') || '', baseUrl);
    const src =
      firstResolved(
        baseUrl,
        el.attr('src'),
        el.attr('data-src'),
        el.attr('data-lazy-src'),
        el.attr('data-original'),
        srcCandidates[0],
      ) || '';

    if (images.length < MAX_IMAGES) {
      images.push({
        url: src,
        alt: collapse(altAttr || '', 180),
        hasAlt: altAttr !== undefined,
        width: el.attr('width') || '',
        height: el.attr('height') || '',
        loading: el.attr('loading') || '',
        decoding: el.attr('decoding') || '',
        fetchPriority: el.attr('fetchpriority') || '',
        sizes: collapse(el.attr('sizes') || '', 120),
        srcset: srcCandidates.slice(0, 12),
        srcsetCount: srcCandidates.length,
      });
    }
  });

  $('picture source').each((_, node) => {
    if (pictureSources.length >= 80) return;
    const el = $(node);
    pictureSources.push({
      srcset: parseSrcset(el.attr('srcset') || '', baseUrl).slice(0, 12),
      media: collapse(el.attr('media') || '', 120),
      type: collapse(el.attr('type') || '', 60),
    });
  });

  const videos = [];
  let videosTotal = 0;
  let autoplayVideos = 0;
  $('video').each((_, node) => {
    videosTotal += 1;
    const el = $(node);
    if (el.attr('autoplay') !== undefined) autoplayVideos += 1;
    const sourceEls = el.find('source');
    const sources = [];
    sourceEls.each((__, source) => {
      const sourceEl = $(source);
      const url = toHttpUrl(sourceEl.attr('src'), baseUrl);
      if (url) sources.push({ url, type: sourceEl.attr('type') || '', media: sourceEl.attr('media') || '' });
    });
    const src = firstResolved(baseUrl, el.attr('src'), sources[0]?.url) || '';
    if (videos.length < MAX_VIDEOS) {
      videos.push({
        url: src,
        poster: firstResolved(baseUrl, el.attr('poster')),
        sources: sources.slice(0, 8),
        autoplay: el.attr('autoplay') !== undefined,
        loop: el.attr('loop') !== undefined,
        muted: el.attr('muted') !== undefined,
        controls: el.attr('controls') !== undefined,
        playsInline: el.attr('playsinline') !== undefined,
        preload: el.attr('preload') || '',
        width: el.attr('width') || '',
        height: el.attr('height') || '',
      });
    }
  });

  const iframes = [];
  const videoEmbeds = [];
  let iframesTotal = 0;
  $('iframe').each((_, node) => {
    iframesTotal += 1;
    const el = $(node);
    const url = toHttpUrl(el.attr('src'), baseUrl);
    if (!url) return;
    let host = hostnameFromUrl(url);
    let provider = host;
    if (/youtube(?:-nocookie)?\.com|youtu\.be/.test(host)) provider = 'YouTube';
    else if (/vimeo\.com/.test(host)) provider = 'Vimeo';
    else if (/loom\.com/.test(host)) provider = 'Loom';
    else if (/wistia\./.test(host)) provider = 'Wistia';
    else if (/dailymotion\.com/.test(host)) provider = 'Dailymotion';
    else if (/spotify\.com/.test(host)) provider = 'Spotify';

    const entry = {
      url,
      provider,
      title: collapse(el.attr('title') || '', 140),
      loading: el.attr('loading') || '',
      allow: collapse(el.attr('allow') || '', 180),
      allowFullscreen: el.attr('allowfullscreen') !== undefined,
    };

    if (['YouTube', 'Vimeo', 'Loom', 'Wistia', 'Dailymotion'].includes(provider)) {
      videoEmbeds.push(entry);
    }
    if (iframes.length < MAX_IFRAMES) iframes.push(entry);
  });

  const anchors = $('a[href]');
  const totalLinks = $('a').length;
  const internalMap = new Map();
  const externalMap = new Map();
  const externalDomains = new Map();
  const contacts = new Map();
  let internalCount = 0;
  let externalCount = 0;
  let emailCount = 0;
  let phoneCount = 0;
  let anchorCount = 0;
  let otherCount = 0;

  const pageHost = hostnameFromUrl(finalUrl);

  anchors.each((_, node) => {
    const el = $(node);
    const href = (el.attr('href') || '').trim();
    if (!href) return;
    const text = collapse(el.text(), 120);
    const rel = el.attr('rel') || '';
    const target = el.attr('target') || '';

    if (href.startsWith('#')) {
      anchorCount += 1;
      return;
    }
    if (/^mailto:/i.test(href)) {
      emailCount += 1;
      if (contacts.size < 30) contacts.set(href, { type: 'email', url: href, text });
      return;
    }
    if (/^tel:/i.test(href)) {
      phoneCount += 1;
      if (contacts.size < 30) contacts.set(href, { type: 'phone', url: href, text });
      return;
    }
    if (/^(?:javascript|data|blob):/i.test(href)) {
      otherCount += 1;
      return;
    }

    let resolved;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      otherCount += 1;
      return;
    }
    if (!['http:', 'https:'].includes(resolved.protocol)) {
      otherCount += 1;
      return;
    }

    const host = resolved.hostname.replace(/^www\./, '');
    const internal = host === pageHost || host.endsWith(`.${pageHost}`);

    if (internal) {
      internalCount += 1;
      if (!internalMap.has(resolved.toString()) && internalMap.size < MAX_INTERNAL_LINKS) {
        internalMap.set(resolved.toString(), {
          url: resolved.toString(),
          text,
          rel,
          target,
          host,
        });
      }
    } else {
      externalCount += 1;
      externalDomains.set(host, (externalDomains.get(host) || 0) + 1);
      if (!externalMap.has(resolved.toString()) && externalMap.size < MAX_EXTERNAL_LINKS) {
        externalMap.set(resolved.toString(), {
          url: resolved.toString(),
          text,
          rel,
          target,
          host,
        });
      }
    }
  });

  const headings = [];
  $('h1, h2, h3, h4, h5, h6').each((_, node) => {
    if (headings.length >= MAX_HEADINGS) return;
    const el = $(node);
    const level = Number(node.tagName.slice(1));
    const text = collapse(el.text() || el.attr('aria-label') || '', 180);
    if (!text) return;
    headings.push({
      level,
      text,
      id: el.attr('id') || '',
    });
  });

  const sections = [];
  $('section').each((_, node) => {
    if (sections.length >= 30) return;
    const el = $(node);
    const heading = el.find('h1, h2, h3, h4, h5, h6').first().text();
    sections.push({
      id: el.attr('id') || '',
      label: collapse(el.attr('aria-label') || heading || el.attr('class') || '', 140),
    });
  });

  const landmarks = {};
  for (const tag of ['header', 'nav', 'main', 'footer', 'section', 'article', 'aside', 'form']) {
    landmarks[tag] = $(tag).length;
  }

  const inputTypes = new Map();
  $('input').each((_, node) => {
    const type = ($(node).attr('type') || 'text').toLowerCase();
    inputTypes.set(type, (inputTypes.get(type) || 0) + 1);
  });

  const styleBlocks = [];
  $('style').each((_, node) => {
    if (styleBlocks.length >= MAX_STYLE_BLOCKS) return;
    const css = $(node).text().replace(/^<!--|-->$/g, '').trim();
    if (!css) return;
    styleBlocks.push({
      label: `Inline style #${styleBlocks.length + 1}`,
      content: css,
      bytes: Buffer.byteLength(css, 'utf8'),
      inline: true,
      baseUrl,
    });
  });

  const externalScriptMap = new Map();
  const inlineScripts = [];
  let scriptTagsTotal = 0;
  let externalScriptTags = 0;
  let inlineScriptTags = 0;
  const jsonLd = collectJsonLd($);

  $('script').each((_, node) => {
    const el = $(node);
    const type = (el.attr('type') || '').trim().toLowerCase().split(';')[0];
    const src = (el.attr('src') || '').trim();
    if (type === 'application/ld+json') return;
    if (!JS_TYPES.has(type)) return;
    if (src) {
      scriptTagsTotal += 1;
      externalScriptTags += 1;
      const url = toHttpUrl(src, baseUrl);
      if (!url) return;
      if (!externalScriptMap.has(url)) {
        externalScriptMap.set(url, {
          url,
          type,
          module: type === 'module',
          async: el.attr('async') !== undefined,
          defer: el.attr('defer') !== undefined,
          nomodule: el.attr('nomodule') !== undefined,
          occurrences: 1,
        });
      } else {
        externalScriptMap.get(url).occurrences += 1;
      }
      return;
    }

    const content = el.text().trim();
    if (!content) return;
    scriptTagsTotal += 1;
    inlineScriptTags += 1;
    if (inlineScripts.length < MAX_INLINE_SCRIPTS) {
      inlineScripts.push({
        label: `Inline script #${inlineScripts.length + 1}`,
        content: content.slice(0, 350_000),
        bytes: Buffer.byteLength(content, 'utf8'),
        inline: true,
        status: 'inline',
        type,
        module: type === 'module',
        truncated: content.length > 350_000,
      });
    }
  });

  const styleAttributes = [];
  const allStyleElements = $('[style]');
  allStyleElements.slice(0, MAX_STYLE_ATTRIBUTES).each((index, node) => {
    const css = ($(node).attr('style') || '').trim();
    if (!css) return;
    styleAttributes.push({
      selector: elementLabel(node, index),
      css: css.slice(0, 4000),
    });
  });

  const dataAttributes = new Map();
  const inlineEvents = new Map();
  let motionEventHandlers = 0;
  let elementsScanned = 0;
  $('*').each((_, node) => {
    elementsScanned += 1;
    if (elementsScanned > 8000) return false;
    const attribs = node.attribs;
    if (!attribs) return;
    for (const key of Object.keys(attribs)) {
      if (MOTION_DATA_ATTRIBUTES.includes(key)) {
        dataAttributes.set(key, (dataAttributes.get(key) || 0) + 1);
      }
      if (key.startsWith('on')) {
        inlineEvents.set(key, (inlineEvents.get(key) || 0) + 1);
        if (MOTION_EVENTS.has(key)) motionEventHandlers += 1;
      }
    }
    return;
  });

  const smilAnimationCount = (html.match(/<(?:animate|animateTransform|animateMotion|animateColor|set)\b/gi) || []).length;
  const canvasCount = $('canvas').length;
  const marqueeCount = $('marquee').length;
  const audioCount = $('audio').length;
  const svgCount = $('svg').length;
  const wordCount = countWords($);

  const meta = {
    title: title || collapse(metas.get('og:title') || '', 220),
    description: collapse(
      $('meta[name="description"]').attr('content') ||
        metas.get('og:description') ||
        metas.get('twitter:description') ||
        '',
      500,
    ),
    lang: collapse($('html').attr('lang') || '', 30),
    canonical,
    favicon,
    faviconCandidates: limitArray(faviconCandidates, 8),
    manifest,
    themeColor: collapse(metas.get('theme-color') || '', 60),
    generator: collapse(metas.get('generator') || '', 160),
    robots: collapse(metas.get('robots') || '', 100),
    viewport: collapse(metas.get('viewport') || '', 160),
    charset: $('meta[charset]').attr('charset') || ($('meta[http-equiv="content-type"]').attr('content') || ''),
    colorScheme: collapse(metas.get('color-scheme') || '', 60),
    author: collapse(metas.get('author') || '', 120),
    keywords: collapse(metas.get('keywords') || '', 240),
    og: {
      title: collapse(metas.get('og:title') || '', 220),
      description: collapse(metas.get('og:description') || '', 400),
      image: firstResolved(baseUrl, metas.get('og:image')),
      type: collapse(metas.get('og:type') || '', 50),
      siteName: collapse(metas.get('og:site_name') || '', 120),
    },
    twitter: {
      card: collapse(metas.get('twitter:card') || '', 50),
      title: collapse(metas.get('twitter:title') || '', 220),
      description: collapse(metas.get('twitter:description') || '', 300),
      image: firstResolved(baseUrl, metas.get('twitter:image')),
    },
  };

  return {
    meta,
    styleLinks,
    styleBlocks,
    styleAttributes: {
      total: allStyleElements.length,
      items: styleAttributes,
    },
    scripts: {
      external: [...externalScriptMap.values()],
      inline: inlineScripts,
      tagsTotal: scriptTagsTotal,
      externalTags: externalScriptTags,
      inlineTags: inlineScriptTags,
      maxInlineReached: inlineScriptTags > MAX_INLINE_SCRIPTS,
    },
    fontPreloads,
    googleFontFamilies: [...googleFontFamilies],
    images: {
      items: images,
      total: imagesTotal,
      missingAlt: imagesMissingAlt,
      withAlt: imagesWithAlt,
      pictureSources,
    },
    videos: {
      items: videos,
      total: videosTotal,
      autoplay: autoplayVideos,
    },
    iframes: {
      items: iframes,
      total: iframesTotal,
      videoEmbeds,
    },
    links: {
      total: totalLinks,
      withHref: anchors.length,
      unique: internalMap.size + externalMap.size + contacts.size,
      internalCount,
      externalCount,
      emailCount,
      phoneCount,
      anchorCount,
      otherCount,
      internal: [...internalMap.values()],
      external: [...externalMap.values()],
      externalDomains: [...externalDomains.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16)
        .map(([domain, count]) => ({ domain, count })),
      contacts: [...contacts.values()],
    },
    structure: {
      headings,
      h1Count: headings.filter((heading) => heading.level === 1).length,
      sections,
      landmarks,
      forms: {
        forms: $('form').length,
        inputs: $('input').length,
        textareas: $('textarea').length,
        selects: $('select').length,
        buttons: $('button').length,
        labels: $('label').length,
        inputTypes: [...inputTypes.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => ({ type, count })),
      },
      wordCount,
      readingMinutes: wordCount ? Math.max(1, Math.round(wordCount / 220)) : 0,
      jsonLd,
    },
    motionMarkup: {
      dataAttributes: [...dataAttributes.entries()].map(([name, count]) => ({ name, count })),
      inlineEvents: [...inlineEvents.entries()].map(([name, count]) => ({ name, count })),
      motionEventHandlers,
      elementsScanned,
    },
    specialMedia: {
      svgCount,
      smilAnimationCount,
      canvasCount,
      marqueeCount,
      audioCount,
    },
    baseUrl,
    finalUrl,
  };
}
