import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSources, analyzeSite } from '../server/analyzer.js';
import { buildDemoReport } from '../server/demo.js';
import { normalizeUrl, isPrivateAddress, FetchProblem } from '../server/fetcher.js';
import { analyzeStyles } from '../server/css-analysis.js';
import { analyzeScripts } from '../server/js-analysis.js';

test('normalizeUrl adds a scheme and strips the hash', () => {
  const url = normalizeUrl('example.com/page#section');
  assert.equal(url.toString(), 'https://example.com/page');
});

test('normalizeUrl keeps explicit protocols', () => {
  assert.equal(normalizeUrl('http://example.com/').toString(), 'http://example.com/');
});

test('normalizeUrl rejects non-web protocols', () => {
  assert.throws(() => normalizeUrl('ftp://example.com'), FetchProblem);
  assert.throws(() => normalizeUrl(''), FetchProblem);
});

test('isPrivateAddress flags private ranges', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.0.0.5'), true);
  assert.equal(isPrivateAddress('192.168.1.20'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
});

test('analyzeStyles reads keyframes, animations and transitions', () => {
  const css = `
    :root { --ease: cubic-bezier(.2, .8, .2, 1); }
    @keyframes drift { from { transform: none; } to { transform: translateY(12px); } }
    .card { animation: drift 1.2s var(--ease) infinite alternate; transition: transform 400ms ease, opacity 200ms linear; }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; transition: none; } }
  `;
  const result = analyzeStyles([{ label: 'test.css', url: 'https://example.com/test.css', content: css, baseUrl: 'https://example.com/' }]);
  assert.equal(result.keyframesTotal, 1);
  assert.equal(result.keyframes[0].name, 'drift');
  assert.equal(result.animationUsesTotal, 1);
  assert.equal(result.animationUses[0].durationMs, 1200);
  assert.equal(result.transitionsTotal, 2);
  assert.equal(result.reducedMotion.mediaBlocks, 1);
  assert.equal(result.reducedMotion.disablesMotion, 1);
});

test('analyzeStyles captures typography rules and scroll CSS details', () => {
  const css = `
    :root { --font-sans: Inter, sans-serif; }
    h1 { font-family: var(--font-sans); font-size: 64px; line-height: 1.05; letter-spacing: -0.03em; font-weight: 700; }
    .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; }
    .page { scroll-snap-type: y proximity; }
    .rail { position: sticky; top: 96px; }
    .bar { animation: grow linear both; animation-timeline: scroll(root); animation-range: entry 0% cover 50%; }
    @supports (animation-timeline: scroll()) { .bar { animation-duration: auto; } }
  `;
  const result = analyzeStyles([
    { label: 'type.css', url: 'https://type.example/type.css', content: css, baseUrl: 'https://type.example/' },
  ]);
  assert.ok(result.design.typography.rulesTotal >= 2);
  const h1 = result.design.typography.rules.find((rule) => rule.size === '64px');
  assert.ok(h1, 'captures the 64px rule');
  assert.equal(h1.family, 'var(--font-sans)');
  assert.equal(h1.weight, '700');
  assert.equal(h1.lineHeight, '1.05');
  assert.equal(h1.letterSpacing, '-0.03em');
  assert.ok(result.design.typography.weights.some((item) => item.value === '700'));
  assert.ok(result.design.typography.transforms.some((item) => item.value === 'uppercase'));
  assert.equal(result.scroll.scrollSnap, 1);
  assert.equal(result.scroll.snapTypes[0].value, 'y proximity');
  assert.equal(result.scroll.stickyRules, 1);
  assert.equal(result.scroll.stickySelectors[0].offset, '96px');
  assert.equal(result.scroll.timelineUses.length, 1);
  assert.equal(result.scroll.timelineUses[0].timeline, 'scroll(root)');
  assert.equal(result.scroll.timelineUses[0].range, 'entry 0% cover 50%');
  assert.ok(result.scroll.ranges.some((item) => item.value === 'entry 0% cover 50%'));
});

test('analyzeScripts reports scroll behaviour details', () => {
  const js = `
    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1.2 });
    gsap.to('.panel', { y: -80, scrollTrigger: { trigger: '.panel', start: 'top 80%', end: 'bottom top', scrub: 1, pin: true, toggleClass: 'is-pinned' } });
    const io = new IntersectionObserver(onSeen, { threshold: [0, 0.25, 1], rootMargin: '-10% 0px' });
    const y = window.scrollY;
    document.querySelector('#top').scrollIntoView({ behavior: 'smooth', block: 'start' });
  `;
  const result = analyzeScripts(
    [{ label: 'app.js', url: 'https://scroll.example/app.js', content: js }],
    { motionMarkup: { dataAttributes: [] }, html: '' },
  );
  const keys = result.scrollDetails.items.map((item) => item.key);
  for (const key of ['scrub', 'pin', 'toggleClass', 'start', 'end', 'threshold', 'rootMargin', 'lenisOptions', 'scrollReads', 'programmaticScroll']) {
    assert.ok(keys.includes(key), `scroll details include ${key}`);
  }
  const lenis = result.scrollDetails.items.find((item) => item.key === 'lenisOptions');
  assert.ok(lenis.samples.some((sample) => sample.includes('lerp: 0.09')));
  const scrub = result.scrollDetails.items.find((item) => item.key === 'scrub');
  assert.equal(scrub.samples[0], '1');
  const toggle = result.scrollDetails.items.find((item) => item.key === 'toggleClass');
  assert.equal(toggle.samples[0], 'is-pinned');
  assert.deepEqual(result.scrollDetails.thresholds, ['[0, 0.25, 1]']);
  assert.equal(result.scrollDetails.rootMargins[0], '-10% 0px');
  assert.ok(result.scrollDetails.scrollReads >= 1);
  assert.ok(result.scrollDetails.programmaticScrolls >= 1);
});

test('analyzeSources returns a complete report for inline sources', () => {
  const html = `<!doctype html><html lang="en"><head><title>Test</title>
    <style>@keyframes pulse { 50% { opacity: .5; } } .dot { animation: pulse 2s ease infinite; }</style>
    </head><body><img src="/a.png" alt="A"><a href="/next">Next</a>
    <script>gsap.to('.dot', { x: 10 });</script>
    </body></html>`;
  const $ = null; // preloaded document is optional
  const report = analyzeSources({
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    html,
    cssSources: [],
    jsSources: [],
    preloadedDocument: null,
  });
  assert.equal(report.summary.keyframes, 1);
  assert.equal(report.summary.animationUses, 1);
  assert.equal(report.summary.images, 1);
  assert.equal(report.summary.links, 1);
  assert.equal(report.motion.libraries.some((library) => library.key === 'gsap'), true);
  assert.equal(typeof report.summary.motionScore, 'number');
  assert.ok(report.summary.motionScore > 0);
});

test('the demo specimen produces a dense, consistent report', () => {
  const report = buildDemoReport();
  assert.equal(report.demo, true);
  assert.equal(report.host, 'aurelia-studio.example');
  assert.ok(report.summary.keyframes >= 8);
  assert.ok(report.summary.transitions >= 20);
  assert.ok(report.summary.libraries >= 4);
  assert.ok(report.motion.libraries.some((library) => library.key === 'gsap'));
  assert.ok(report.motion.libraries.some((library) => library.key === 'lenis'));
  assert.equal(report.motion.reducedMotion.present, true);
  assert.ok(report.assets.counts.images >= 1);
  assert.ok(report.assets.videoEmbeds.length >= 1);
  assert.ok(report.design.colors.length > 0);
  assert.ok(report.structure.headings.length > 0);
});

test('every report embeds one copy-ready agent prompt', () => {
  const report = buildDemoReport();
  assert.equal(typeof report.prompt, 'string');
  assert.ok(report.prompt.length > 1500, 'prompt should be substantial');
  assert.ok(report.prompt.includes('aurelia-studio.example'), 'prompt names the target');
  assert.ok(report.prompt.includes('@keyframes to declare'), 'prompt lists keyframes');
  assert.ok(report.prompt.includes('drift'), 'prompt names measured keyframes');
  assert.ok(report.prompt.includes('Transition'), 'prompt lists transitions');
  assert.ok(report.prompt.includes('GSAP'), 'prompt names libraries');
  assert.ok(report.prompt.includes('prefers-reduced-motion'), 'prompt covers accessibility');
  assert.ok(report.prompt.includes('#ff4d1d') || report.prompt.includes('#14140f'), 'prompt carries the palette');
  assert.ok(report.prompt.includes('## 4 · Typography'), 'prompt has a typography section');
  assert.ok(report.prompt.includes('Type specimens'), 'prompt lists type specimens');
  assert.ok(report.prompt.includes('Font weights in use'), 'prompt buckets font weights');
  assert.ok(report.prompt.includes('## 5 · Images, video & media'), 'prompt has a media section');
  assert.ok(report.prompt.includes('images.unsplash.com'), 'prompt inventories image URLs');
  assert.ok(report.prompt.includes('missing alt text'), 'prompt flags missing alt text');
  assert.ok(report.prompt.includes('## 7 · Scroll choreography'), 'prompt has a scroll section');
  assert.ok(report.prompt.includes('animation-range'), 'prompt carries scroll-driven animation ranges');
  assert.ok(report.prompt.includes('Sticky elements'), 'prompt lists sticky elements');
  assert.ok(report.prompt.includes('Scrubbed scroll timelines'), 'prompt describes scrub configs');
  assert.ok(report.prompt.includes('Lenis smooth-scroll options'), 'prompt quotes smooth-scroll options');
  assert.ok(report.prompt.includes('rootMargin'), 'prompt quotes observer root margins');
  assert.ok(report.prompt.includes('data-aos'), 'prompt lists reveal data attributes');
  for (const leak of ['undefined', '[object Object]', 'NaN']) {
    assert.ok(!report.prompt.includes(leak), `prompt should not leak ${leak}`);
  }
});

test('a still page still receives a usable prompt', () => {
  const report = analyzeSources({
    requestedUrl: 'https://still.example/',
    finalUrl: 'https://still.example/',
    html: '<!doctype html><html><head><title>Still</title></head><body><p>Quiet page.</p></body></html>',
  });
  assert.equal(typeof report.prompt, 'string');
  assert.ok(report.prompt.includes('None found in the delivered CSS'));
  assert.ok(report.prompt.includes('Add it anyway'), 'missing reduced-motion coverage is called out');
});

test('analyzeSite rejects non-html content', async () => {
  await assert.rejects(
    () => analyzeSite('ftp://example.com'),
    (error) => error instanceof FetchProblem,
  );
});
