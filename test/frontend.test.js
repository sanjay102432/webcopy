import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { buildDemoReport } from '../server/demo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

class FakeEventSource {
  static last = null;

  constructor(url) {
    this.url = url;
    this.closed = false;
    this.onmessage = null;
    this.onerror = null;
    FakeEventSource.last = this;
  }

  close() {
    this.closed = true;
  }

  emit(payload) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(payload) });
  }

  fail() {
    if (this.onerror) this.onerror(new Error('stream error'));
  }
}

async function bootPage() {
  const html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
  const script = await readFile(path.join(publicDir, 'app.js'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:4173/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.EventSource = FakeEventSource;
  window.scrollTo = () => {};
  window.Element.prototype.scrollIntoView = () => {};
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async () => {} },
    configurable: true,
  });

  window.eval(script);
  return { dom, window };
}

test('the landing page wires up and renders a demo report', async () => {
  const { window } = await bootPage();
  const { document } = window;

  assert.ok(document.querySelector('#scanForm'));
  assert.ok(document.querySelector('#reportView').hidden);

  const demoButton = document.querySelector('[data-demo]');
  demoButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const stream = FakeEventSource.last;
  assert.ok(stream, 'an EventSource should have been opened');
  assert.ok(stream.url.includes('demo=1'), 'demo scans should stream the specimen');
  assert.equal(document.querySelector('#scanOverlay').hidden, false, 'the overlay should open');

  const report = buildDemoReport();
  /* Synthesize a long transitions table so pagination is exercised. */
  const seed = report.motion.transitions[0] || {};
  report.motion.transitions = Array.from({ length: 130 }, (_, index) => ({
    ...seed,
    selector: `.synth-${index}`,
    property: index % 2 ? 'transform' : 'opacity',
  }));
  stream.emit({ type: 'progress', key: 'fetch', label: 'Opening specimen file', percent: 12, detail: 'demo' });
  assert.equal(document.querySelector('#scanPercent').textContent, '12');
  /* Progress must never walk backwards: a repeated earlier step is ignored. */
  stream.emit({ type: 'progress', key: 'styles', label: 'styles', percent: 42, detail: '' });
  stream.emit({ type: 'progress', key: 'scripts', label: 'scripts', percent: 68, detail: '' });
  stream.emit({ type: 'progress', key: 'styles', label: 'styles again', percent: 74, detail: '' });
  const scriptStep = document.querySelector('#scanSteps li[data-step="scripts"]');
  assert.equal(scriptStep.querySelector('.scan-step__state').textContent, 'reading');
  assert.equal(document.querySelector('#scanPercent').textContent, '74');
  stream.emit({ type: 'result', report });

  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.equal(document.querySelector('#scanOverlay').hidden, true, 'the overlay should close after a result');
  assert.equal(document.querySelector('#landingView').hidden, true);
  assert.equal(document.querySelector('#reportView').hidden, false);

  const rendered = document.querySelector('#reportView').innerHTML;
  assert.ok(rendered.includes('aurelia-studio.example'), 'host appears in the report hero');
  assert.ok(rendered.includes('Motion ledger'), 'motion section rendered');
  assert.ok(rendered.includes('Design system'), 'design section rendered');
  assert.ok(rendered.includes('Agent prompt'), 'prompt section rendered');
  assert.ok(rendered.includes('Asset inventory'), 'asset section rendered');
  assert.ok(rendered.includes('Structure &amp; identity'), 'structure section rendered');
  assert.ok(rendered.includes('Source inventory'), 'source section rendered');
  assert.ok(!rendered.includes('<style'), 'no raw style blocks injected');
  assert.ok(!rendered.includes('<script'), 'no raw script blocks injected');
  assert.ok(document.querySelectorAll('#assetList .asset').length > 0, 'asset explorer populated');
  assert.ok(document.querySelectorAll('.part__fill').length > 0, 'score parts rendered');
  assert.ok(document.querySelectorAll('[data-more]').length > 0, 'long tables offer pagination');
  assert.ok(document.querySelector('a[href="#report-prompt"]'), 'nav links to the prompt');

  /* The prompt text is present, escaped and copyable. */
  const promptText = document.querySelector('#promptText');
  assert.ok(promptText, 'prompt block exists');
  assert.ok(promptText.textContent.length > 1500, 'prompt text is complete');
  assert.ok(promptText.textContent.includes('Front-end brief'), 'prompt has its own header');
  const promptSection = document.querySelector('#report-prompt');
  assert.ok(promptSection, 'prompt section has the right id');
  const copyButton = document.querySelector('[data-action="copy-prompt"]');
  copyButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(document.querySelector('#toast').textContent.includes('Agent prompt copied'), 'copy action reports success');

  /* Show-more pagination should append rows safely. */
  const more = document.querySelector('[data-more]');
  assert.ok(more, 'a long table should offer a show-more button');
  const table = more.closest('table');
  const before = table.querySelectorAll('tbody tr').length;
  more.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const after = table.querySelectorAll('tbody tr').length;
  assert.ok(after > before, 'pagination should append rows');

  /* Asset filtering should reduce the visible list. */
  const search = document.querySelector('#assetSearch');
  search.value = 'zzz-no-such-asset';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok(document.querySelector('#assetList').textContent.includes('No assets match'));
  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok(document.querySelectorAll('#assetList .asset').length > 0, 'clearing the filter restores rows');
});

test('a scan failure shows the fail panel with code', async () => {
  const { window } = await bootPage();
  const { document } = window;

  document.querySelector('#urlInput').value = 'not-a-real-host.example';
  document.querySelector('#scanForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  const stream = FakeEventSource.last;
  assert.ok(stream.url.includes(encodeURIComponent('not-a-real-host.example')));
  stream.emit({ type: 'fail', error: { message: 'We could not find that domain.', code: 'DNS_FAILED' } });

  assert.equal(document.querySelector('#scanFail').hidden, false);
  assert.ok(document.querySelector('#scanFailMessage').textContent.includes('could not find that domain'));
  assert.equal(document.querySelector('#scanFailCode').textContent, 'DNS_FAILED');

  /* Retry should start a fresh scan for the same URL. */
  document.querySelector('[data-retry-scan]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.ok(FakeEventSource.last.url.includes('not-a-real-host.example'));
});

test('an empty address is rejected client-side', async () => {
  const { window } = await bootPage();
  const { document } = window;

  document.querySelector('#scanForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const error = document.querySelector('#formError');
  assert.equal(error.hidden, false);
  assert.ok(error.textContent.length > 0);
  assert.equal(document.querySelector('#scanOverlay').hidden, true);
});
