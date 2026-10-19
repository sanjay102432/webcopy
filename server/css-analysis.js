import {
  GENERIC_FONTS,
  addCount,
  ancestorAtRule,
  basenameFromUrl,
  cleanSelector,
  collapse,
  inAtRule,
  mediaContext,
  parseCssRoot,
  parseCssTime,
  sortedCounts,
  splitTopLevel,
  stripQuotes,
  toHttpUrl,
  tokenizeTopLevel,
} from './analyzer-utils.js';

const MAX_KEYFRAMES = 140;
const MAX_ANIMATION_USES = 260;
const MAX_TRANSITION_USES = 280;
const MAX_CSS_ASSETS = 220;
const MAX_FONT_FACES = 80;
const MAX_FONT_ASSETS = 100;

const ANIMATION_PROPS = new Set([
  'animation',
  'animation-name',
  'animation-duration',
  'animation-timing-function',
  'animation-delay',
  'animation-iteration-count',
  'animation-direction',
  'animation-fill-mode',
  'animation-play-state',
]);

const ANIMATION_LONGHANDS = [
  ['animation-name', 'name'],
  ['animation-duration', 'duration'],
  ['animation-timing-function', 'timing'],
  ['animation-delay', 'delay'],
  ['animation-iteration-count', 'iterations'],
  ['animation-direction', 'direction'],
  ['animation-fill-mode', 'fill'],
  ['animation-play-state', 'play'],
];

const TRANSITION_PROPS = new Set([
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'transition-delay',
  'transition-behavior',
]);

const TYPOGRAPHY_PROPS = new Set([
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-align',
  'font-feature-settings',
  'font-variation-settings',
]);

const MAX_TYPOGRAPHY_RULES = 260;

const TRANSITION_LONGHANDS = [
  ['transition-property', 'property'],
  ['transition-duration', 'duration'],
  ['transition-timing-function', 'timing'],
  ['transition-delay', 'delay'],
  ['transition-behavior', 'behavior'],
];

const EASING_KEYWORDS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
]);

const DIRECTIONS = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse']);
const FILL_MODES = new Set(['none', 'forwards', 'backwards', 'both']);
const PLAY_STATES = new Set(['running', 'paused']);
const TIME_RE = /^-?(?:\d+|\d*\.\d+)(?:ms|s)$/i;
const NUMBER_RE = /^[+-]?(?:\d+|\d*\.\d+)$/;

const COLOR_RE =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])|(?:rgba?|hsla?)\([^)]*\)/gi;
const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

const IMAGE_EXT = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)(?:[?#]|$)/i;
const VIDEO_EXT = /\.(?:m4v|mov|mp4|ogv|webm)(?:[?#]|$)/i;
const FONT_EXT = /\.(?:eot|otf|ttf|woff2?)(?:[?#]|$)/i;
const GIF_EXT = /\.gif(?:[?#]|$)/i;

function normalizeProp(prop) {
  const lower = String(prop || '').toLowerCase();
  const vendor = /^-(?:webkit|moz|ms|o)-(.+)$/.exec(lower);
  return { prop: vendor ? vendor[1] : lower, vendor: Boolean(vendor) };
}

function effectiveDecls(node, wanted) {
  const standard = new Map();
  const vendor = new Map();

  for (const child of node.nodes || []) {
    if (child.type !== 'decl') continue;
    const normalized = normalizeProp(child.prop);
    if (!wanted.has(normalized.prop)) continue;
    const map = normalized.vendor ? vendor : standard;
    if (!map.has(normalized.prop)) map.set(normalized.prop, []);
    map.get(normalized.prop).push({
      value: child.value.trim(),
      important: child.important,
      raw: child.toString(),
      node: child,
    });
  }

  const output = new Map();
  for (const prop of wanted) {
    const list = standard.get(prop)?.length ? standard.get(prop) : vendor.get(prop);
    if (list?.length) output.set(prop, list[list.length - 1]);
  }
  return output;
}

function isTiming(value) {
  const lower = value.toLowerCase();
  if (EASING_KEYWORDS.has(lower)) return true;
  return /^(?:steps|cubic-bezier|linear)\(/i.test(lower);
}

function parseAnimationGroup(group) {
  const entry = {
    name: '',
    duration: null,
    timing: null,
    delay: null,
    iterations: null,
    direction: null,
    fill: null,
    play: null,
  };
  let timeSeen = 0;

  for (const token of tokenizeTopLevel(group)) {
    const lower = token.toLowerCase();
    if (TIME_RE.test(lower)) {
      if (timeSeen === 0) entry.duration = lower;
      else if (timeSeen === 1) entry.delay = lower;
      timeSeen += 1;
      continue;
    }
    if (isTiming(token)) {
      entry.timing = collapse(token, 100);
      continue;
    }
    if (lower === 'infinite' || NUMBER_RE.test(lower)) {
      entry.iterations = lower;
      continue;
    }
    if (DIRECTIONS.has(lower)) {
      entry.direction = lower;
      continue;
    }
    if (FILL_MODES.has(lower)) {
      entry.fill = lower;
      continue;
    }
    if (PLAY_STATES.has(lower)) {
      entry.play = lower;
      continue;
    }
    if (!entry.name) entry.name = stripQuotes(token);
  }

  return entry;
}

function parseAnimations(rule, customProps) {
  const decls = effectiveDecls(rule, ANIMATION_PROPS);
  if (!decls.size) return [];

  const shorthandGroups = splitTopLevel(decls.get('animation')?.value || '', ',')
    .map(parseAnimationGroup)
    .filter(Boolean);

  const lists = {};
  for (const [prop, field] of ANIMATION_LONGHANDS) {
    const value = decls.get(prop)?.value;
    if (!value) continue;
    lists[field] = splitTopLevel(value, ',');
  }

  const count = Math.max(
    shorthandGroups.length,
    ...Object.values(lists).map((list) => list.length),
    1,
  );

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const base = shorthandGroups[index % Math.max(1, shorthandGroups.length)] || {};
    const entry = {
      name: '',
      duration: null,
      timing: null,
      delay: null,
      iterations: null,
      direction: null,
      fill: null,
      play: null,
      timeline: null,
      ...base,
    };

    for (const [field, list] of Object.entries(lists)) {
      const value = list.length === 1 ? list[0] : list[index % list.length];
      if (value != null) entry[field] = field === 'name' ? stripQuotes(value) : collapse(value, 80);
    }

    const timeline = decls.get('animation-timeline')?.value;
    if (timeline && timeline.toLowerCase() !== 'none') entry.timeline = collapse(timeline, 100);

    entry.name = collapse(stripQuotes(entry.name), 120);
    if (!entry.name || entry.name.toLowerCase() === 'none') continue;
    entry.durationMs = parseCssTime(entry.duration, customProps);
    entries.push(entry);
  }

  return entries;
}

function parseTransitionGroup(group) {
  const entry = {
    property: 'all',
    duration: null,
    timing: null,
    delay: null,
    behavior: null,
  };
  let propertySet = false;
  let timeSeen = 0;

  for (const token of tokenizeTopLevel(group)) {
    const lower = token.toLowerCase();
    if (TIME_RE.test(lower)) {
      if (timeSeen === 0) entry.duration = lower;
      else if (timeSeen === 1) entry.delay = lower;
      timeSeen += 1;
      continue;
    }
    if (isTiming(token)) {
      entry.timing = collapse(token, 100);
      continue;
    }
    if (lower === 'allow-discrete' || lower === 'normal') {
      entry.behavior = lower;
      continue;
    }
    if (!propertySet) {
      entry.property = collapse(stripQuotes(token), 100);
      propertySet = true;
    }
  }

  return entry;
}

function parseTransitions(rule, customProps) {
  const decls = effectiveDecls(rule, TRANSITION_PROPS);
  if (!decls.size) return [];

  const shorthandGroups = splitTopLevel(decls.get('transition')?.value || '', ',')
    .map(parseTransitionGroup)
    .filter(Boolean);

  const lists = {};
  for (const [prop, field] of TRANSITION_LONGHANDS) {
    const value = decls.get(prop)?.value;
    if (!value) continue;
    lists[field] = splitTopLevel(value, ',');
  }

  const count = Math.max(
    shorthandGroups.length,
    ...Object.values(lists).map((list) => list.length),
    1,
  );

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const base = shorthandGroups[index % Math.max(1, shorthandGroups.length)] || {};
    const entry = {
      property: 'all',
      duration: null,
      timing: null,
      delay: null,
      behavior: null,
      ...base,
    };

    for (const [field, list] of Object.entries(lists)) {
      const value = list.length === 1 ? list[0] : list[index % list.length];
      if (value != null) entry[field] = collapse(stripQuotes(value), 100);
    }

    if (!entry.property || entry.property.toLowerCase() === 'none') continue;
    entry.durationMs = parseCssTime(entry.duration, customProps);
    entries.push(entry);
  }

  return entries;
}

function parseTypography(rule) {
  const decls = effectiveDecls(rule, TYPOGRAPHY_PROPS);
  if (!decls.size) return null;

  const read = (prop, maxLength) => {
    const value = decls.get(prop)?.value;
    return value ? collapse(value, maxLength) : '';
  };

  const entry = {
    size: read('font-size', 60),
    family: read('font-family', 120),
    weight: read('font-weight', 30),
    style: read('font-style', 30),
    lineHeight: read('line-height', 40),
    letterSpacing: read('letter-spacing', 40),
    transform: read('text-transform', 30),
    align: read('text-align', 30),
    features: read('font-feature-settings', 80),
  };

  if (!entry.size && !entry.family && !entry.weight) return null;
  return entry;
}

function cleanFamily(value) {
  const family = collapse(stripQuotes(value), 90);
  if (!family || family.includes('var(')) return '';
  if (GENERIC_FONTS.has(family.toLowerCase())) return '';
  if (/^[0-9.]+$/.test(family)) return '';
  return family;
}

function fontType(url) {
  const match = FONT_EXT.exec(url);
  if (!match) return 'font';
  return match[0].replace(/[?#].*$/, '').replace('.', '');
}

function classifyUrl(url, prop) {
  if (FONT_EXT.test(url) || prop.includes('font')) return 'font';
  if (VIDEO_EXT.test(url)) return 'video';
  if (IMAGE_EXT.test(url)) return 'image';
  if (/(?:background|mask|border-image|cursor|content|list-style|shape-outside)/.test(prop)) {
    return 'image';
  }
  return 'file';
}

function safeSelectorFor(decl) {
  if (decl.parent?.type === 'rule') return cleanSelector(decl.parent.selector);
  return '';
}

function createState() {
  return {
    keyframes: [],
    keyframesTotal: 0,
    keyframeNames: new Set(),
    keyframeUsage: new Map(),
    keyframeSamples: new Map(),
    animationUses: [],
    animationUsesTotal: 0,
    animatedSelectors: new Set(),
    transitions: [],
    transitionsTotal: 0,
    transitionedSelectors: new Set(),
    easings: new Map(),
    durations: [],
    reducedMotion: {
      mediaBlocks: 0,
      disablesMotion: 0,
      sources: [],
    },
    typography: {
      rules: [],
      rulesTotal: 0,
      weights: new Map(),
      lineHeights: new Map(),
      letterSpacings: new Map(),
      transforms: new Map(),
    },
    scroll: {
      animationTimelineUses: 0,
      timelineSelectors: [],
      timelineUses: [],
      ranges: new Map(),
      scrollTimelines: 0,
      definedTimelines: [],
      smoothScrolling: 0,
      scrollSnap: 0,
      snapTypes: new Map(),
      viewTransitions: 0,
      stickyRules: 0,
      stickySelectors: [],
      fixedBackgrounds: 0,
      supportsAnimationTimeline: 0,
    },
    design: {
      colors: new Map(),
      fonts: new Map(),
      fontEvidence: new Map(),
      fontFaces: [],
      radii: new Map(),
      shadows: new Map(),
      gradients: new Map(),
      customProps: new Map(),
      breakpoints: new Map(),
      fontSizes: new Map(),
      registeredProperties: 0,
      inlineStyleCount: 0,
    },
    assets: {
      cssAssets: new Map(),
      cssAssetsTotal: 0,
      fontAssets: new Map(),
      fontAssetsTotal: 0,
      animatedGifUrls: new Set(),
      backgroundVideoUrls: new Set(),
    },
  };
}

function addFont(state, family, evidence) {
  const cleaned = cleanFamily(family);
  if (!cleaned) return;
  addCount(state.design.fonts, cleaned);
  if (!state.design.fontEvidence.has(cleaned)) state.design.fontEvidence.set(cleaned, new Set());
  const set = state.design.fontEvidence.get(cleaned);
  if (evidence && set.size < 4) set.add(evidence);
}

function addColor(state, value) {
  const cleaned = collapse(value, 80);
  if (!cleaned || cleaned.length > 60) return;
  addCount(state.design.colors, cleaned.toLowerCase());
}

function addFontAsset(state, url, details = {}) {
  if (!url) return;
  const existing = state.assets.fontAssets.get(url);
  if (existing) {
    existing.count += 1;
    return;
  }
  state.assets.fontAssetsTotal += 1;
  if (state.assets.fontAssets.size >= MAX_FONT_ASSETS) return;
  state.assets.fontAssets.set(url, {
    url,
    family: details.family || '',
    weight: details.weight || '',
    style: details.style || '',
    format: details.format || fontType(url),
    source: details.source || '',
    count: 1,
  });
}

function addCssAsset(state, url, details) {
  const existing = state.assets.cssAssets.get(url);
  if (existing) {
    existing.count += 1;
    return;
  }
  state.assets.cssAssetsTotal += 1;
  if (state.assets.cssAssets.size >= MAX_CSS_ASSETS) return;
  state.assets.cssAssets.set(url, {
    url,
    type: details.type || 'file',
    property: details.property || '',
    context: details.context || '',
    source: details.source || '',
    count: 1,
  });
}

function collectUrls(state, value, source, prop, context, inFontFace, fontDetails = {}) {
  if (!value || !value.includes('url(')) return;
  URL_RE.lastIndex = 0;
  let match;
  while ((match = URL_RE.exec(value))) {
    const raw = match[2].trim();
    if (!raw || /^(?:data|blob|javascript|about|#)/i.test(raw)) continue;
    const resolved = toHttpUrl(raw, source.baseUrl);
    if (!resolved) continue;
    if (inFontFace) {
      addFontAsset(state, resolved, {
        ...fontDetails,
        source: source.label,
      });
      continue;
    }
    const type = classifyUrl(resolved, prop);
    if (type === 'font') {
      addFontAsset(state, resolved, { source: source.label, ...fontDetails });
      continue;
    }
    if (type === 'video') state.assets.backgroundVideoUrls.add(resolved);
    if (GIF_EXT.test(resolved)) state.assets.animatedGifUrls.add(resolved);
    addCssAsset(state, resolved, {
      type,
      property: prop,
      context: collapse(context, 120),
      source: source.label,
    });
  }
}

function parseFontFace(atRule, source, state) {
  const props = {};
  atRule.walkDecls((decl) => {
    props[decl.prop.toLowerCase()] = decl.value.trim();
  });

  const family = cleanFamily(props['font-family'] || '');
  const weight = collapse(props['font-weight'] || '', 30);
  const style = collapse(props['font-style'] || '', 30);
  const display = collapse(props['font-display'] || '', 30);
  const src = props.src || '';
  const urls = [];
  URL_RE.lastIndex = 0;
  let match;
  while ((match = URL_RE.exec(src))) {
    const resolved = toHttpUrl(match[2], source.baseUrl);
    if (resolved) urls.push(resolved);
  }
  const formats = [...src.matchAll(/format\(\s*['"]?([^'")]+)/gi)].map((item) => item[1]);

  urls.forEach((url, index) => {
    addFontAsset(state, url, {
      family,
      weight,
      style,
      format: formats[index] || fontType(url),
      source: source.label,
    });
  });

  if (family) addFont(state, family, `@font-face · ${source.label}`);

  if (state.design.fontFaces.length >= MAX_FONT_FACES) return;
  state.design.fontFaces.push({
    family: family || 'Unnamed family',
    src: urls[0] || '',
    sources: urls.slice(0, 6),
    formats: formats.slice(0, 6),
    weight,
    style,
    display,
    source: source.label,
  });
}

function collectDesignDeclaration(state, decl, source, options = {}) {
  if (decl.type !== 'decl') return;
  const normalized = normalizeProp(decl.prop);
  const prop = normalized.prop;
  const value = decl.value.trim();
  const inFontFace = options.inFontFace || false;
  const selector = options.selector || safeSelectorFor(decl);

  if (!inFontFace) {
    const forColor = value.replace(URL_RE, ' ').replace(/"[^"]*"|'[^']*'/g, ' ');
    COLOR_RE.lastIndex = 0;
    let match;
    while ((match = COLOR_RE.exec(forColor))) {
      addColor(state, match[0]);
    }

    if (prop === 'font-family') {
      const families = splitTopLevel(value, ',');
      for (const family of families) addFont(state, family, `CSS · ${source.label}`);
    }

    if (prop === 'font-size') {
      addCount(state.design.fontSizes, collapse(value, 60));
    }

    if (prop.includes('border-radius')) {
      addCount(state.design.radii, collapse(value, 70));
    }

    if (prop === 'box-shadow' || prop === 'text-shadow') {
      addCount(state.design.shadows, collapse(value, 190));
    }

    if (value.includes('gradient(')) {
      addCount(state.design.gradients, collapse(value, 230));
    }

    collectUrls(state, value, source, prop, selector, false);

    if (prop.startsWith('--')) {
      const existing = state.design.customProps.get(prop);
      if (existing) existing.count += 1;
      else if (state.design.customProps.size < 250) {
        state.design.customProps.set(prop, { name: prop, value: collapse(value, 180), count: 1 });
      }
    }
  }
}

function registerKeyframes(root, source, state) {
  root.walkAtRules((atRule) => {
    const name = atRule.name.toLowerCase();
    if (!name.endsWith('keyframes')) return;
    const keyframeName = stripQuotes(collapse(atRule.params, 120));
    if (!keyframeName) return;

    state.keyframesTotal += 1;
    state.keyframeNames.add(keyframeName);
    if (state.keyframes.length >= MAX_KEYFRAMES) return;

    const frames = [];
    const properties = new Set();
    atRule.walkRules((rule) => {
      frames.push(collapse(rule.selector, 40));
      rule.walkDecls((decl) => {
        properties.add(normalizeProp(decl.prop).prop);
      });
    });

    state.keyframes.push({
      name: keyframeName,
      frames: frames.length,
      frameSelectors: frames.slice(0, 14),
      properties: [...properties].slice(0, 12),
      source: source.label,
      sourceUrl: source.url || null,
      line: atRule.source?.start?.line || null,
    });
  });
}

function registerAtRules(root, source, state) {
  root.walkAtRules((atRule) => {
    const name = atRule.name.toLowerCase();
    if (name === 'media') {
      const params = atRule.params || '';
      const breakpointMatches = params.matchAll(/(?:min|max)-width\s*:\s*([0-9.]+(?:px|em|rem))/gi);
      for (const match of breakpointMatches) addCount(state.design.breakpoints, match[1].toLowerCase());

      if (/prefers-reduced-motion/i.test(params)) {
        state.reducedMotion.mediaBlocks += 1;
        if (state.reducedMotion.sources.length < 8 && !state.reducedMotion.sources.includes(source.label)) {
          state.reducedMotion.sources.push(source.label);
        }
        const text = atRule.toString();
        if (
          /(?:animation|transition)(?:-(?:duration|name))?\s*:\s*(?:none|0(?:\.0+)?m?s)\b/i.test(text)
        ) {
          state.reducedMotion.disablesMotion += 1;
        }
      }
    }

    if (name === 'supports' && /animation-timeline|scroll-timeline|view-timeline/i.test(atRule.params || '')) {
      state.scroll.supportsAnimationTimeline += 1;
    }

    if (name === 'property') {
      state.design.registeredProperties += 1;
    }

    if (name === 'font-face') {
      parseFontFace(atRule, source, state);
    }
  });
}

function processRule(rule, source, state, selectorOverride = '') {
  const selector = collapse(selectorOverride || rule.selector, 240);
  if (!selector) return;
  const media = mediaContext(rule);
  const line = rule.source?.start?.line || null;

  const animations = parseAnimations(rule, state.design.customProps);
  for (const animation of animations) {
    state.animationUsesTotal += 1;
    state.animatedSelectors.add(selector);
    const name = animation.name;
    state.keyframeUsage.set(name, (state.keyframeUsage.get(name) || 0) + 1);
    if (!state.keyframeSamples.has(name)) state.keyframeSamples.set(name, []);
    const samples = state.keyframeSamples.get(name);
    if (samples.length < 6) {
      samples.push({
        selector,
        duration: animation.duration,
        durationMs: animation.durationMs,
        timing: animation.timing,
        media,
        source: source.label,
      });
    }
    if (animation.timing && !animation.timing.includes('var(')) {
      addCount(state.easings, animation.timing);
    }
    if (animation.durationMs != null) state.durations.push(animation.durationMs);

    if (state.animationUses.length < MAX_ANIMATION_USES) {
      state.animationUses.push({
        ...animation,
        selector,
        media,
        source: source.label,
        sourceUrl: source.url || null,
        line,
      });
    }
  }

  const transitions = parseTransitions(rule, state.design.customProps);
  for (const transition of transitions) {
    state.transitionsTotal += 1;
    state.transitionedSelectors.add(selector);
    if (transition.timing && !transition.timing.includes('var(')) {
      addCount(state.easings, transition.timing);
    }
    if (transition.durationMs != null) state.durations.push(transition.durationMs);

    if (state.transitions.length < MAX_TRANSITION_USES) {
      state.transitions.push({
        ...transition,
        selector,
        media,
        source: source.label,
        sourceUrl: source.url || null,
        line,
      });
    }
  }

  const typography = parseTypography(rule);
  if (typography) {
    state.typography.rulesTotal += 1;
    if (typography.weight && typography.weight !== 'normal' && !typography.weight.includes('var(')) {
      addCount(state.typography.weights, typography.weight);
    }
    if (typography.lineHeight && !typography.lineHeight.includes('var(')) {
      addCount(state.typography.lineHeights, typography.lineHeight);
    }
    if (typography.letterSpacing && typography.letterSpacing.toLowerCase() !== 'normal') {
      addCount(state.typography.letterSpacings, typography.letterSpacing);
    }
    if (typography.transform && typography.transform.toLowerCase() !== 'none') {
      addCount(state.typography.transforms, typography.transform);
    }
    if (state.typography.rules.length < MAX_TYPOGRAPHY_RULES) {
      state.typography.rules.push({
        ...typography,
        selector,
        media,
        source: source.label,
        line,
      });
    }
  }

  rule.walkDecls((decl) => {
    const { prop } = normalizeProp(decl.prop);
    const value = decl.value.trim().toLowerCase();
    if (!value || value === 'none' || value === 'normal' || value === 'initial') return;

    const sibling = (name) =>
      (rule.nodes || []).find(
        (node) => node.type === 'decl' && normalizeProp(node.prop).prop === name,
      );

    if (prop === 'animation-timeline') {
      state.scroll.animationTimelineUses += 1;
      if (state.scroll.timelineSelectors.length < 12) {
        state.scroll.timelineSelectors.push(selector);
      }
      if (state.scroll.timelineUses.length < 16) {
        const rangeDecl = sibling('animation-range');
        const entry = {
          selector: collapse(selector, 160),
          timeline: collapse(decl.value.trim(), 80),
          range: rangeDecl ? collapse(rangeDecl.value.trim(), 60) : '',
          source: source.label,
        };
        const duplicate = state.scroll.timelineUses.some(
          (existing) =>
            existing.selector === entry.selector &&
            existing.timeline === entry.timeline &&
            existing.range === entry.range,
        );
        if (!duplicate) state.scroll.timelineUses.push(entry);
      }
    }
    if (
      prop === 'animation-range' ||
      prop === 'animation-range-start' ||
      prop === 'animation-range-end'
    ) {
      addCount(state.scroll.ranges, collapse(decl.value.trim(), 60));
    }
    if (prop === 'scroll-timeline-name' || prop === 'view-timeline-name') {
      state.scroll.scrollTimelines += 1;
      if (state.scroll.definedTimelines.length < 12) {
        state.scroll.definedTimelines.push(`${prop}: ${collapse(decl.value.trim(), 70)}`);
      }
    }
    if (prop === 'scroll-behavior' && value.includes('smooth')) {
      state.scroll.smoothScrolling += 1;
    }
    if (prop === 'scroll-snap-type') {
      state.scroll.scrollSnap += 1;
      addCount(state.scroll.snapTypes, collapse(decl.value.trim(), 50));
    }
    if (prop === 'view-transition-name') {
      state.scroll.viewTransitions += 1;
    }
    if (prop === 'position' && value === 'sticky') {
      state.scroll.stickyRules += 1;
      if (state.scroll.stickySelectors.length < 16) {
        const offsetDecl = (rule.nodes || []).find(
          (node) =>
            node.type === 'decl' &&
            ['top', 'bottom', 'inset-block-start', 'inset-block-end'].includes(
              normalizeProp(node.prop).prop,
            ),
        );
        state.scroll.stickySelectors.push({
          selector: collapse(selector, 160),
          offset: offsetDecl ? collapse(offsetDecl.value.trim(), 40) : '',
        });
      }
    }
    if (prop === 'background-attachment' && value === 'fixed') {
      state.scroll.fixedBackgrounds += 1;
    }
  });
}

function processRoot(root, source, state) {
  registerKeyframes(root, source, state);
  registerAtRules(root, source, state);

  root.walkRules((rule) => {
    if (inAtRule(rule, ['keyframes', 'font-face'])) return;
    processRule(rule, source, state);
  });

  root.walkDecls((decl) => {
    const inFontFace = Boolean(ancestorAtRule(decl, (name) => name === 'font-face'));
    collectDesignDeclaration(state, decl, source, { inFontFace });
  });
}

function processInlineStyles(inlineStyles, pageBase, state) {
  for (const item of inlineStyles) {
    const source = {
      label: 'Element style',
      url: null,
      baseUrl: pageBase,
    };
    let root;
    try {
      root = parseCssRoot(`webcopy-inline { ${item.css} }`);
    } catch {
      continue;
    }
    if (!root) continue;
    const selector = item.selector || 'inline element';
    root.walkRules((rule) => {
      processRule(rule, source, state, selector);
    });
    root.walkDecls((decl) => {
      collectDesignDeclaration(state, decl, source, { selector });
    });
  }
}

function gatherCustomProperties(root, state) {
  root.walkDecls((decl) => {
    if (!decl.prop.startsWith('--')) return;
    const existing = state.design.customProps.get(decl.prop);
    if (existing) existing.count += 1;
    else if (state.design.customProps.size < 250) {
      state.design.customProps.set(decl.prop, {
        name: decl.prop,
        value: collapse(decl.value, 180),
        count: 1,
      });
    }
  });
}

function computeMedian(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function buildResult(state) {
  const keyframes = state.keyframes.map((keyframe) => {
    const usedBy = state.keyframeSamples.get(keyframe.name) || [];
    return {
      ...keyframe,
      usedCount: state.keyframeUsage.get(keyframe.name) || 0,
      usedBy: usedBy.slice(0, 6),
    };
  });

  const durations = state.durations.filter((item) => Number.isFinite(item) && item >= 0);
  const durationStats = durations.length
    ? {
        count: durations.length,
        medianMs: computeMedian(durations),
        minMs: Math.min(...durations),
        maxMs: Math.max(...durations),
      }
    : null;

  const colors = sortedCounts(state.design.colors, 36).map(({ value, count }) => ({
    value,
    count,
    type: value.startsWith('#') ? 'hex' : value.startsWith('hsl') ? 'hsl' : 'rgb',
  }));

  const fonts = sortedCounts(state.design.fonts, 18).map(({ value, count }) => ({
    family: value,
    count,
    evidence: [...(state.design.fontEvidence.get(value) || [])],
  }));

  const breakpoints = [...state.design.breakpoints.entries()]
    .sort((a, b) => {
      const aNumber = Number.parseFloat(a[0]);
      const bNumber = Number.parseFloat(b[0]);
      return (Number.isFinite(aNumber) ? aNumber : 9999) - (Number.isFinite(bNumber) ? bNumber : 9999);
    })
    .slice(0, 20)
    .map(([value, count]) => ({ value, count }));

  return {
    keyframes,
    keyframesTotal: state.keyframesTotal,
    keyframeNames: state.keyframeNames.size,
    animationUses: state.animationUses,
    animationUsesTotal: state.animationUsesTotal,
    animatedSelectors: state.animatedSelectors.size,
    transitions: state.transitions,
    transitionsTotal: state.transitionsTotal,
    transitionedSelectors: state.transitionedSelectors.size,
    easings: sortedCounts(state.easings, 12).map(({ value, count }) => ({ value, count })),
    durationStats,
    reducedMotion: {
      mediaBlocks: state.reducedMotion.mediaBlocks,
      disablesMotion: state.reducedMotion.disablesMotion,
      sources: state.reducedMotion.sources,
    },
    scroll: {
      animationTimelineUses: state.scroll.animationTimelineUses,
      timelineSelectors: state.scroll.timelineSelectors.slice(0, 10),
      timelineUses: state.scroll.timelineUses.slice(0, 16),
      ranges: sortedCounts(state.scroll.ranges, 10),
      scrollTimelines: state.scroll.scrollTimelines,
      definedTimelines: state.scroll.definedTimelines.slice(0, 12),
      smoothScrolling: state.scroll.smoothScrolling,
      scrollSnap: state.scroll.scrollSnap,
      snapTypes: sortedCounts(state.scroll.snapTypes, 6),
      viewTransitions: state.scroll.viewTransitions,
      stickyRules: state.scroll.stickyRules,
      stickySelectors: state.scroll.stickySelectors.slice(0, 16),
      fixedBackgrounds: state.scroll.fixedBackgrounds,
      supportsAnimationTimeline: state.scroll.supportsAnimationTimeline,
    },
    design: {
      colors,
      colorTotal: state.design.colors.size,
      fonts,
      fontTotal: state.design.fonts.size,
      fontFaces: state.design.fontFaces,
      radii: sortedCounts(state.design.radii, 14),
      shadows: sortedCounts(state.design.shadows, 8),
      gradients: sortedCounts(state.design.gradients, 10),
      customProperties: [...state.design.customProps.values()]
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 80),
      breakpoints,
      fontSizes: sortedCounts(state.design.fontSizes, 14),
      typography: {
        rules: state.typography.rules,
        rulesTotal: state.typography.rulesTotal,
        weights: sortedCounts(state.typography.weights, 12),
        lineHeights: sortedCounts(state.typography.lineHeights, 14),
        letterSpacings: sortedCounts(state.typography.letterSpacings, 14),
        transforms: sortedCounts(state.typography.transforms, 8),
      },
      registeredProperties: state.design.registeredProperties,
      inlineStyleCount: state.design.inlineStyleCount,
    },
    cssAssets: [...state.assets.cssAssets.values()].slice(0, 180),
    cssAssetsTotal: state.assets.cssAssetsTotal,
    fontAssets: [...state.assets.fontAssets.values()].slice(0, MAX_FONT_ASSETS),
    fontAssetsTotal: state.assets.fontAssetsTotal,
    animatedGifUrls: [...state.assets.animatedGifUrls],
    backgroundVideoUrls: [...state.assets.backgroundVideoUrls],
    limits: {
      keyframes: state.keyframesTotal > MAX_KEYFRAMES,
      animations: state.animationUsesTotal > MAX_ANIMATION_USES,
      transitions: state.transitionsTotal > MAX_TRANSITION_USES,
      cssAssets: state.assets.cssAssetsTotal > MAX_CSS_ASSETS,
      fontFaces: state.design.fontFaces.length >= MAX_FONT_FACES,
      typography: state.typography.rulesTotal > MAX_TYPOGRAPHY_RULES,
    },
  };
}

/**
 * Parse stylesheet sources and inline style attributes into a normalized design
 * + motion model. No network access happens here.
 */
export function analyzeStyles(cssSources = [], inlineStyles = [], options = {}) {
  const { pageBase = '', warnings = [], inlineStyleCount = inlineStyles.length } = options;
  const state = createState();
  state.design.inlineStyleCount = inlineStyleCount;

  const parsed = [];
  for (const rawSource of cssSources) {
    if (!rawSource?.content) continue;
    const source = {
      ...rawSource,
      label: rawSource.label || basenameFromUrl(rawSource.url, 'stylesheet'),
      baseUrl: rawSource.baseUrl || rawSource.url || pageBase,
    };
    const root = parseCssRoot(source.content);
    if (!root) {
      warnings.push(`A stylesheet could not be parsed and was skipped: ${source.label}.`);
      continue;
    }
    parsed.push({ source, root });
  }

  for (const { root } of parsed) gatherCustomProperties(root, state);

  for (const { source, root } of parsed) {
    processRoot(root, source, state);
  }

  processInlineStyles(inlineStyles, pageBase, state);

  return buildResult(state);
}
