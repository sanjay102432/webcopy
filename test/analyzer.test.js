import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSources, analyzeSite } from '../server/analyzer.js';
import { buildDemoReport } from '../server/demo.js';
import { normalizeUrl, isPrivateAddress, FetchProblem } from '../server/fetcher.js';
import { analyzeStyles } from '../server/css-analysis.js';

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

test('analyzeSite rejects non-html content', async () => {
  await assert.rejects(
    () => analyzeSite('ftp://example.com'),
    (error) => error instanceof FetchProblem,
  );
});
