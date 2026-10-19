import { collapse } from './analyzer-utils.js';

const DEFINITIONS = [
  {
    name: 'Next.js',
    category: 'Framework',
    sources: ['html', 'urls'],
    patterns: [/__NEXT_DATA__/, /\/_next\/static\//i],
  },
  {
    name: 'React',
    category: 'Framework',
    sources: ['html', 'js', 'urls'],
    patterns: [/data-reactroot/, /__REACT_DEVTOOLS_GLOBAL_HOOK__/, /react-dom(?:\.production)?(?:\.min)?\.js/i, /react@\d/i],
  },
  {
    name: 'Vue',
    category: 'Framework',
    sources: ['html', 'js', 'urls'],
    patterns: [/data-v-[0-9a-f]{8}/i, /__VUE__/, /vue(?:\.runtime)?(?:\.global)?(?:\.prod)?(?:\.min)?\.js/i],
  },
  {
    name: 'Nuxt',
    category: 'Framework',
    sources: ['html', 'urls'],
    patterns: [/__NUXT__/, /\/_nuxt\//i],
  },
  {
    name: 'Svelte',
    category: 'Framework',
    sources: ['html', 'js', 'urls'],
    patterns: [/__sveltekit/i, /svelte-[a-z0-9]{6}/i, /svelte(?:\.min)?\.js/i],
  },
  {
    name: 'Astro',
    category: 'Framework',
    sources: ['html', 'urls'],
    patterns: [/astro-island/i, /data-astro-cid/i, /\/_astro\//i],
  },
  {
    name: 'Gatsby',
    category: 'Framework',
    sources: ['html', 'js', 'urls'],
    patterns: [/___gatsby/i, /gatsby-[a-z0-9]+(?:\.min)?\.js/i, /\/page-data\//i],
  },
  {
    name: 'Angular',
    category: 'Framework',
    sources: ['html', 'js', 'urls'],
    patterns: [/ng-version=/, /angular(?:\.min)?\.js/i],
  },
  {
    name: 'Qwik',
    category: 'Framework',
    sources: ['html'],
    patterns: [/qwikloader/i, /q:container/i],
  },
  {
    name: 'Remix',
    category: 'Framework',
    sources: ['html', 'js'],
    patterns: [/__remixContext/i, /__remixManifest/i],
  },
  {
    name: 'Ember',
    category: 'Framework',
    sources: ['html', 'js', 'urls'],
    patterns: [/ember-view/i, /ember(?:\.min)?\.js/i],
  },
  {
    name: 'WordPress',
    category: 'CMS',
    sources: ['html', 'urls'],
    patterns: [/wp-content\//i, /wp-includes\//i, /wp-json/i],
  },
  {
    name: 'Shopify',
    category: 'Commerce',
    sources: ['html', 'urls'],
    patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /shopify-section/i],
  },
  {
    name: 'Webflow',
    category: 'Site builder',
    sources: ['html', 'js', 'urls'],
    patterns: [/data-wf-page/i, /webflow(?:\.min)?\.js/i, /assets\.website-files\.com/i],
  },
  {
    name: 'Framer',
    category: 'Site builder',
    sources: ['html', 'urls'],
    patterns: [/data-framer/i, /framerusercontent\.com/i, /framer\.com\/sites/i],
  },
  {
    name: 'Wix',
    category: 'Site builder',
    sources: ['html', 'urls'],
    patterns: [/wixstatic\.com/i, /wix-image/i, /parastorage\.com/i],
  },
  {
    name: 'Squarespace',
    category: 'Site builder',
    sources: ['html', 'urls'],
    patterns: [/static1\.squarespace/i, /squarespace-cdn/i, /squarespace\.com/i],
  },
  {
    name: 'Ghost',
    category: 'CMS',
    sources: ['html', 'js', 'urls'],
    patterns: [/ghost-sdk/i, /ghost\.org\/sdk/i],
  },
  {
    name: 'Drupal',
    category: 'CMS',
    sources: ['html', 'urls'],
    patterns: [/drupal-settings-json/i, /\/sites\/default\/files\//i],
  },
  {
    name: 'HubSpot',
    category: 'CMS',
    sources: ['html', 'js', 'urls'],
    patterns: [/hs-scripts\.com/i, /hubspot/i],
  },
  {
    name: 'Tailwind CSS',
    category: 'Styling',
    sources: ['css', 'urls'],
    patterns: [/--tw-/, /tailwindcss/i],
  },
  {
    name: 'Bootstrap',
    category: 'Styling',
    sources: ['css', 'js', 'urls'],
    patterns: [/bootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)/i, /Bootstrap\s+v?5/i],
  },
  {
    name: 'Bulma',
    category: 'Styling',
    sources: ['css', 'urls'],
    patterns: [/bulma(?:\.min)?\.css/i],
  },
  {
    name: 'Material UI',
    category: 'Styling',
    sources: ['html', 'js'],
    patterns: [/\bMui[A-Z]/, /@mui\//i],
  },
  {
    name: 'styled-components',
    category: 'Styling',
    sources: ['html', 'js'],
    patterns: [/styled-components/i, /data-styled/i],
  },
  {
    name: 'Emotion',
    category: 'Styling',
    sources: ['html', 'js'],
    patterns: [/@emotion\//i, /data-emotion/i],
  },
  {
    name: 'Google Analytics',
    category: 'Analytics',
    sources: ['html', 'js', 'urls'],
    patterns: [/googletagmanager\.com\/gtag\/js/i, /\bgtag\s*\(/],
  },
  {
    name: 'Google Tag Manager',
    category: 'Analytics',
    sources: ['html', 'js', 'urls'],
    patterns: [/googletagmanager\.com\/gtm\.js/i, /GTM-[A-Z0-9]+/],
  },
  {
    name: 'Plausible',
    category: 'Analytics',
    sources: ['html', 'urls'],
    patterns: [/plausible\.io\/js/i],
  },
  {
    name: 'Fathom',
    category: 'Analytics',
    sources: ['html', 'urls'],
    patterns: [/cdn\.usefathom\.com/i],
  },
  {
    name: 'Hotjar',
    category: 'Analytics',
    sources: ['html', 'js', 'urls'],
    patterns: [/static\.hotjar\.com/i],
  },
  {
    name: 'Segment',
    category: 'Analytics',
    sources: ['html', 'urls'],
    patterns: [/cdn\.segment\.com\/analytics/i],
  },
  {
    name: 'Mixpanel',
    category: 'Analytics',
    sources: ['html', 'js', 'urls'],
    patterns: [/cdn\.mxpnl\.com/i, /mixpanel\.init/i],
  },
];

function firstMatch(pattern, text) {
  if (!text) return null;
  const flags = pattern.flags.replace(/g|y/g, '');
  const re = new RegExp(pattern.source, flags);
  const match = re.exec(text);
  return match ? match[0] : null;
}

/**
 * Identify frameworks, builders, styling tools and analytics from markup,
 * script/style contents and resource URLs.
 */
export function detectTech({
  html = '',
  jsSources = [],
  cssSources = [],
  finalUrl = '',
  meta = {},
  responseHeaders = {},
}) {
  const contexts = {
    html: html.slice(0, 4_000_000),
    js: jsSources
      .map((source) => source.content || '')
      .join('\n')
      .slice(0, 6_000_000),
    css: cssSources
      .map((source) => source.content || '')
      .join('\n')
      .slice(0, 3_000_000),
    urls: [
      finalUrl,
      ...jsSources.map((source) => source.url || ''),
      ...cssSources.map((source) => source.url || ''),
    ]
      .join('\n')
      .slice(0, 1_000_000),
  };

  const tech = new Map();
  const sourceLabels = {
    html: 'document',
    js: 'scripts',
    css: 'styles',
    urls: 'resource URLs',
  };

  for (const definition of DEFINITIONS) {
    for (const sourceName of definition.sources) {
      let evidence = null;
      for (const pattern of definition.patterns) {
        evidence = firstMatch(pattern, contexts[sourceName]);
        if (evidence) break;
      }
      if (!evidence) continue;
      tech.set(definition.name.toLowerCase(), {
        name: definition.name,
        category: definition.category,
        evidence: collapse(evidence, 100),
        detectedIn: sourceLabels[sourceName],
      });
      break;
    }
  }

  const server = String(responseHeaders.server || '').trim();
  if (server) {
    tech.set(`server:${server.toLowerCase()}`, {
      name: collapse(server, 80),
      category: 'Server',
      evidence: 'response header',
      detectedIn: 'headers',
    });
  }

  const poweredBy = String(responseHeaders.poweredBy || '').trim();
  if (poweredBy) {
    tech.set(`poweredby:${poweredBy.toLowerCase()}`, {
      name: collapse(poweredBy, 80),
      category: 'Platform',
      evidence: 'X-Powered-By header',
      detectedIn: 'headers',
    });
  }

  if (meta.generator) {
    const generator = collapse(meta.generator, 100);
    const alreadyCovered = [...tech.values()].some((entry) =>
      generator.toLowerCase().includes(entry.name.toLowerCase()),
    );
    if (!alreadyCovered) {
      tech.set('generator', {
        name: generator,
        category: 'Generator',
        evidence: 'meta generator',
        detectedIn: 'document',
      });
    }
  }

  return [...tech.values()].slice(0, 26);
}
