import { mergeSignals } from './analyzer-utils.js';

const SIGNAL_DEFINITIONS = [
  {
    key: 'raf',
    label: 'requestAnimationFrame loops',
    category: 'Loop',
    regex: /requestAnimationFrame\s*\(/g,
  },
  {
    key: 'interval',
    label: 'setInterval loops',
    category: 'Loop',
    regex: /\bsetInterval\s*\(/g,
  },
  {
    key: 'waapi',
    label: 'Web Animations API calls',
    category: 'API',
    regex: /\.animate\s*\(/g,
  },
  {
    key: 'keyframeEffect',
    label: 'KeyframeEffect construction',
    category: 'API',
    regex: /new\s+KeyframeEffect\s*\(/g,
  },
  {
    key: 'intersectionObserver',
    label: 'IntersectionObserver triggers',
    category: 'Observer',
    regex: /new\s+IntersectionObserver\s*\(/g,
  },
  {
    key: 'scrollTrigger',
    label: 'ScrollTrigger references',
    category: 'Scroll',
    regex: /\bScrollTrigger\b/g,
  },
  {
    key: 'scrollListeners',
    label: 'Scroll / wheel listeners',
    category: 'Scroll',
    regex: /addEventListener\s*\(\s*['"](?:scroll|wheel)/g,
  },
  {
    key: 'pointerTracking',
    label: 'Pointer / mouse tracking',
    category: 'Input',
    regex: /\b(?:mousemove|pointermove|mousedown|touchmove|deviceorientation)\b/g,
  },
  {
    key: 'transformWrites',
    label: 'Inline transform writes',
    category: 'DOM',
    regex: /\.style\.(?:transform|translate|rotate|scale|top|left)\s*=/g,
  },
  {
    key: 'cssVarWrites',
    label: 'CSS custom property writes',
    category: 'DOM',
    regex: /style\.setProperty\s*\(\s*['"]--|documentElement\.style\.setProperty/g,
  },
  {
    key: 'rectReads',
    label: 'Layout reads (getBoundingClientRect)',
    category: 'DOM',
    regex: /getBoundingClientRect\s*\(/g,
  },
  {
    key: 'animationEvents',
    label: 'Animation & transition events',
    category: 'Events',
    regex: /['"](?:animationend|animationstart|animationiteration|transitionend|transitionstart|transitioncancel)['"]/g,
  },
  {
    key: 'reducedMotion',
    label: 'prefers-reduced-motion checks',
    category: 'Accessibility',
    regex: /prefers-reduced-motion/g,
  },
  {
    key: 'viewTransitions',
    label: 'View Transition API calls',
    category: 'API',
    regex: /startViewTransition\s*\(/g,
  },
  {
    key: 'scrollTimeline',
    label: 'ScrollTimeline / ViewTimeline',
    category: 'API',
    regex: /\b(?:ScrollTimeline|ViewTimeline|scrollTimeline|viewTimeline)\b/g,
  },
  {
    key: 'canvas2d',
    label: 'Canvas 2D contexts',
    category: 'Render',
    regex: /getContext\s*\(\s*['"]2d['"]/g,
  },
  {
    key: 'webgl',
    label: 'WebGL contexts',
    category: 'Render',
    regex: /getContext\s*\(\s*['"](?:webgl2?|experimental-webgl)['"]/g,
  },
  {
    key: 'shader',
    label: 'Shader source references',
    category: 'Render',
    regex: /\b(?:fragmentShader|vertexShader|shaderMaterial|ShaderMaterial)\b/g,
  },
  {
    key: 'svgDraw',
    label: 'SVG path drawing',
    category: 'Render',
    regex: /getTotalLength\s*\(|strokeDasharray\s*=|strokeDashoffset\s*=/g,
  },
  {
    key: 'customEasing',
    label: 'Custom easing / spring functions',
    category: 'Easing',
    regex: /\b(?:spring|cubicBezier|cubic-bezier|easeInOut|easeOut|easeIn)\b/g,
  },
];

const LIBRARY_DEFINITIONS = [
  {
    key: 'gsap',
    name: 'GSAP',
    category: 'Animation engine',
    patterns: [/\bgsap\b/i, /\bTweenMax\b/, /\bTweenLite\b/, /\bTimelineMax\b/, /\bScrollTrigger\b/, /\bSplitText\b/],
  },
  {
    key: 'anime',
    name: 'anime.js',
    category: 'Animation engine',
    patterns: [/\banime\s*[.(]/, /\banime\.timeline\b/, /animejs/i],
  },
  {
    key: 'motion',
    name: 'Motion / Framer Motion',
    category: 'Animation engine',
    patterns: [/framer-motion/i, /motion\/react/i, /from\s+['"]motion['"]/, /\bmotion\.div\b/],
  },
  {
    key: 'three',
    name: 'Three.js',
    category: '3D / WebGL',
    patterns: [/\bTHREE\.[A-Z]/, /three(?:\.module)?(?:\.min)?\.js/i, /three@/i],
  },
  {
    key: 'pixi',
    name: 'PixiJS',
    category: '3D / WebGL',
    patterns: [/\bPIXI\./, /pixi(?:\.min)?\.js/i],
  },
  {
    key: 'p5',
    name: 'p5.js',
    category: 'Creative coding',
    patterns: [/\bnew\s+p5\s*\(/, /p5(?:\.min)?\.js/i],
  },
  {
    key: 'd3',
    name: 'D3.js',
    category: 'Data + motion',
    patterns: [/\bd3\.(?:select|selectAll|transition|timeline|ease)/, /d3(?:\.min)?\.js/i],
  },
  {
    key: 'matter',
    name: 'Matter.js',
    category: 'Physics',
    patterns: [/\bMatter\.Engine\b/, /matter(?:\.min)?\.js/i],
  },
  {
    key: 'lottie',
    name: 'Lottie',
    category: 'Vector animation',
    patterns: [/lottie\.loadAnimation/i, /\bbodymovin\b/i, /lottie-web/i, /lottie-player/i],
  },
  {
    key: 'rive',
    name: 'Rive',
    category: 'Vector animation',
    patterns: [/\bnew\s+rive\./i, /@rive-app\//i, /rive\.wasm/i],
  },
  {
    key: 'aos',
    name: 'AOS',
    category: 'Scroll reveal',
    patterns: [/AOS\.init/i, /data-aos/i, /aos\.js/i],
  },
  {
    key: 'scrollreveal',
    name: 'ScrollReveal',
    category: 'Scroll reveal',
    patterns: [/\bScrollReveal\b/, /scrollreveal/i],
  },
  {
    key: 'locomotive',
    name: 'Locomotive Scroll',
    category: 'Smooth scroll',
    patterns: [/LocomotiveScroll/, /locomotive-scroll/i],
  },
  {
    key: 'lenis',
    name: 'Lenis',
    category: 'Smooth scroll',
    patterns: [/\bLenis\b/, /studio-freight\/lenis/i, /lenis\/dist/i],
  },
  {
    key: 'rellax',
    name: 'Rellax',
    category: 'Parallax',
    patterns: [/\bRellax\b/, /rellax(?:\.min)?\.js/i],
  },
  {
    key: 'simpleParallax',
    name: 'simpleParallax',
    category: 'Parallax',
    patterns: [/new\s+simpleParallax/i, /simple-parallax/i],
  },
  {
    key: 'scrollmagic',
    name: 'ScrollMagic',
    category: 'Scroll orchestration',
    patterns: [/\bScrollMagic\b/, /scrollmagic/i],
  },
  {
    key: 'barba',
    name: 'Barba.js',
    category: 'Page transitions',
    patterns: [/barba\.init/i, /@barba\//i, /barba(?:\.min)?\.js/i],
  },
  {
    key: 'swiper',
    name: 'Swiper',
    category: 'Slideshow',
    patterns: [/new\s+Swiper\b/, /swiper-bundle/i, /swiper\/swiper/i],
  },
  {
    key: 'splide',
    name: 'Splide',
    category: 'Slideshow',
    patterns: [/new\s+Splide\b/, /splide(?:\.min)?\.js/i],
  },
  {
    key: 'embla',
    name: 'Embla Carousel',
    category: 'Slideshow',
    patterns: [/EmblaCarousel/, /embla-carousel/i],
  },
  {
    key: 'flickity',
    name: 'Flickity',
    category: 'Slideshow',
    patterns: [/new\s+Flickity\b/, /flickity(?:\.pkgd)?(?:\.min)?\.js/i],
  },
  {
    key: 'slick',
    name: 'Slick Carousel',
    category: 'Slideshow',
    patterns: [/\.slick\s*\(/, /slick(?:\.min)?\.js/i],
  },
  {
    key: 'fullpage',
    name: 'fullPage.js',
    category: 'Scroll orchestration',
    patterns: [/new\s+fullpage/i, /fullpage(?:\.min)?\.js/i],
  },
  {
    key: 'velocity',
    name: 'Velocity.js',
    category: 'Animation engine',
    patterns: [/\bVelocity\s*\(/, /velocity(?:\.min)?\.js/i],
  },
  {
    key: 'typed',
    name: 'Typed.js',
    category: 'Text animation',
    patterns: [/new\s+Typed\s*\(/, /typed(?:\.min)?\.js/i],
  },
  {
    key: 'vivus',
    name: 'Vivus',
    category: 'SVG animation',
    patterns: [/new\s+Vivus\b/, /vivus(?:\.min)?\.js/i],
  },
  {
    key: 'roughnotation',
    name: 'RoughNotation',
    category: 'Annotation',
    patterns: [/\bRoughNotation\b/, /rough-notation/i],
  },
  {
    key: 'atropos',
    name: 'Atropos',
    category: '3D interaction',
    patterns: [/\bAtropos\b/, /atropos(?:\.min)?\.js/i],
  },
  {
    key: 'vanillatilt',
    name: 'Vanilla-tilt',
    category: '3D interaction',
    patterns: [/VanillaTilt/, /vanilla-tilt/i],
  },
  {
    key: 'wow',
    name: 'WOW.js',
    category: 'Scroll reveal',
    patterns: [/new\s+WOW\b/, /wow(?:\.min)?\.js/i, /data-wow-/i],
  },
  {
    key: 'sal',
    name: 'Sal.js',
    category: 'Scroll reveal',
    patterns: [/\bsal\s*\(\s*\{/, /sal(?:\.min)?\.js/i, /data-sal=/i],
  },
  {
    key: 'jquery',
    name: 'jQuery',
    category: 'DOM toolkit',
    patterns: [/\bjQuery\b/, /jquery(?:-\d+(?:\.\d+)*)?(?:\.min)?\.js/i],
  },
];

function cloneRegex(regex, { global = false } = {}) {
  let flags = regex.flags.replace(/g|y/g, '');
  if (global) flags += 'g';
  return new RegExp(regex.source, flags);
}

function countMatches(regex, text) {
  if (!text) return 0;
  const re = cloneRegex(regex, { global: true });
  let count = 0;
  let match;
  while ((match = re.exec(text))) {
    count += 1;
    if (count > 20000) break;
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return count;
}

function labelForSource(source) {
  return source.label || source.url || 'inline script';
}

/**
 * Look for animation engines, browser animation APIs and interaction triggers
 * across every script we could read, plus motion markers in the markup.
 */
export function analyzeScripts(jsSources, { motionMarkup, html = '' } = {}) {
  const signalMap = new Map();
  const libraries = new Map();
  let reducedMotionChecks = 0;

  for (const source of jsSources) {
    const label = labelForSource(source);
    const content = source.content || '';
    const haystack = `${source.url || ''}\n${content}`;
    if (!haystack.trim()) continue;

    for (const signal of SIGNAL_DEFINITIONS) {
      const count = countMatches(signal.regex, haystack);
      if (!count) continue;
      if (signal.key === 'reducedMotion') reducedMotionChecks += count;
      mergeSignals(signalMap, signal.key, signal.label, signal.category, count, label);
    }

    for (const library of LIBRARY_DEFINITIONS) {
      let matched = false;
      let hits = 0;
      for (const pattern of library.patterns) {
        const count = countMatches(pattern, haystack);
        if (count) {
          matched = true;
          hits += count;
        }
      }
      if (!matched) continue;
      const existing = libraries.get(library.key) || {
        key: library.key,
        name: library.name,
        category: library.category,
        sources: [],
        hits: 0,
      };
      existing.hits += hits;
      if (!existing.sources.includes(label) && existing.sources.length < 5) {
        existing.sources.push(label);
      }
      libraries.set(library.key, existing);
    }
  }

  if (motionMarkup) {
    for (const entry of motionMarkup.dataAttributes) {
      if (entry.name === 'data-aos' && !libraries.has('aos')) {
        libraries.set('aos', {
          key: 'aos',
          name: 'AOS',
          category: 'Scroll reveal',
          sources: ['HTML attributes'],
          hits: entry.count,
        });
      }
      if (entry.name.startsWith('data-wow') && !libraries.has('wow')) {
        libraries.set('wow', {
          key: 'wow',
          name: 'WOW.js',
          category: 'Scroll reveal',
          sources: ['HTML attributes'],
          hits: entry.count,
        });
      }
      mergeSignals(
        signalMap,
        `markup:${entry.name}`,
        entry.name,
        'Markup',
        entry.count,
        'HTML attributes',
      );
    }

    if (motionMarkup.motionEventHandlers > 0) {
      mergeSignals(
        signalMap,
        'markup:inline-events',
        'Inline pointer / scroll handlers',
        'Markup',
        motionMarkup.motionEventHandlers,
        'HTML attributes',
      );
    }
  }

  // A few page-level signals that only exist in the raw document.
  if (/<canvas[\s>]/i.test(html)) {
    mergeSignals(signalMap, 'markup:canvas', '<canvas> elements', 'Markup', 1, 'HTML');
  }
  if (/<marquee[\s>]/i.test(html)) {
    mergeSignals(signalMap, 'markup:marquee', '<marquee> elements', 'Markup', 1, 'HTML');
  }

  const signals = [...signalMap.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 40);

  const libraryList = [...libraries.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 24);

  const triggersTotal = signals.reduce((sum, signal) => sum + signal.count, 0);

  const scrollTriggerCount = signalMap.get('scrollTrigger')?.count || 0;
  const scrollListenerCount = signalMap.get('scrollListeners')?.count || 0;
  const scrollTimelineCount = signalMap.get('scrollTimeline')?.count || 0;

  return {
    signals,
    libraries: libraryList,
    reducedMotionChecks,
    triggersTotal,
    scrollTriggerCount,
    scrollListenerCount,
    scrollTimelineCount,
    webglContexts: signalMap.get('webgl')?.count || 0,
  };
}
