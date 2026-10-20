/* ==========================================================================
   webcopy — front-end application
   Reads a report from the API and renders it as an editorial specimen view.
   Every string from a report is treated as untrusted: text is escaped and
   URLs, colors, gradients and fonts are validated before they touch the DOM.
   ========================================================================== */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STEP_KEYS = ['fetch', 'styles', 'scripts', 'motion', 'crawl', 'finish'];
const STEP_FOR_EVENT = {
  fetch: 'fetch',
  parse: 'fetch',
  styles: 'styles',
  scripts: 'scripts',
  motion: 'motion',
  crawl: 'crawl',
  finish: 'finish',
};

const ASSET_FILTERS = [
  ['all', 'All'],
  ['image', 'Images'],
  ['video', 'Video'],
  ['embed', 'Embeds'],
  ['font', 'Fonts'],
  ['css', 'CSS'],
  ['js', 'JS'],
  ['link', 'Links'],
  ['meta', 'Meta'],
  ['domain', 'Domains'],
];

const state = {
  report: null,
  stream: null,
  fallback: null,
  token: 0,
  scanning: false,
  demo: false,
  lastUrl: '',
  percent: 0,
  stepIndex: -1,
  fallbackUsed: false,
  assets: [],
  assetFilter: 'all',
  assetQuery: '',
  tables: new Map(),
  tableSeq: 0,
};

const refs = {};

/* ---------------------------------------------------------------- helpers */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

function limited(value, max = 400) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function fmtInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return Math.round(number).toLocaleString('en-US');
}

function fmtBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtMs(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return esc(String(iso));
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return String(url || '');
  }
}

function safeUrl(value, { mailto = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    if (mailto && parsed.protocol === 'mailto:') return parsed.toString();
  } catch {
    return '';
  }
  return '';
}

function prettyUrl(value, max = 96) {
  const raw = String(value ?? '');
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

function safeColor(value) {
  const raw = String(value ?? '').trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
  if (/^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^;{}<>"']+\)$/i.test(raw)) return raw;
  return '';
}

function safeGradient(value) {
  const raw = String(value ?? '').trim();
  if (!/gradient\(/i.test(raw)) return '';
  if (!/^(?:repeating-)?(?:linear|radial|conic)-gradient\([^;{}<>"'\\]+\)$/i.test(raw)) return '';
  return raw;
}

function safeFontFamily(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 140) return '';
  if (!/^[\w\s,'".-]+$/.test(raw)) return '';
  return raw;
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let toastTimer = null;

function toast(message) {
  if (!refs.toast) return;
  refs.toast.textContent = message;
  refs.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove('is-visible'), 2800);
}

async function copyText(text, label) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast(label || 'Copied to the clipboard.');
    return true;
  } catch {
    toast('Copy failed — your browser blocked the clipboard.');
    return false;
  }
}

function downloadJson() {
  if (!state.report) return;
  const host = (state.report.host || 'site').replace(/[^\w.-]/g, '');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `webcopy-${host}-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Report downloaded as JSON.');
}

function downloadPrompt() {
  if (!state.report?.prompt) return;
  const host = (state.report.host || 'site').replace(/[^\w.-]/g, '');
  const blob = new Blob([state.report.prompt], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `webcopy-${host}-agent-prompt.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Agent prompt downloaded.');
}

function summaryText(report) {
  const s = report.summary || {};
  const libs = (report.motion?.libraries || []).map((library) => library.name);
  const lines = [
    `webcopy readout — ${report.host || report.finalUrl}`,
    report.finalUrl || '',
    '',
    `Motion score        ${s.motionScore ?? 0}/100 (${s.motionLabel || '—'})`,

    `Keyframes           ${fmtInt(s.keyframes)}`,
    `Animation uses      ${fmtInt(s.animationUses)} across ${fmtInt(s.animatedSelectors)} selectors`,
    `Transitions         ${fmtInt(s.transitions)} across ${fmtInt(s.transitionedSelectors)} selectors`,
    `Libraries           ${libs.length ? libs.join(', ') : 'none detected'}`,
    `JS triggers         ${fmtInt(s.jsTriggers)}`,
    `Scroll signals      ${fmtInt(s.scrollSignals)}`,
    `Images              ${fmtInt(s.images)} (${fmtInt(s.imagesMissingAlt)} missing alt)`,
    `Videos              ${fmtInt(s.videos)}`,
    `Links               ${fmtInt(s.links)}`,
  ];
  if (report.crawl?.enabled) {
    lines.push(
      `Pages read          ${fmtInt(report.crawl.totals?.pagesRead ?? 0)} (${fmtInt(
        (report.crawl.pages || []).length,
      )} linked${(report.crawl.failed || []).length ? `, ${fmtInt(report.crawl.failed.length)} failed` : ''})`,
    );
  }
  lines.push(
    `Font families       ${fmtInt(s.fontFamilies)}`,
    `Assets referenced   ${fmtInt(s.assets)}`,
    `Words               ${fmtInt(report.stats?.words)}`,
    '',
    `Read ${fmtDate(report.fetchedAt)} · webcopy v1.1 · static source read`,
  );
  return lines.join('\n');
}

/* ------------------------------------------------------------- scan flow */

function showOverlay() {
  refs.overlay.hidden = false;
  document.body.classList.add('is-locked');
  refs.fail.hidden = true;
  refs.live.hidden = false;
  setTimeout(() => refs.cancel.focus({ preventScroll: true }), 30);
}

function hideOverlay() {
  refs.overlay.hidden = true;
  document.body.classList.remove('is-locked', 'is-scanning');
}

function resetOverlay({ demo = false, label = '' }) {
  state.percent = 0;
  state.stepIndex = -1;
  refs.percent.textContent = '00';
  refs.progressFill.style.transform = 'scaleX(0)';
  refs.progress.setAttribute('aria-valuenow', '0');
  refs.log.textContent = demo ? 'Opening the specimen file…' : 'Resolving the address…';
  refs.detail.textContent = demo
    ? 'A fictional studio site. No network required.'
    : 'Only public http(s) pages, within the size limits.';
  refs.mode.textContent = demo ? 'Reading the specimen / no network' : 'Fetching public source';
  refs.host.textContent = label || 'website';
  refs.specimen.textContent = demo ? 'Specimen 000 / Aurelia Studio' : 'Specimen / public read';
  $$('#scanSteps li').forEach((li) => {
    li.classList.remove('is-active', 'is-done');
    const stateEl = $('.scan-step__state', li);
    if (stateEl) stateEl.textContent = 'pending';
  });
}

function updateProgress(percent, label, detail) {
  const value = Math.max(state.percent, Math.min(100, Number(percent) || 0));
  state.percent = value;
  refs.percent.textContent = String(Math.round(value)).padStart(2, '0');
  refs.progressFill.style.transform = `scaleX(${value / 100})`;
  refs.progress.setAttribute('aria-valuenow', String(Math.round(value)));
  if (label) refs.log.textContent = label;
  if (detail) refs.detail.textContent = detail;
}

function markStep(eventKey, percent) {
  const activeKey = STEP_FOR_EVENT[eventKey] || eventKey;
  const index = STEP_KEYS.indexOf(activeKey);
  if (index < 0) return;
  if (index > state.stepIndex) state.stepIndex = index;
  const activeIndex = state.stepIndex;
  const done = percent >= 100;
  $$('#scanSteps li').forEach((li) => {
    const liIndex = STEP_KEYS.indexOf(li.dataset.step);
    const isDone = done || liIndex < activeIndex;
    const isActive = !done && liIndex === activeIndex;
    li.classList.toggle('is-done', isDone);
    li.classList.toggle('is-active', isActive);
    const stateEl = $('.scan-step__state', li);
    if (stateEl) stateEl.textContent = isDone ? 'done' : isActive ? 'reading' : 'pending';
  });
}

function closeStream() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  if (state.fallback) {
    state.fallback.abort();
    state.fallback = null;
  }
}

function finishScan(report, token) {
  if (token !== state.token) return;
  closeStream();
  state.scanning = false;
  state.report = report;
  refs.submit.disabled = false;
  document.body.classList.remove('is-scanning');
  updateProgress(100, 'Read complete', `${fmtInt(report.summary?.motionSignatures)} motion signatures bound into the report.`);
  markStep('finish', 100);
  setTimeout(() => {
    if (token !== state.token) return;
    hideOverlay();
    renderReport(report);
    toast(report.demo ? 'Specimen readout opened.' : `Readout bound for ${report.host}.`);
  }, 420);
}

function failScan(error, token) {
  if (token !== state.token) return;
  closeStream();
  state.scanning = false;
  refs.submit.disabled = false;
  document.body.classList.remove('is-scanning');
  refs.live.hidden = true;
  refs.fail.hidden = false;
  refs.failTitle.textContent = 'We couldn’t finish that read.';
  refs.failMessage.textContent = error?.message || 'Something went wrong while reading the page.';
  const code = error?.code ? `${error.code}${error.detail ? ` · ${error.detail}` : ''}` : '';
  refs.failCode.textContent = code;
}

async function streamFailed(token) {
  if (token !== state.token || !state.scanning) return;
  if (state.demo || state.fallbackUsed) {
    if (state.demo) {
      failScan({ message: 'The specimen stream dropped. Try again.', code: 'STREAM_LOST' }, token);
    } else {
      failScan({ message: 'The live stream dropped before the report arrived.', code: 'STREAM_LOST' }, token);
    }
    return;
  }
  state.fallbackUsed = true;
  updateProgress(Math.max(state.percent, 60), 'Live stream dropped', 'Falling back to a direct read…');
  const controller = new AbortController();
  state.fallback = controller;
  try {
    const response = await fetch(
      `/api/analyze?url=${encodeURIComponent(state.lastUrl)}${crawlSearchParams()}`,
      {
        signal: controller.signal,
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.error) {
      failScan(payload?.error || { message: `The read failed (HTTP ${response.status}).`, code: 'HTTP_ERROR' }, token);
      return;
    }
    finishScan(payload, token);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    failScan({ message: 'We could not reach the analysis service.', code: 'NETWORK_ERROR' }, token);
  } finally {
    state.fallback = null;
  }
}

/* Crawl options ride along with every live scan when enabled. Sending an
   explicit 0 matters: an omitted parameter would fall back to the server
   default, silently turning a switched-off crawl back on. */

function crawlSearchParams() {
  const pages = Number(refs.crawlPages?.value ?? 3);
  if (!Number.isFinite(pages)) return '';
  const count = Math.max(0, Math.min(12, Math.round(pages)));
  const depth = Number(refs.crawlDepth?.value ?? 1);
  const depthPart =
    count > 0 && Number.isFinite(depth) && depth > 0 ? `&depth=${Math.min(3, Math.round(depth))}` : '';
  return `&pages=${count}${depthPart}`;
}

function startScan(rawUrl, options = {}) {
  if (state.scanning) return;
  const demo = Boolean(options.demo);
  const value = String(rawUrl || '').trim();

  if (!demo) {
    if (!value) {
      showFormError('Paste a website address first — like yourfavorite.site');
      refs.input.focus();
      return;
    }
    if (/\s/.test(value)) {
      showFormError('That address contains spaces. Try a single public URL.');
      refs.input.focus();
      return;
    }
  }

  hideFormError();
  state.demo = demo;
  state.fallbackUsed = false;
  state.lastUrl = demo ? 'aurelia-studio.example' : value;
  state.scanning = true;
  const token = state.token + 1;
  state.token = token;

  document.body.classList.add('is-scanning');
  refs.submit.disabled = true;
  resetOverlay({ demo, label: demo ? 'aurelia-studio.example' : hostOf(/^https?:\/\//i.test(value) ? value : `https://${value}`) });
  showOverlay();

  const stream = new EventSource(
    demo
      ? '/api/analyze/stream?demo=1'
      : `/api/analyze/stream?url=${encodeURIComponent(value)}${crawlSearchParams()}`,
  );
  state.stream = stream;

  stream.onmessage = (event) => {
    if (token !== state.token) return;
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.type === 'progress') {
      updateProgress(payload.percent, payload.label, payload.detail);
      markStep(payload.key, payload.percent);
    } else if (payload.type === 'result') {
      finishScan(payload.report, token);
    } else if (payload.type === 'fail') {
      failScan(payload.error, token);
    }
  };

  stream.onerror = () => {
    stream.close();
    if (state.stream === stream) state.stream = null;
    streamFailed(token);
  };
}

function cancelScan() {
  if (!state.scanning) {
    hideOverlay();
    if (refs.input) refs.input.focus({ preventScroll: true });
    return;
  }
  state.token += 1;
  state.scanning = false;
  closeStream();
  document.body.classList.remove('is-scanning');
  hideOverlay();
  refs.submit.disabled = false;
  toast('Scan cancelled.');
  if (refs.input) refs.input.focus({ preventScroll: true });
}

/* ---------------------------------------------------------- view toggles */

function showLanding({ focus = true } = {}) {
  state.report = null;
  refs.reportView.hidden = true;
  refs.reportView.innerHTML = '';
  refs.landing.hidden = false;
  refs.newScan.hidden = true;
  refs.body.classList.remove('is-report');
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (focus) setTimeout(() => refs.input.focus({ preventScroll: true }), 240);
}

function showReport(report) {
  state.report = report;
  refs.landing.hidden = true;
  refs.reportView.hidden = false;
  refs.newScan.hidden = false;
  refs.body.classList.add('is-report');
  window.scrollTo({ top: 0, behavior: 'auto' });
  setupReportNav();
}

/* ------------------------------------------------------------ validation */

function showFormError(message) {
  refs.formError.textContent = message;
  refs.formError.hidden = false;
  refs.shell.classList.add('is-error');
}

function hideFormError() {
  refs.formError.hidden = true;
  refs.formError.textContent = '';
  refs.shell.classList.remove('is-error');
}

/* ------------------------------------------------------- report rendering */

function chip(text, variant = '') {
  return `<span class="chip${variant ? ` chip--${variant}` : ''}">${text}</span>`;
}

function statGrid(tiles) {
  const body = tiles
    .map((tile) => {
      const variant = tile.variant ? ` stat--${tile.variant}` : '';
      const value =
        tile.count != null && !reducedMotion()
          ? `<strong data-count="${esc(tile.count)}">0</strong>`
          : `<strong>${esc(tile.value)}</strong>`;
      const note = tile.note ? `<small>${esc(tile.note)}</small>` : '';
      return `<div class="stat${variant}"><span class="stat__label">${esc(tile.label)}</span>${value}${note}</div>`;
    })
    .join('');
  return `<div class="stat-grid">${body}</div>`;
}

function subhead(title, note = '') {
  return `<div class="subhead"><h3>${esc(title)}</h3>${note ? `<span class="subhead__note">${esc(note)}</span>` : ''}</div>`;
}

function tableHead(headers) {
  return `<thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>`;
}

function renderTable(headers, rows, options = {}) {
  const id = `t${++state.tableSeq}`;
  const visible = options.visible || 60;
  const chunk = options.chunk || 80;
  const head = rows.slice(0, visible);
  const rest = rows.slice(visible);
  state.tables.set(id, { rows: rest, chunk });
  const more = rest.length
    ? `<tr><td colspan="${headers.length}"><button class="table-more" type="button" data-more="${id}">Show ${fmtInt(rest.length)} more rows</button></td></tr>`
    : '';
  return `<div class="table-wrap"><table class="data-table">${tableHead(headers)}<tbody data-tbody="${id}">${head.join('')}${more}</tbody></table></div>`;
}

function tableLink(url, label) {
  const safe = safeUrl(url);
  if (!safe) return esc(label || url || '—');
  return `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label || prettyUrl(url, 72))}</a>`;
}

function section(id, index, title, note, body, alt = false) {
  return `<section class="report-section${alt ? ' report-section--alt' : ''}" id="${id}">
    <header class="section-head">
      <span class="section-head__index">${esc(index)}</span>
      <div>
        <h2>${esc(title)}</h2>
        ${note ? `<p class="section-head__note">${esc(note)}</p>` : ''}
      </div>
    </header>
    ${body}
  </section>`;
}

function motionSection(report) {
  const s = report.summary;
  const m = report.motion;
  const libs = m.libraries || [];
  const parts = [];

  parts.push(
    statGrid([
      { label: 'Keyframes', value: fmtInt(s.keyframes), note: `${fmtInt(s.keyframeNames)} distinct names`, count: s.keyframes },
      { label: 'Animation uses', value: fmtInt(s.animationUses), note: `${fmtInt(s.animatedSelectors)} animated selectors`, count: s.animationUses },
      { label: 'Transitions', value: fmtInt(s.transitions), note: `${fmtInt(s.transitionedSelectors)} selectors`, count: s.transitions },
      { label: 'Libraries', value: fmtInt(s.libraries), note: libs.slice(0, 3).map((l) => l.name).join(', ') || 'none', count: s.libraries },
      { label: 'JS triggers', value: fmtInt(s.jsTriggers), note: 'runtime signals', count: s.jsTriggers },
      { label: 'Scroll signals', value: fmtInt(s.scrollSignals), note: 'scroll systems', count: s.scrollSignals },
      {
        label: 'Reduced motion',
        value: m.reducedMotion?.present ? 'Yes' : 'No',
        note: m.reducedMotion?.present ? `${fmtInt(m.reducedMotion.mediaBlocks)} CSS guards · ${fmtInt(m.reducedMotion.jsChecks)} JS checks` : 'no guard found',
        variant: m.reducedMotion?.present ? 'accent' : '',
      },
      {
        label: 'Median duration',
        value: m.durationStats ? `${fmtInt(m.durationStats.medianMs)} ms` : '—',
        note: m.durationStats ? `${fmtInt(m.durationStats.count)} timed values` : 'no durations read',
      },
    ]),
  );

  /* Keyframes */
  const keyframeRows = (m.keyframes || []).map((frame) => {
    const used = frame.usedCount
      ? `<span class="chip chip--acid">${fmtInt(frame.usedCount)}×</span>`
      : '<span class="chip chip--outline">unused</span>';
    const sample = frame.usedBy?.[0]?.selector
      ? `<div class="cell-code cell-muted">${esc(limited(frame.usedBy[0].selector, 90))}</div>`
      : '';
    return `<tr>
      <td><span class="cell-code">${esc(frame.name)}</span>${sample}</td>
      <td class="cell-num">${fmtInt(frame.frames)}</td>
      <td class="cell-code cell-muted">${esc((frame.properties || []).join(', ') || '—')}</td>
      <td>${used}</td>
      <td class="cell-code cell-muted">${esc(frame.source)}${frame.line ? `:${frame.line}` : ''}</td>
    </tr>`;
  });
  parts.push(
    subhead('Keyframe definitions', `${fmtInt(m.keyframesTotal)} declared`),
    keyframeRows.length
      ? renderTable(['Keyframe', 'Frames', 'Properties', 'Used', 'Source'], keyframeRows, { visible: 40 })
      : `<div class="asset-empty">No @keyframes blocks were found in the CSS we could read.</div>`,
  );

  /* Animation uses */
  const animationRows = (m.animationUses || []).map((item) => `<tr>
      <td class="cell-code">${esc(limited(item.selector, 110))}</td>
      <td class="cell-code">${esc(item.name)}</td>
      <td class="cell-num">${esc(item.duration || '—')}</td>
      <td class="cell-code">${esc(item.timing || '—')}</td>
      <td class="cell-code">${esc(item.delay || '—')}</td>
      <td class="cell-code">${esc(item.iterations || '—')}</td>
      <td class="cell-code">${esc(item.fill || '—')}</td>
      <td class="cell-code cell-muted">${esc(item.timeline || item.media || '—')}</td>
    </tr>`);
  parts.push(
    subhead('Animation assignments', `${fmtInt(m.animationUsesTotal)} total`),
    animationRows.length
      ? renderTable(
          ['Selector', 'Name', 'Duration', 'Easing', 'Delay', 'Iterations', 'Fill', 'Timeline / media'],
          animationRows,
          { visible: 50 },
        )
      : `<div class="asset-empty">No animation shorthand or longhand declarations were found.</div>`,
  );

  /* Transitions */
  const transitionRows = (m.transitions || []).map((item) => `<tr>
      <td class="cell-code">${esc(limited(item.selector, 110))}</td>
      <td class="cell-code">${esc(item.property || 'all')}</td>
      <td class="cell-num">${esc(item.duration || '—')}</td>
      <td class="cell-code">${esc(item.timing || '—')}</td>
      <td class="cell-code">${esc(item.delay || '—')}</td>
      <td class="cell-code cell-muted">${esc(item.media || '—')}</td>
      <td class="cell-code cell-muted">${esc(item.source)}${item.line ? `:${item.line}` : ''}</td>
    </tr>`);
  parts.push(
    subhead('Transition rules', `${fmtInt(m.transitionsTotal)} total`),
    transitionRows.length
      ? renderTable(['Selector', 'Property', 'Duration', 'Easing', 'Delay', 'Media', 'Source'], transitionRows, { visible: 50 })
      : `<div class="asset-empty">No transition declarations were found.</div>`,
  );

  /* Libraries */
  if (libs.length) {
    const cards = libs
      .map(
        (library) => `<article class="mini-card">
          <span class="mini-card__cat">${esc(library.category || 'Motion')}</span>
          <h4>${esc(library.name)}</h4>
          <span class="mini-card__meta">${fmtInt(library.hits)} signature hit${library.hits === 1 ? '' : 's'}</span>
          <div class="chips">${(library.sources || []).map((source) => chip(esc(source))).join('')}</div>
        </article>`,
      )
      .join('');
    parts.push(subhead('Motion libraries', `${libs.length} detected`), `<div class="card-grid">${cards}</div>`);
  } else {
    parts.push(
      subhead('Motion libraries', 'none detected'),
      `<div class="asset-empty">No known animation engine, scroll library or slideshow package was named in the scripts.</div>`,
    );
  }

  /* JS signals */
  const signals = m.signals || [];
  if (signals.length) {
    const rows = signals
      .map(
        (signal) => `<div class="signal">
          <span class="signal__label">${esc(signal.label)}</span>
          <span class="signal__cat">${esc(signal.category || '')}</span>
          <span class="signal__count">${fmtInt(signal.count)}</span>
        </div>`,
      )
      .join('');
    parts.push(subhead('JavaScript triggers', `${fmtInt(m.triggersTotal)} total`), `<div class="signal-list">${rows}</div>`);
  }

  /* Scroll systems */
  const scroll = m.scroll || {};
  const scrollSignals = scroll.signals || [];
  const scrollTiles = statGrid([
    { label: 'Scroll signals', value: fmtInt(scroll.total), note: 'all sources', variant: 'dark' },
    { label: 'animation-timeline', value: fmtInt(scroll.animationTimelineUses), note: 'CSS uses' },
    { label: 'Scroll / view timelines', value: fmtInt(scroll.scrollTimelines), note: 'named timelines' },
    { label: 'Smooth scrolling', value: fmtInt(scroll.smoothScrolling), note: 'scroll-behavior rules' },
    { label: 'Scroll snap', value: fmtInt(scroll.scrollSnap), note: 'snap containers' },
    { label: 'View transitions', value: fmtInt(scroll.viewTransitions), note: 'transition names' },
    { label: 'Sticky rules', value: fmtInt(scroll.stickyRules), note: 'position: sticky' },
    { label: '@supports guards', value: fmtInt(scroll.supportsAnimationTimeline), note: 'timeline fallbacks' },
  ]);
  const signalRows = scrollSignals.length
    ? `<div class="signal-list">${scrollSignals
        .map(
          (signal) => `<div class="signal">
            <span class="signal__label">${esc(signal.label)}</span>
            <span class="signal__cat">${esc(signal.kind || '')}</span>
            <span class="signal__count">${fmtInt(signal.count)}</span>
          </div>`,
        )
        .join('')}</div>`
    : `<div class="asset-empty">No scroll-linked motion signals were found.</div>`;
  const timelineSelectors = (scroll.timelineSelectors || []).length
    ? `<div class="chips" style="margin-top:14px">${scroll.timelineSelectors
        .map((selector) => chip(`<span class="cell-code">${esc(limited(selector, 70))}</span>`))
        .join('')}</div>`
    : '';
  parts.push(subhead('Scroll systems', `${fmtInt(scroll.total)} signals`), scrollTiles, timelineSelectors, signalRows);

  /* Special media */
  const special = m.special || {};
  parts.push(
    subhead('Special motion surfaces', 'markup + CSS'),
    statGrid([
      { label: 'SVG SMIL animations', value: fmtInt(special.svgAnimations), note: 'animate elements' },
      { label: 'SVG elements', value: fmtInt(special.svgCount), note: 'inline svg' },
      { label: 'Canvas elements', value: fmtInt(special.canvasElements), note: '2D / WebGL hosts' },
      { label: 'WebGL contexts', value: fmtInt(special.webglContexts), note: 'getContext calls' },
      { label: 'Marquee elements', value: fmtInt(special.marqueeElements), note: 'legacy tickers' },
      { label: 'Animated GIFs', value: fmtInt(special.animatedGifs), note: 'gif references' },
      { label: 'Autoplay videos', value: fmtInt(special.autoplayVideos), note: 'video[autoplay]' },
      { label: 'Video embeds', value: fmtInt(special.videoEmbeds), note: 'third-party players' },
    ]),
  );

  /* Data attributes & inline events */
  const attrs = m.dataAttributes || [];
  if (attrs.length) {
    parts.push(
      subhead('Motion data attributes', `${attrs.length} kinds`),
      `<div class="chips">${attrs
        .map((attr) => chip(`<span class="cell-code">${esc(attr.name)}</span> <strong>${fmtInt(attr.count)}</strong>`))
        .join('')}</div>`,
    );
  }
  const events = m.inlineEvents || [];
  if (events.length) {
    parts.push(
      subhead('Inline event handlers', `${events.length} kinds`),
      `<div class="chips">${events
        .map((event) => chip(`<span class="cell-code">${esc(event.name)}</span> <strong>${fmtInt(event.count)}</strong>`))
        .join('')}</div>`,
    );
  }

  /* Easings */
  if ((m.easings || []).length) {
    const rows = m.easings
      .map(
        (easing) => `<div class="token-row">
          <span class="token-row__name">${esc(easing.value)}</span>
          <span class="token-row__value">easing curve</span>
          <span class="token-row__count">${fmtInt(easing.count)}×</span>
        </div>`,
      )
      .join('');
    parts.push(subhead('Easing curves', `${m.easings.length} distinct`), `<div class="token-list">${rows}</div>`);
  }

  /* Limits */
  const limits = m.limits || {};
  const limited_ = Object.entries(limits).filter(([, value]) => value).map(([key]) => key);
  if (limited_.length) {
    parts.push(`<p class="limit-note">Report limits reached for: ${esc(limited_.join(', '))}. The counts above still reflect the totals; only the tables were trimmed.</p>`);
  }

  return section(
    'report-motion',
    'A',
    'Motion ledger',
    'Every keyframe, animation assignment, transition, library and runtime trigger read from the delivered source.',
    parts.join(''),
  );
}

function designSection(report) {
  const d = report.design;
  const parts = [];

  parts.push(
    statGrid([
      { label: 'Colors', value: fmtInt(report.summary.colors), note: 'distinct values', count: report.summary.colors },
      { label: 'Font families', value: fmtInt(d.fontTotal), note: `${fmtInt(d.fontFaces.length)} @font-face rules`, count: d.fontTotal },
      { label: 'Font files', value: fmtInt(d.fontFiles.length), note: 'woff / ttf / otf', count: d.fontFiles.length },
      { label: 'Radii', value: fmtInt((d.radii || []).length), note: 'distinct values' },
      { label: 'Shadows', value: fmtInt((d.shadows || []).length), note: 'box + text shadows' },
      { label: 'Gradients', value: fmtInt((d.gradients || []).length), note: 'gradient declarations' },
      { label: 'Custom properties', value: fmtInt((d.customProperties || []).length), note: 'CSS variables read' },
      { label: 'Breakpoints', value: fmtInt((d.breakpoints || []).length), note: 'media query widths' },
    ]),
  );

  /* Colors */
  const colors = d.colors || [];
  if (colors.length) {
    const swatches = colors
      .map((color) => {
        const safe = safeColor(color.value);
        const style = safe ? ` style="background:${esc(safe)}"` : '';
        return `<div class="swatch">
          <span class="swatch__chip"${style}></span>
          <span class="swatch__value">${esc(limited(color.value, 60))}</span>
          <span class="swatch__meta"><span>${esc(color.type || '')}</span><span>${fmtInt(color.count)}×</span></span>
        </div>`;
      })
      .join('');
    parts.push(
      subhead('Color frequency', `${fmtInt(d.colorTotal)} distinct · showing ${colors.length}`),
      `<div class="swatch-grid">${swatches}</div>`,
    );
  }

  /* Fonts */
  const fonts = d.fonts || [];
  if (fonts.length) {
    const rows = fonts
      .map((font) => {
        const family = safeFontFamily(font.family) || 'inherit';
        const evidence = (font.evidence || []).join(' · ');
        return `<div class="font-row">
          <span class="font-row__specimen" style="font-family:${esc(family)}">${esc(font.family)} — Aa 0123</span>
          <span class="font-row__meta">${fmtInt(font.count)}× · ${esc(limited(evidence, 120) || 'referenced in CSS')}</span>
        </div>`;
      })
      .join('');
    parts.push(subhead('Type families', `${fmtInt(d.fontTotal)} families`), `<div class="report-card"><div class="report-card__body">${rows}</div></div>`);
  }

  /* Font faces */
  const fontFaces = d.fontFaces || [];
  if (fontFaces.length) {
    const rows = fontFaces.map((face) => `<tr>
      <td>${esc(face.family)}</td>
      <td class="cell-code">${esc(face.weight || '—')}</td>
      <td class="cell-code">${esc(face.style || '—')}</td>
      <td class="cell-code">${esc((face.formats || []).join(', ') || '—')}</td>
      <td class="cell-url">${face.src ? tableLink(face.src, limited(face.src, 64)) : esc(face.source || '—')}</td>
    </tr>`);
    parts.push(subhead('@font-face rules', `${fontFaces.length} declared`), renderTable(['Family', 'Weight', 'Style', 'Formats', 'Source'], rows, { visible: 30 }));
  }

  /* Font files */
  const fontFiles = d.fontFiles || [];
  if (fontFiles.length) {
    const rows = fontFiles.map((file) => `<tr>
      <td class="cell-url">${tableLink(file.url, prettyUrl(file.url, 70))}</td>
      <td class="cell-code">${esc(file.family || '—')}</td>
      <td class="cell-code">${esc([file.weight, file.style].filter(Boolean).join(' ') || '—')}</td>
      <td class="cell-code">${esc(file.format || '—')}</td>
      <td class="cell-code cell-muted">${esc(file.source || '—')}</td>
    </tr>`);
    parts.push(subhead('Font files', `${fontFiles.length} referenced`), renderTable(['File', 'Family', 'Weight / style', 'Format', 'Found in'], rows, { visible: 40 }));
  }

  /* Font sizes */
  const sizes = d.fontSizes || [];
  if (sizes.length) {
    const max = Math.max(...sizes.map((size) => size.count));
    const rows = sizes
      .map(
        (size) => `<div class="bar-row">
          <span class="cell-code">${esc(size.value)}</span>
          <span class="bar-row__count">${fmtInt(size.count)}×</span>
          <span class="bar-row__bar" data-skip><span class="bar-row__fill" style="--w:${Math.round((size.count / max) * 100)}%"></span></span>
        </div>`,
      )
      .join('');
    parts.push(subhead('Type scale', `${sizes.length} declared sizes`), `<div class="report-card"><div class="report-card__body"><div class="bar-list">${rows}</div></div></div>`);
  }

  /* Radii + shadows */
  const tokenList = (items, label) => {
    if (!items.length) return '';
    const rows = items
      .map(
        (item) => `<div class="token-row">
          <span class="token-row__name">${esc(limited(item.value, 90))}</span>
          <span class="token-row__value">${label}</span>
          <span class="token-row__count">${fmtInt(item.count)}×</span>
        </div>`,
      )
      .join('');
    return `<div class="token-list">${rows}</div>`;
  };
  if ((d.radii || []).length) parts.push(subhead('Radii', `${d.radii.length} values`), tokenList(d.radii, 'border-radius'));
  if ((d.shadows || []).length) parts.push(subhead('Shadows', `${d.shadows.length} values`), tokenList(d.shadows, 'shadow'));

  /* Gradients */
  const gradients = d.gradients || [];
  if (gradients.length) {
    const rows = gradients
      .map((gradient) => {
        const safe = safeGradient(gradient.value);
        const preview = safe ? `<span class="swatch__chip" style="background:${esc(safe)}"></span>` : '';
        return `<div class="token-row">
          <span class="token-row__name">${preview} gradient</span>
          <span class="token-row__value">${esc(limited(gradient.value, 180))}</span>
          <span class="token-row__count">${fmtInt(gradient.count)}×</span>
        </div>`;
      })
      .join('');
    parts.push(subhead('Gradients', `${gradients.length} declarations`), `<div class="token-list">${rows}</div>`);
  }

  /* Custom properties */
  const props = d.customProperties || [];
  if (props.length) {
    const rows = props
      .map(
        (prop) => `<div class="token-row">
          <span class="token-row__name">${esc(prop.name)}</span>
          <span class="token-row__value">${esc(limited(prop.value, 120))}</span>
          <span class="token-row__count">${fmtInt(prop.count)}×</span>
        </div>`,
      )
      .join('');
    parts.push(subhead('CSS custom properties', `${props.length} read`), `<div class="token-list">${rows}</div>`);
  }

  /* Breakpoints */
  const breakpoints = d.breakpoints || [];
  if (breakpoints.length) {
    parts.push(
      subhead('Breakpoints', `${breakpoints.length} media widths`),
      `<div class="chips">${breakpoints
        .map((bp) => chip(`@media <strong>${esc(bp.value)}</strong> · ${fmtInt(bp.count)}×`))
        .join('')}</div>`,
      d.registeredProperties
        ? `<p class="subhead__note" style="margin-top:14px">${fmtInt(d.registeredProperties)} registered @property definitions · ${fmtInt(d.inlineStyleCount)} inline style attributes</p>`
        : `<p class="subhead__note" style="margin-top:14px">${fmtInt(d.inlineStyleCount)} inline style attributes</p>`,
    );
  }

  return section(
    'report-design',
    'B',
    'Design system',
    'Colors, type, radii, shadows, gradients, tokens and breakpoints found in the delivered styles.',
    parts.join(''),
  );
}

/* ------------------------------- prompt --------------------------------- */

function promptSection(report) {
  const prompt = report.prompt;
  if (!prompt) return '';
  const body = `<div class="prompt-shell">
      <div class="prompt-shell__bar">
        <span class="live-tag"><i aria-hidden="true"></i>Agent brief</span>
        <span class="prompt-shell__meta">${fmtInt(prompt.length)} characters · plain text · paste into any AI assistant or teammate</span>
        <span class="report-actions">
          <button class="btn btn--sm btn--acid" type="button" data-action="copy-prompt">Copy prompt</button>
          <button class="btn btn--sm btn--ghost-light" type="button" data-action="download-prompt">Download .md</button>
        </span>
      </div>
      <pre class="prompt-pre" id="promptText">${esc(prompt)}</pre>
      <div class="prompt-foot">
        <span>Generated from the motion + design ledgers of this readout</span>
        <span>${esc(report.host || '')} · ${esc(fmtDate(report.fetchedAt))} · webcopy v1.0</span>
      </div>
    </div>`;
  return section(
    'report-prompt',
    '✦',
    'Agent prompt',
    'One copy-ready brief describing the design system, animations, transitions, libraries and scroll behaviour measured above — written so an AI agent or a teammate can rebuild them without ever seeing this site.',
    body,
  );
}

/* ------------------------------- assets --------------------------------- */

function buildAssetEntries(report) {
  const entries = [];
  const a = report.assets;
  const push = (entry) => {
    entries.push({
      group: entry.group,
      type: entry.type,
      url: entry.url || '',
      label: entry.label || '',
      meta: (entry.meta || []).filter(Boolean),
      warn: Boolean(entry.warn),
      searchable: [entry.type, entry.url, entry.label, ...(entry.meta || [])].join(' ').toLowerCase(),
    });
  };

  (a.images || []).forEach((image) => {
    push({
      group: 'image',
      type: 'image',
      url: image.url,
      label: image.hasAlt ? `alt: “${limited(image.alt, 120)}”` : 'missing alt attribute',
      warn: !image.hasAlt,
      meta: [
        image.width && image.height ? `${image.width}×${image.height}` : '',
        image.loading ? `loading=${image.loading}` : '',
        image.fetchPriority ? `priority=${image.fetchPriority}` : '',
        image.srcsetCount ? `${image.srcsetCount} srcset` : '',
      ],
    });
  });

  (a.pictureSources || []).forEach((source) => {
    push({
      group: 'image',
      type: 'picture',
      url: source.srcset?.[0] || '',
      label: [source.type, source.media].filter(Boolean).join(' · ') || 'picture source',
      meta: [`${source.srcset?.length || 0} candidates`],
    });
  });

  (a.videos || []).forEach((video) => {
    push({
      group: 'video',
      type: 'video',
      url: video.url,
      label: video.poster ? `poster: ${prettyUrl(video.poster, 70)}` : 'video element',
      meta: [
        video.autoplay ? 'autoplay' : '',
        video.loop ? 'loop' : '',
        video.muted ? 'muted' : '',
        video.controls ? 'controls' : '',
        `${video.sources?.length || 0} sources`,
      ],
    });
    (video.sources || []).forEach((source) => {
      push({
        group: 'video',
        type: 'video file',
        url: source.url,
        label: source.type || '',
        meta: [],
      });
    });
  });

  (a.videoEmbeds || []).forEach((embed) => {
    push({
      group: 'embed',
      type: 'embed',
      url: embed.url,
      label: embed.title || `${embed.provider} embed`,
      meta: [embed.provider, embed.loading ? `loading=${embed.loading}` : '', embed.allowFullscreen ? 'fullscreen' : ''],
    });
  });

  (a.iframes || []).forEach((frame) => {
    if ((a.videoEmbeds || []).some((embed) => embed.url === frame.url)) return;
    push({ group: 'embed', type: 'iframe', url: frame.url, label: frame.title || '', meta: [frame.provider || ''] });
  });

  (a.stylesheets || []).forEach((sheet) => {
    push({
      group: 'css',
      type: sheet.inline ? 'style block' : 'stylesheet',
      url: sheet.url || '',
      label: sheet.inline ? sheet.label : sheet.media ? `media: ${sheet.media}` : sheet.label,
      meta: [
        typeof sheet.status === 'number' ? `HTTP ${sheet.status}` : String(sheet.status || ''),
        sheet.bytes ? fmtBytes(sheet.bytes) : '',
        sheet.imported ? 'imported' : '',
        sheet.truncated ? 'truncated' : '',
        sheet.error ? `error: ${sheet.error}` : '',
      ],
      warn: Boolean(sheet.error),
    });
  });

  (a.scripts || []).forEach((script) => {
    push({
      group: 'js',
      type: script.inline ? 'inline script' : script.module ? 'module' : 'script',
      url: script.url || '',
      label: script.inline ? script.label : [script.defer ? 'defer' : '', script.async ? 'async' : ''].filter(Boolean).join(' ') || script.label,
      meta: [
        typeof script.status === 'number' ? `HTTP ${script.status}` : String(script.status || ''),
        script.bytes ? fmtBytes(script.bytes) : '',
        script.truncated ? 'truncated' : '',
        script.error ? `error: ${script.error}` : '',
      ],
      warn: Boolean(script.error),
    });
  });

  (a.fontFiles || []).forEach((font) => {
    push({
      group: 'font',
      type: 'font',
      url: font.url,
      label: [font.family, font.weight, font.style].filter(Boolean).join(' '),
      meta: [font.format, font.source, `${font.count || 1}×`],
    });
  });

  (a.cssAssets || []).forEach((asset) => {
    push({
      group: 'css',
      type: asset.type === 'video' ? 'css video' : asset.type === 'image' ? 'css image' : 'css file',
      url: asset.url,
      label: [asset.property, asset.context].filter(Boolean).join(' · '),
      meta: [asset.source, `${asset.count || 1}×`],
    });
  });

  const metaImages = a.metaImages || {};
  for (const [key, url] of Object.entries(metaImages)) {
    if (!url) continue;
    push({ group: 'meta', type: 'meta', url, label: key, meta: [] });
  }

  const links = a.links || {};
  (links.internal || []).forEach((link) => {
    push({ group: 'link', type: 'internal', url: link.url, label: limited(link.text, 110), meta: [link.host] });
  });
  (links.external || []).forEach((link) => {
    push({
      group: 'link',
      type: 'external',
      url: link.url,
      label: limited(link.text, 110),
      meta: [link.host, link.rel, link.target],
    });
  });
  (links.contacts || []).forEach((contact) => {
    push({ group: 'link', type: contact.type, url: contact.url, label: limited(contact.text, 110), meta: [] });
  });
  (a.externalDomains || []).forEach((domain) => {
    push({ group: 'domain', type: 'domain', url: `https://${domain.domain}`, label: domain.domain, meta: [`${fmtInt(domain.count)} link${domain.count === 1 ? '' : 's'}`] });
  });

  return entries;
}

function assetRow(entry) {
  const url = safeUrl(entry.url, { mailto: true });
  const main = url
    ? `<a class="asset__url" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(prettyUrl(entry.url, 110))}</a>`
    : `<span class="asset__url">${esc(entry.label || '—')}</span>`;
  const label = url && entry.label ? `<span class="asset__label">${esc(entry.label)}</span>` : '';
  const meta = entry.meta.length
    ? `<span class="asset__meta">${entry.meta.map((item) => `<span>${esc(item)}</span>`).join('')}${
        entry.warn ? '<span class="warn">review</span>' : ''
      }</span>`
    : `<span class="asset__meta">${entry.warn ? '<span class="warn">review</span>' : ''}</span>`;
  return `<li class="asset" data-group="${esc(entry.group)}" data-search="${esc(entry.searchable)}">
      <span class="asset__type">${esc(entry.type)}</span>
      <span class="asset__main">${main}${label}</span>
      ${meta}
    </li>`;
}

function paintAssetList() {
  if (!refs.assetList) return;
  const query = state.assetQuery.trim().toLowerCase();
  const filter = state.assetFilter;
  const filtered = state.assets.filter(
    (entry) => (filter === 'all' || entry.group === filter) && (!query || entry.searchable.includes(query)),
  );
  refs.assetList.innerHTML = filtered.length
    ? filtered.slice(0, 400).map(assetRow).join('')
    : `<li class="asset-empty">No assets match that filter.</li>`;
  if (refs.assetCount) {
    refs.assetCount.textContent = `${fmtInt(filtered.length)} of ${fmtInt(state.assets.length)} entries${
      filtered.length > 400 ? ' · showing first 400' : ''
    }`;
  }
}

function assetsSection(report) {
  const a = report.assets;
  const counts = a.counts || {};
  const parts = [];

  parts.push(
    statGrid([
      { label: 'Images', value: fmtInt(counts.images), note: `${fmtInt(counts.pictureSources)} picture sources`, count: counts.images },
      {
        label: 'Missing alt',
        value: fmtInt(counts.imagesMissingAlt),
        note: counts.imagesMissingAlt ? 'accessibility gap' : 'all images labelled',
        variant: counts.imagesMissingAlt ? 'accent' : '',
        count: counts.imagesMissingAlt,
      },
      { label: 'Videos', value: fmtInt(counts.videos), note: `${fmtInt(counts.autoplayVideos)} autoplay · ${fmtInt(counts.videoEmbeds)} embeds`, count: counts.videos },
      { label: 'Iframes', value: fmtInt(counts.iframes), note: 'framed documents', count: counts.iframes },
      { label: 'Stylesheets', value: fmtInt(counts.stylesheets), note: `${fmtInt(counts.styleBlocks)} inline blocks`, count: counts.stylesheets },
      { label: 'Scripts', value: fmtInt(counts.scripts), note: `${fmtInt(counts.inlineScripts)} inline scripts`, count: counts.scripts },
      { label: 'Font files', value: fmtInt(counts.fonts), note: `${fmtInt(counts.fontFamilies)} families`, count: counts.fonts },
      { label: 'CSS assets', value: fmtInt(counts.cssAssets), note: `${fmtInt(counts.animatedGifs)} animated gifs`, count: counts.cssAssets },
      { label: 'Links', value: fmtInt(counts.links), note: `${fmtInt(counts.internalLinks)} internal · ${fmtInt(counts.externalLinks)} external`, count: counts.links },
      { label: 'Anchors with href', value: fmtInt(counts.anchorsWithHref), note: 'navigation targets', count: counts.anchorsWithHref },
    ]),
  );

  state.assets = buildAssetEntries(report);

  const filters = ASSET_FILTERS.map(
    ([key, label]) =>
      `<button type="button" class="asset-filter js-asset-filter${key === 'all' ? ' is-active' : ''}" data-asset-filter="${key}">${label}</button>`,
  ).join('');

  parts.push(
    subhead('Asset explorer', `${fmtInt(state.assets.length)} mapped references`),
    `<div class="asset-explorer">
      <div class="asset-toolbar">
        <label class="asset-search">
          <span aria-hidden="true">⌕</span>
          <input id="assetSearch" type="search" placeholder="Filter by URL, alt text, host or type…" autocomplete="off">
        </label>
        ${filters}
        <span class="asset-count" id="assetCount"></span>
      </div>
      <ul class="asset-list" id="assetList"></ul>
    </div>`,
  );

  return section(
    'report-assets',
    'C',
    'Asset inventory',
    'Images, videos, embeds, styles, scripts, fonts and every outbound link we could map — searchable.',
    parts.join(''),
    true,
  );
}

/* ------------------------------ structure ------------------------------- */

function structureSection(report) {
  const structure = report.structure || {};
  const meta = structure.meta || report.meta || {};
  const parts = [];

  /* Meta */
  const metaRows = [
    ['Title', meta.title],
    ['Description', meta.description],
    ['Canonical', meta.canonical ? `<a href="${esc(safeUrl(meta.canonical) || '#')}" target="_blank" rel="noopener noreferrer nofollow">${esc(meta.canonical)}</a>` : ''],
    ['Language', meta.lang],
    ['Theme color', meta.themeColor ? `${esc(meta.themeColor)} ${safeColor(meta.themeColor) ? `<span class="swatch__chip" style="display:inline-block;width:14px;height:14px;vertical-align:-2px;background:${esc(safeColor(meta.themeColor))}"></span>` : ''}` : ''],
    ['Generator', meta.generator],
    ['Robots', meta.robots],
    ['Viewport', meta.viewport],
    ['Charset', meta.charset],
    ['Author', meta.author],
    ['Favicon', meta.favicon ? tableLink(meta.favicon, meta.favicon) : ''],
    ['Manifest', meta.manifest ? tableLink(meta.manifest, meta.manifest) : ''],
    ['OG image', meta.og?.image ? tableLink(meta.og.image, meta.og.image) : ''],
    ['Twitter card', meta.twitter?.card],
  ].filter(([, value]) => value);

  if (metaRows.length) {
    parts.push(
      subhead('Document metadata', 'delivered head'),
      `<dl class="kv">${metaRows
        .map(([label, value]) => `<dt>${esc(label)}</dt><dd>${value}</dd>`)
        .join('')}</dl>`,
    );
  }

  /* Tech */
  const tech = report.tech || [];
  if (tech.length) {
    parts.push(
      subhead('Detected technology', `${tech.length} signals`),
      `<div class="card-grid">${tech
        .map(
          (item) => `<article class="tech-card">
            <span>${esc(item.category || 'Technology')}</span>
            <strong>${esc(item.name)}</strong>
            <span>${esc(item.evidence || '')}${item.detectedIn ? ` · ${esc(item.detectedIn)}` : ''}</span>
          </article>`,
        )
        .join('')}</div>`,
    );
  }

  /* Headings */
  const headings = structure.headings || [];
  if (headings.length) {
    const outline = headings
      .map(
        (heading) => `<li class="outline__item" data-level="${Number(heading.level) || 1}">
          <span class="outline__level">H${Number(heading.level) || 1}</span>
          <span class="outline__text">${esc(heading.text)}</span>
          ${heading.id ? `<code class="outline__id">#${esc(heading.id)}</code>` : '<span></span>'}
        </li>`,
      )
      .join('');
    parts.push(
      subhead('Heading outline', `${headings.length} headings · ${fmtInt(structure.h1Count)} h1`),
      `<ol class="outline">${outline}</ol>`,
    );
  }

  /* Sections */
  const sections = structure.sections || [];
  if (sections.length) {
    parts.push(
      subhead('Sections', `${sections.length} section elements`),
      `<div class="chips">${sections
        .map((item) => chip(`${item.id ? `<span class="cell-code">#${esc(item.id)}</span>` : '#'} ${esc(limited(item.label, 60))}`))
        .join('')}</div>`,
    );
  }

  /* Landmarks & forms */
  const landmarks = structure.landmarks || {};
  parts.push(
    subhead('Landmarks & content', 'document skeleton'),
    statGrid([
      { label: 'Words', value: fmtInt(structure.wordCount), note: `${fmtInt(structure.readingMinutes)} min read`, count: structure.wordCount },
      { label: 'Sections', value: fmtInt(landmarks.section), note: 'section landmarks' },
      { label: 'Articles', value: fmtInt(landmarks.article), note: 'article elements' },
      { label: 'Forms', value: fmtInt(landmarks.form), note: `${fmtInt(structure.forms?.inputs)} inputs` },
      { label: 'Nav landmarks', value: fmtInt(landmarks.nav), note: 'navigation regions' },
      { label: 'JSON-LD', value: fmtInt(structure.jsonLd?.blocks), note: (structure.jsonLd?.types || []).join(', ') || 'structured data' },
    ]),
  );

  const inputTypes = structure.forms?.inputTypes || [];
  if (inputTypes.length) {
    parts.push(
      subhead('Form controls', `${fmtInt(structure.forms?.forms)} forms`),
      `<div class="chips">${inputTypes
        .map((item) => chip(`<span class="cell-code">${esc(item.type)}</span> <strong>${fmtInt(item.count)}</strong>`))
        .join('')}</div>`,
    );
  }

  /* Links */
  const links = report.assets?.links || {};
  parts.push(
    subhead('Link graph', `${fmtInt(links.total)} anchors`),
    statGrid([
      { label: 'Internal', value: fmtInt(links.internalCount), note: 'same-domain targets', count: links.internalCount },
      { label: 'External', value: fmtInt(links.externalCount), note: 'off-domain targets', count: links.externalCount },
      { label: 'Email', value: fmtInt(links.emailCount), note: 'mailto links', count: links.emailCount },
      { label: 'Phone', value: fmtInt(links.phoneCount), note: 'tel links', count: links.phoneCount },
      { label: 'Anchors', value: fmtInt(links.anchorCount), note: 'in-page jumps', count: links.anchorCount },
      { label: 'Other schemes', value: fmtInt(links.otherCount), note: 'javascript / data', count: links.otherCount },
    ]),
    (report.assets?.externalDomains || []).length
      ? `<div class="chips" style="margin-top:14px">${report.assets.externalDomains
          .map((domain) => chip(`<span class="cell-code">${esc(domain.domain)}</span> <strong>${fmtInt(domain.count)}</strong>`))
          .join('')}</div>`
      : '',
  );

  return section(
    'report-structure',
    'D',
    'Structure & identity',
    'Metadata, technology signals, heading outline, landmarks, forms and the shape of the link graph.',
    parts.join(''),
  );
}

/* ------------------------------- source --------------------------------- */

function sourceSection(report) {
  const stats = report.stats || {};
  const parts = [];

  parts.push(
    statGrid([
      { label: 'Page status', value: String(stats.pageStatus || '—'), note: stats.pageContentType || '' },
      { label: 'HTML read', value: fmtBytes(stats.htmlBytes), note: stats.pageTruncated ? 'truncated at 5 MB' : 'full document' },
      { label: 'CSS read', value: fmtBytes(stats.cssBytes), note: `${fmtInt(stats.stylesheetStats?.fetched)} files fetched` },
      { label: 'JS read', value: fmtBytes(stats.jsBytes), note: `${fmtInt(stats.scriptStats?.fetched)} files fetched` },
      { label: 'Transferred', value: fmtBytes(stats.transferredBytes), note: 'HTML + CSS + JS' },
      { label: 'Resources', value: fmtInt(stats.resourcesRead), note: `${fmtInt(stats.resourcesFailed)} failed · ${fmtInt(stats.resourcesSkipped)} skipped` },
      { label: 'Analysis time', value: fmtMs(stats.analyzedInMs), note: `page answered in ${fmtMs(stats.pageElapsedMs)}` },
      { label: 'Fetched at', value: fmtDate(stats.fetchedAt), note: 'server clock' },
    ]),
  );

  const stylesheets = report.assets?.stylesheets || [];
  if (stylesheets.length) {
    const rows = stylesheets.map((sheet) => `<tr>
      <td>${esc(sheet.label)}${sheet.inline ? ' <span class="chip chip--outline">inline</span>' : ''}${sheet.imported ? ' <span class="chip chip--outline">imported</span>' : ''}</td>
      <td class="cell-code">${typeof sheet.status === 'number' ? `HTTP ${sheet.status}` : esc(sheet.status || '—')}</td>
      <td class="cell-num">${sheet.bytes ? fmtBytes(sheet.bytes) : '—'}</td>
      <td class="cell-code cell-muted">${esc(sheet.media || '—')}</td>
      <td class="cell-url">${sheet.url ? tableLink(sheet.url, prettyUrl(sheet.url, 60)) : esc(sheet.error || 'inline')}</td>
    </tr>`);
    parts.push(subhead('Stylesheets', `${stylesheets.length} sources`), renderTable(['Label', 'Status', 'Bytes', 'Media', 'URL'], rows, { visible: 40 }));
  }

  const scripts = report.assets?.scripts || [];
  if (scripts.length) {
    const rows = scripts.map((script) => `<tr>
      <td>${esc(script.label)}${script.inline ? ' <span class="chip chip--outline">inline</span>' : ''}</td>
      <td class="cell-code">${[script.module ? 'module' : '', script.defer ? 'defer' : '', script.async ? 'async' : ''].filter(Boolean).join(' ') || 'classic'}</td>
      <td class="cell-code">${typeof script.status === 'number' ? `HTTP ${script.status}` : esc(script.status || '—')}</td>
      <td class="cell-num">${script.bytes ? fmtBytes(script.bytes) : '—'}</td>
      <td class="cell-url">${script.url ? tableLink(script.url, prettyUrl(script.url, 60)) : esc(script.error || 'inline')}</td>
    </tr>`);
    parts.push(subhead('Scripts', `${scripts.length} sources`), renderTable(['Label', 'Type', 'Status', 'Bytes', 'URL'], rows, { visible: 40 }));
  }

  const warnings = report.warnings || [];
  if (warnings.length) {
    parts.push(
      subhead('Warnings', `${warnings.length} notes`),
      `<div class="callout-list">${warnings.map((warning) => `<p class="callout callout--warn">${esc(warning)}</p>`).join('')}</div>`,
    );
  }

  const notes = report.notes || [];
  if (notes.length) {
    parts.push(
      subhead('Reading notes', 'how to interpret this report'),
      `<div class="callout-list">${notes.map((note) => `<p class="callout">${esc(note)}</p>`).join('')}</div>`,
    );
  }

  const json = JSON.stringify(report, null, 2);
  parts.push(
    subhead('Raw report', `${fmtInt(json.length)} characters`),
    `<details class="raw-details">
      <summary>Preview the machine-readable report</summary>
      <pre class="raw-pre">${esc(json.slice(0, 24000))}${json.length > 24000 ? '\n… truncated preview — download for the full report.' : ''}</pre>
      <div class="raw-foot">
        <span>${fmtInt(json.length)} characters · JSON</span>
        <span class="report-actions">
          <button class="btn btn--sm" type="button" data-action="copy-json">Copy JSON</button>
          <button class="btn btn--sm btn--ink" type="button" data-action="download-json">Download JSON</button>
        </span>
      </div>
    </details>`,
  );

  return section(
    'report-code',
    'E',
    'Source inventory',
    'What we fetched, what answered, how big it was and every caveat attached to this read.',
    parts.join(''),
    true,
  );
}

/* --------------------- linked pages & site structure -------------------- */

function pageKeyOf(url) {
  try {
    const parsed = new URL(String(url));
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname === '/' || !parsed.pathname.endsWith('/')
      ? parsed.pathname || '/'
      : parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path.toLowerCase()}${parsed.search.toLowerCase()}`;
  } catch {
    return String(url || '').toLowerCase();
  }
}

function pathOf(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.pathname === '/' ? '/ (home)' : parsed.pathname;
  } catch {
    return limited(String(url || ''), 40);
  }
}

function sharedChip({ text, count, total }) {
  const share = total ? Math.round((count / total) * 100) : 0;
  const acid = count === total;
  return chip(
    `${esc(text)} <span class="chip__share">${fmtInt(count)}/${fmtInt(total)} · ${share}%</span>`,
    acid ? 'acid' : '',
  );
}

/* Sitemap: the entry page plus every page the crawl reached, arranged by the
   link that surfaced it. Failure notes sit under the tree, not inside it. */
function sitemapTree(report, crawl) {
  const pages = crawl.pages || [];
  const failed = crawl.failed || [];
  const seedKey = pageKeyOf(crawl.seedUrl || report.finalUrl);
  const byKey = new Map(pages.map((page) => [page.key || pageKeyOf(page.url), page]));

  const children = new Map();
  for (const page of pages) {
    let parent = page.via || seedKey;
    if (parent !== seedKey && !byKey.has(parent)) parent = seedKey;
    const list = children.get(parent) || [];
    list.push(page);
    children.set(parent, list);
  }

  const node = (page) => {
    const label = pathOf(page.url);
    return `<span class="sitemap__node">
      <a class="sitemap__name" href="#page-${esc(page.key || pageKeyOf(page.url))}">${esc(label)}</a>
      <span class="chips sitemap__chips">
        <span class="chip">${esc(page.role || 'page')}</span>
        <span class="chip">score <strong>${fmtInt(page.summary?.motionScore)}</strong></span>
        <span class="chip">${fmtInt(page.summary?.words ?? 0)} words</span>
      </span>
    </span>`;
  };

  const levelTwo = (parentKey) => {
    const kids = children.get(parentKey) || [];
    if (!kids.length) return '';
    return `<ul class="sitemap__branch">${kids
      .map((page) => `<li>${node(page)}${levelTwo(page.key || pageKeyOf(page.url))}</li>`)
      .join('')}</ul>`;
  };

  const failures = failed.length
    ? `<ul class="sitemap__failures">${failed
        .map(
          (failure) => `<li><span class="sitemap__node sitemap__node--failed">
            <span class="sitemap__name">${esc(pathOf(failure.url))}</span>
            <span class="chips sitemap__chips"><span class="chip chip--ember">${esc(limited(failure.reason, 60))}</span></span>
          </span></li>`,
        )
        .join('')}</ul>`
    : '';

  return `<div class="sitemap">
    <ul class="sitemap__branch sitemap__branch--root">
      <li>
        <span class="sitemap__node sitemap__node--seed">
          <span class="sitemap__name">${esc('/ (entry page)')}</span>
          <span class="chips sitemap__chips">
            <span class="chip chip--acid">entry</span>
            <span class="chip">score <strong>${fmtInt(report.summary?.motionScore)}</strong></span>
          </span>
        </span>
        ${levelTwo(seedKey)}
        ${children.size || failures ? '' : ''}
      </li>
    </ul>
    ${failures}
  </div>`;
}

/* One crawled page, rendered with the same tables the entry report carries. */
function pageBlock(page, index, total) {
  const m = page.motion || {};
  const design = page.design || {};
  const structure = page.structure || {};
  const s = page.summary || {};
  const key = page.key || pageKeyOf(page.url);
  const parts = [];

  parts.push(
    statGrid([
      { label: 'Motion score', value: fmtInt(s.motionScore), note: s.motionLabel || '—' },
      { label: 'Keyframes', value: fmtInt(m.keyframesTotal ?? s.keyframes), note: `${fmtInt(s.keyframeNames)} names`, count: m.keyframesTotal ?? s.keyframes },
      { label: 'Animation uses', value: fmtInt(s.animationUses), note: `${fmtInt(s.animatedSelectors)} selectors`, count: s.animationUses },
      { label: 'Transitions', value: fmtInt(s.transitions), note: `${fmtInt(s.transitionedSelectors)} selectors`, count: s.transitions },
      { label: 'Libraries', value: fmtInt(s.libraries), note: (m.libraries || []).slice(0, 2).map((l) => l.name).join(', ') || 'none', count: s.libraries },
      { label: 'Scroll signals', value: fmtInt(s.scrollSignals), note: 'systems found', count: s.scrollSignals },
      { label: 'Colors', value: fmtInt(s.colors), note: 'distinct values', count: s.colors },
      { label: 'Words', value: fmtInt(s.words), note: `${fmtInt(s.readingMinutes ?? 0)} min read`, count: s.words },
    ]),
  );

  const keyframeRows = (m.keyframes || []).map((frame) => {
    const used = frame.usedCount
      ? `<span class="chip chip--acid">${fmtInt(frame.usedCount)}×</span>`
      : '<span class="chip chip--outline">unused</span>';
    return `<tr>
      <td><span class="cell-code">${esc(frame.name)}</span></td>
      <td class="cell-num">${fmtInt(frame.frames)}</td>
      <td class="cell-code cell-muted">${esc((frame.properties || []).join(', ') || '—')}</td>
      <td>${used}</td>
      <td class="cell-code cell-muted">${esc(frame.source)}${frame.line ? `:${frame.line}` : ''}</td>
    </tr>`;
  });
  parts.push(
    subhead('Keyframe definitions', `${fmtInt(m.keyframesTotal ?? (m.keyframes || []).length)} declared · condensed read`),
    keyframeRows.length
      ? renderTable(['Keyframe', 'Frames', 'Properties', 'Used', 'Source'], keyframeRows, { visible: 12 })
      : `<div class="asset-empty">No @keyframes blocks were found on this page's readable CSS.</div>`,
  );

  const animationRows = (m.animationUses || []).map((item) => `<tr>
      <td class="cell-code">${esc(limited(item.selector, 110))}</td>
      <td class="cell-code">${esc(item.name)}</td>
      <td class="cell-num">${esc(item.duration || '—')}</td>
      <td class="cell-code">${esc(item.timing || '—')}</td>
      <td class="cell-code">${esc(item.delay || '—')}</td>
      <td class="cell-code cell-muted">${esc(item.timeline || item.media || '—')}</td>
    </tr>`);
  parts.push(
    subhead('Animation assignments', `${fmtInt(m.animationUsesTotal ?? (m.animationUses || []).length)} total`),
    animationRows.length
      ? renderTable(['Selector', 'Name', 'Duration', 'Easing', 'Delay', 'Timeline / media'], animationRows, { visible: 16 })
      : `<div class="asset-empty">No animation declarations were found on this page.</div>`,
  );

  const transitionRows = (m.transitions || []).map((item) => `<tr>
      <td class="cell-code">${esc(limited(item.selector, 110))}</td>
      <td class="cell-code">${esc(item.property || 'all')}</td>
      <td class="cell-num">${esc(item.duration || '—')}</td>
      <td class="cell-code">${esc(item.timing || '—')}</td>
      <td class="cell-code cell-muted">${esc(item.media || '—')}</td>
    </tr>`);
  parts.push(
    subhead('Transition rules', `${fmtInt(m.transitionsTotal ?? (m.transitions || []).length)} total`),
    transitionRows.length
      ? renderTable(['Selector', 'Property', 'Duration', 'Easing', 'Media'], transitionRows, { visible: 16 })
      : `<div class="asset-empty">No transition declarations were found on this page.</div>`,
  );

  /* Tokens */
  const tokens = [];
  const colors = (design.colors || []).slice(0, 24);
  if (colors.length) {
    tokens.push(
      `<div class="ledger-row"><span class="ledger-row__label">Colours</span><div class="swatch-grid swatch-grid--tight">${colors
        .map(
          (color) => `<div class="swatch swatch--tight">
            <span class="swatch__chip"${safeColor(color.value) ? ` style="background:${esc(safeColor(color.value))}"` : ''}></span>
            <span class="swatch__value">${esc(limited(color.value, 28))}</span>
            <span class="swatch__meta">${fmtInt(color.count)}×</span>
          </div>`,
        )
        .join('')}</div></div>`,
    );
  }
  const fonts = design.fonts || [];
  if (fonts.length) {
    tokens.push(
      `<div class="ledger-row"><span class="ledger-row__label">Type</span><div class="chips">${fonts
        .map((font) => chip(`${esc(font.family)} ${fmtInt(font.count ?? 0)}×`))
        .join('')}</div></div>`,
    );
  }
  if (tokens.length) parts.push(subhead('Tokens as read', 'same ledger the design section runs'), `<div class="ledger-rows">${tokens.join('')}</div>`);

  const headings = (structure.headings || []).slice(0, 18);
  if (headings.length) {
    const outline = headings
      .map(
        (heading) => `<li class="outline__item" data-level="${Number(heading.level) || 1}">
          <span class="outline__level">H${Number(heading.level) || 1}</span>
          <span class="outline__text">${esc(heading.text)}</span>
          <span></span>
        </li>`,
      )
      .join('');
    parts.push(subhead('Heading outline', `${fmtInt(structure.wordCount ?? s.words ?? 0)} words of copy read`), `<ol class="outline outline--tight">${outline}</ol>`);
  }

  if (page.warnings?.length) {
    parts.push(
      subhead('Reading notes for this page', 'limits hit while fetching'),
      `<div class="callout-list">${page.warnings.map((warning) => `<p class="callout">${esc(warning)}</p>`).join('')}</div>`,
    );
  }

  const depthTag = page.depth > 1 ? chip(`depth <strong>${fmtInt(page.depth)}</strong>`) : '';
  const viaTag = page.viaText ? chip(`via ${esc(page.viaText)}`, 'outline') : '';

  return `<details class="page-block" id="page-${esc(key)}">
    <summary>
      <span class="page-block__order">${String(index + 1).padStart(2, '0')}</span>
      <span class="page-block__id">
        <span class="page-block__title">${esc(page.title || page.url)}</span>
        <span class="page-block__path">${esc(pathOf(page.url))}</span>
      </span>
      <span class="chips page-block__chips">
        ${chip(esc(page.role || 'page'))}
        ${chip(`score <strong>${fmtInt(s.motionScore)}</strong>`)}
        ${chip(`${fmtInt(s.keyframes)} kf`)}
        ${chip(`${fmtInt(s.transitions)} tr`)}
        ${depthTag}
        ${viaTag}
      </span>
      <span class="page-block__cue" aria-hidden="true">＋</span>
    </summary>
    <div class="page-block__body">
      <p class="page-block__link">${tableLink(page.url, page.url)}</p>
      ${parts.join('')}
    </div>
  </details>`;
}

function crawlSection(report) {
  const crawl = report.crawl;

  if (!crawl) {
    return section(
      'report-crawl',
      'F',
      'Pages & site structure',
      'This read was made before the crawl existed: only the entry page was analysed.',
      `<div class="asset-empty">No linked-page read is attached to this report. Run a new scan with <strong>Linked pages</strong> set to 3, 6 or 10 and webcopy will follow the site's own links.</div>`,
      true,
    );
  }
  if (!crawl.enabled) {
    return section(
      'report-crawl',
      'F',
      'Pages & site structure',
      'This scan read one page — the site crawl was switched off.',
      `<div class="asset-empty">Crawl was off for this read. Switch <strong>Linked pages</strong> to 3, 6 or 10 and webcopy will follow same-site links (About, Contact, Work…) and analyse each with the same motion and design ledgers.</div>`,
      true,
    );
  }

  const pages = crawl.pages || [];
  const failed = crawl.failed || [];
  const totals = crawl.totals || {};
  const shared = crawl.shared || {};
  const parts = [];

  parts.push(
    statGrid([
      { label: 'Pages read', value: fmtInt(totals.pagesRead ?? 1), note: `entry + ${fmtInt(pages.length)} linked`, variant: 'accent', count: totals.pagesRead ?? 1 },
      { label: 'Internal links found', value: fmtInt(totals.discovered ?? 0), note: `${crawl.skipped ? `${fmtInt(crawl.skipped)} left unread` : 'all read'}`, count: totals.discovered },
      { label: 'Failed reads', value: fmtInt(totals.failed ?? 0), note: failed.length ? 'blocked or unreachable' : 'none', variant: (totals.failed ?? 0) > 0 ? 'ember' : '' },
      { label: 'Site motion average', value: fmtInt(totals.avgMotionScore ?? 0), note: `spread ${fmtInt(totals.minMotionScore ?? 0)}–${fmtInt(totals.maxMotionScore ?? 0)}` },
      { label: 'Words read', value: fmtInt(totals.words ?? 0), note: 'across all pages', count: totals.words },
      { label: 'Shared fonts', value: fmtInt((shared.fonts || []).length), note: limited((shared.fonts || []).slice(0, 2).map((f) => f.family).join(', '), 36) || 'none' },
      { label: 'Shared colors', value: fmtInt((shared.colors || []).length), note: 'values seen on 2+ pages' },
      { label: 'Shared libraries', value: fmtInt((shared.libraries || []).length), note: limited((shared.libraries || []).slice(0, 2).map((l) => l.name).join(', '), 36) || 'none' },
    ]),
  );

  if (crawl.stoppedByBudget) {
    parts.push(
      `<div class="callout-list"><p class="callout">The crawl hit its read budget before the link list ran out; counts below cover the pages that were reached.</p></div>`,
    );
  }

  parts.push(
    subhead('Site map', `${fmtInt(pages.length)} linked pages · depth ${fmtInt(crawl.options?.depth ?? 1)} · same host only`),
    sitemapTree(report, crawl),
  );

  if (pages.length) {
    parts.push(
      subhead('Per-page ledgers', 'same tables as section A and B, condensed'),
      pages.map((page, index) => pageBlock(page, index, pages.length)).join(''),
    );
  } else {
    parts.push(
      subhead('Per-page ledgers', 'none completed'),
      `<div class="asset-empty">No linked page could be read. The failures listed in the site map carry the reasons.</div>`,
    );
  }

  /* Shared design system */
  const pageCount = totals.pagesRead ?? 1;
  if ((shared.fonts || []).length || (shared.colors || []).length || (shared.libraries || []).length) {
    const rows = [];
    if ((shared.fonts || []).length) {
      rows.push(
        `<div class="ledger-row"><span class="ledger-row__label">Type</span><div class="chips">${shared.fonts
          .slice(0, 10)
          .map((font) => sharedChip({ text: font.family, count: font.pages, total: pageCount }))
          .join('')}</div></div>`,
      );
    }
    if ((shared.colors || []).length) {
      rows.push(
        `<div class="ledger-row"><span class="ledger-row__label">Colour</span><div class="swatch-grid swatch-grid--tight">${shared.colors
          .slice(0, 16)
          .map(
            (color) => `<div class="swatch swatch--tight">
              <span class="swatch__chip"${safeColor(color.value) ? ` style="background:${esc(safeColor(color.value))}"` : ''}></span>
              <span class="swatch__value">${esc(limited(color.value, 28))}</span>
              <span class="swatch__meta">${fmtInt(color.pages)}/${fmtInt(pageCount)}</span>
            </div>`,
          )
          .join('')}</div></div>`,
      );
    }
    if ((shared.libraries || []).length) {
      rows.push(
        `<div class="ledger-row"><span class="ledger-row__label">Motion</span><div class="chips">${shared.libraries
          .slice(0, 10)
          .map((library) => sharedChip({ text: `${library.name} (${library.category || 'library'})`, count: library.pages, total: pageCount }))
          .join('')}</div></div>`,
      );
    }
    if ((shared.keyframes || []).length) {
      rows.push(
        `<div class="ledger-row"><span class="ledger-row__label">Keyframes reused</span><div class="chips">${shared.keyframes
          .slice(0, 12)
          .map((frame) => sharedChip({ text: frame.name, count: frame.pages, total: pageCount }))
          .join('')}</div></div>`,
      );
    }
    if ((shared.tech || []).length) {
      rows.push(
        `<div class="ledger-row"><span class="ledger-row__label">Tech</span><div class="chips">${shared.tech
          .slice(0, 12)
          .map((tech) => sharedChip({ text: tech.name, count: tech.pages, total: pageCount }))
          .join('')}</div></div>`,
      );
    }
    parts.push(
      subhead("What repeats across pages", "the site's shared design system, as counted"),
      `<div class="ledger-rows">${rows.join('')}</div>`,
    );
  } else {
    parts.push(
      subhead('What repeats across pages', 'nothing matched'),
      `<div class="asset-empty">No font, colour or library appears on more than one page of this read.</div>`,
    );
  }

  /* Navigation labels */
  if ((crawl.navLabels || []).length) {
    parts.push(
      subhead('How the navigation reads', 'entry-page link text, ranked by frequency'),
      `<div class="chips chips--wrap">${crawl.navLabels
        .slice(0, 14)
        .map((entry) => chip(`${esc(entry.label)} <strong>${fmtInt(entry.count)}</strong>`, 'outline'))
        .join('')}</div>`,
    );
  }

  /* Blueprint */
  parts.push(
    subhead('How this site works', 'the closing brief, generated from the numbers above'),
    `<div class="blueprint">
      <pre id="blueprintText" class="blueprint__pre">${esc(crawl.blueprint || 'No blueprint was generated for this read.')}</pre>
      <div class="blueprint__foot">
        <span>${fmtInt((crawl.blueprint || '').length)} characters · plain text</span>
        <span class="report-actions">
          <button class="btn btn--sm" type="button" data-action="copy-blueprint">Copy blueprint</button>
        </span>
      </div>
    </div>`,
  );

  return section(
    'report-crawl',
    'F',
    'Pages & site structure',
    `The crawl followed same-site links and read ${fmtInt(pages.length)} page${pages.length === 1 ? '' : 's'} with the same ledgers — then folded everything into one site plan.`,
    parts.join(''),
    true,
  );
}

/* --------------------------- report assembly ---------------------------- */

function renderReport(report) {
  state.tables.clear();
  state.tableSeq = 0;
  const s = report.summary || {};
  const techNames = (report.tech || []).map((item) => item.name).slice(0, 5);
  const libNames = (report.motion?.libraries || []).map((library) => library.name);

  const hero = `<header class="report-hero">
    <div class="report-hero__bar">
      <span class="live-tag"><i aria-hidden="true"></i>${report.demo ? 'Specimen' : 'Live'} readout</span>
      <span class="report-hero__crumb">${esc(report.host || hostOf(report.finalUrl))} · ${report.demo ? 'fictional specimen' : 'static source read'} · v1.1</span>
      <span class="report-actions">
        <button class="btn btn--sm" type="button" data-action="copy-summary">Copy summary</button>
        <button class="btn btn--sm btn--acid" type="button" data-action="copy-prompt">Copy agent prompt</button>
        <button class="btn btn--sm btn--ink" type="button" data-action="download-json">Download JSON</button>
        <button class="btn btn--sm" type="button" data-action="new-scan">New scan ↺</button>
      </span>
    </div>
    <div class="report-hero__grid">
      <div>
        <p class="report-kicker">Motion forensics / ${esc(s.motionLabel || 'readout')}</p>
        <h1 class="report-title">${esc(report.host || report.finalUrl)}</h1>
        <p class="report-sub">${esc(report.requestedUrl)} → ${esc(report.finalUrl)}</p>
        <div class="report-tags">
          ${report.demo ? chip('demo specimen', 'acid') : chip('live read')}
          ${report.crawl?.enabled ? chip(`${fmtInt(report.crawl.totals?.pagesRead ?? 0)} pages read`, 'acid') : ''}
          ${chip(`score <strong>${fmtInt(s.motionScore)}</strong>` )}
          ${chip(`${fmtInt(s.motionSignatures)} signatures`)}
          ${chip(`${fmtInt(s.assets)} assets`)}
          ${s.imagesMissingAlt ? chip(`${fmtInt(s.imagesMissingAlt)} images missing alt`, 'ember') : chip('all images labelled')}
          ${report.warnings?.length ? chip(`${report.warnings.length} warnings`, 'ember') : ''}
          ${techNames.map((name) => chip(esc(name))).join('')}
        </div>
      </div>
      <aside class="report-score" aria-label="Motion score breakdown">
        <div class="report-score__value"><strong>${fmtInt(s.motionScore)}</strong><span>/ 100</span></div>
        <p class="report-score__label">${esc(s.motionLabel || 'Readout')} · motion density</p>
        <div class="report-score__parts">
          ${(report.motion?.parts || [])
            .map(
              (part) => `<div class="part">
                <span>${esc(part.label)}</span><span>${fmtInt(part.value)} / ${fmtInt(part.max)}</span>
                <span class="part__bar"><span class="part__fill" data-w="${Math.round((part.value / part.max) * 100)}" style="--w:0%"></span></span>
              </div>`,
            )
            .join('')}
        </div>
        <p class="report-score__method">${esc(report.motion?.method || '')}</p>
      </aside>
    </div>
    <div class="report-facts">
      ${statGrid([
        { label: 'Keyframes', value: fmtInt(s.keyframes), note: `${fmtInt(s.keyframeNames)} names`, count: s.keyframes },
        { label: 'Animation uses', value: fmtInt(s.animationUses), note: `${fmtInt(s.animatedSelectors)} selectors`, count: s.animationUses },
        { label: 'Transitions', value: fmtInt(s.transitions), note: `${fmtInt(s.transitionedSelectors)} selectors`, count: s.transitions },
        { label: 'Libraries', value: fmtInt(s.libraries), note: limited(libNames.slice(0, 3).join(', '), 40) || 'none', count: s.libraries },
        { label: 'JS triggers', value: fmtInt(s.jsTriggers), note: 'runtime signals', count: s.jsTriggers },
        { label: 'Scroll signals', value: fmtInt(s.scrollSignals), note: 'systems found', count: s.scrollSignals },
        { label: 'Images', value: fmtInt(s.images), note: s.imagesMissingAlt ? `${fmtInt(s.imagesMissingAlt)} missing alt` : 'all labelled', count: s.images },
        { label: 'Links', value: fmtInt(s.links), note: `${fmtInt(s.assets)} assets total`, count: s.links },
      ])}
    </div>
  </header>`;

  const nav = `<nav class="report-nav" id="reportNav" aria-label="Report sections">
    <div class="report-nav__inner">
      <a class="report-nav__link" href="#report-motion">A · Motion</a>
      <a class="report-nav__link" href="#report-design">B · Design</a>
      <a class="report-nav__link" href="#report-prompt">✦ · Prompt</a>
      <a class="report-nav__link" href="#report-assets">C · Assets</a>
      <a class="report-nav__link" href="#report-structure">D · Structure</a>
      <a class="report-nav__link" href="#report-code">E · Source</a>
      <a class="report-nav__link" href="#report-crawl">F · Pages</a>
      <span class="report-nav__spacer"></span>
      <span class="report-nav__meta">Read ${esc(fmtDate(report.fetchedAt))}</span>
    </div>
  </nav>`;

  const foot = `<footer class="report-foot">
    <div>
      <h2>Read another <span class="serif">room.</span></h2>
      <p>Paste a new address and webcopy will fetch it, parse the stylesheets and scripts again, and bind a fresh report. Nothing from this read is stored.</p>
      <div class="report-actions">
        <button class="btn btn--acid" type="button" data-action="new-scan">New scan <span aria-hidden="true">↑</span></button>
        <button class="btn btn--ghost-light" type="button" data-action="copy-prompt">Copy agent prompt</button>
        <button class="btn btn--ghost-light" type="button" data-action="copy-summary">Copy summary</button>
      </div>
    </div>
    <div>
      <h2>Measured, <span class="serif">not guessed.</span></h2>
      <p>Counts describe declarations and code signatures in the delivered source — not rendered frames, performance or visual quality. Read the warnings and notes before quoting a number.</p>
    </div>
  </footer>`;

  refs.reportView.innerHTML = `${hero}${nav}
    ${motionSection(report)}
    ${designSection(report)}
    ${promptSection(report)}
    ${assetsSection(report)}
    ${structureSection(report)}
    ${sourceSection(report)}
    ${crawlSection(report)}
    ${foot}`;

  showReport(report);
  setupAssetExplorer();
  setupCounters(refs.reportView);
  requestAnimationFrame(() => {
    $$('[data-w]', refs.reportView).forEach((node) => {
      node.style.setProperty('--w', `${node.dataset.w}%`);
    });
  });
}

/* --------------------------------- wiring ------------------------------- */

function setupReportNav() {
  const links = $$('.report-nav__link', refs.reportView);
  if (!links.length) return;
  const sections = links
    .map((link) => $(link.getAttribute('href'), refs.reportView))
    .filter(Boolean);
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((link) => {
          link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
        });
      }
    },
    { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
  );
  sections.forEach((node) => observer.observe(node));
}

function setupAssetExplorer() {
  refs.assetList = $('#assetList', refs.reportView);
  refs.assetCount = $('#assetCount', refs.reportView);
  const search = $('#assetSearch', refs.reportView);
  if (search) {
    search.addEventListener('input', () => {
      state.assetQuery = search.value;
      paintAssetList();
    });
  }
  $$('.js-asset-filter', refs.reportView).forEach((button) => {
    button.addEventListener('click', () => {
      state.assetFilter = button.dataset.assetFilter;
      $$('.js-asset-filter', refs.reportView).forEach((node) => node.classList.toggle('is-active', node === button));
      paintAssetList();
    });
  });
  paintAssetList();
}

function setupCounters(root) {
  const nodes = $$('[data-count]', root);
  if (!nodes.length || reducedMotion()) {
    nodes.forEach((node) => {
      node.textContent = fmtInt(node.dataset.count);
    });
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const target = Number(entry.target.dataset.count) || 0;
        const start = performance.now();
        const duration = 850;
        const tick = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          entry.target.textContent = fmtInt(target * eased);
          if (t < 1) requestAnimationFrame(tick);
          else entry.target.textContent = fmtInt(target);
        };
        requestAnimationFrame(tick);
      }
    },
    { threshold: 0.35 },
  );
  nodes.forEach((node) => observer.observe(node));
}

function setupLanding() {
  const reveals = $$('[data-land-reveal]');
  if (!reveals.length) return;
  if (reducedMotion()) {
    reveals.forEach((node) => node.classList.add('is-revealed'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.18 },
  );
  reveals.forEach((node) => observer.observe(node));
}

function setupDrawer() {
  const drawer = $('[data-auto-open]');
  if (!drawer) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        drawer.open = true;
        observer.disconnect();
      }
    },
    { threshold: 0.4 },
  );
  observer.observe(drawer);
}

function selectLandingHash(href) {
  const id = href.split('#')[1];
  if (!id) return false;
  const target = document.getElementById(id);
  if (!target) return false;
  showLanding({ focus: false });
  setTimeout(() => target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }), 60);
  return true;
}

function wireEvents() {
  refs.form.addEventListener('submit', (event) => {
    event.preventDefault();
    startScan(refs.input.value);
  });

  refs.input.addEventListener('input', hideFormError);

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const sample = target.closest('[data-sample]');
    if (sample) {
      refs.input.value = sample.dataset.sample;
      startScan(sample.dataset.sample);
      return;
    }

    const demo = target.closest('[data-demo]');
    if (demo) {
      startScan('', { demo: true });
      return;
    }

    if (target.closest('[data-new-scan]')) {
      showLanding();
      return;
    }

    if (target.closest('[data-focus-scan]')) {
      refs.input.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      setTimeout(() => refs.input.focus({ preventScroll: true }), 320);
      return;
    }

    if (target.closest('[data-retry-scan]')) {
      if (state.lastUrl && state.lastUrl !== 'aurelia-studio.example') {
        startScan(state.lastUrl);
      } else if (state.demo) {
        startScan('', { demo: true });
      } else {
        hideOverlay();
        showLanding();
      }
      return;
    }

    if (target.closest('[data-error-demo]')) {
      startScan('', { demo: true });
      return;
    }

    if (target.closest('[data-close-overlay]')) {
      hideOverlay();
      if (refs.input) refs.input.focus({ preventScroll: true });
      return;
    }

    if (target.closest('#scanCancel')) {
      cancelScan();
      return;
    }

    const hashLink = target.closest('a[href^="/#"]');
    if (hashLink) {
      event.preventDefault();
      selectLandingHash(hashLink.getAttribute('href').replace(/^\//, ''));
      return;
    }

    const more = target.closest('[data-more]');
    if (more) {
      const table = state.tables.get(more.dataset.more);
      const tbody = $(`[data-tbody="${more.dataset.more}"]`);
      if (table && tbody) {
        const next = table.rows.splice(0, table.chunk);
        const holder = document.createElement('template');
        holder.innerHTML = next.join('');
        tbody.insertBefore(holder.content, more.closest('tr'));
        if (table.rows.length) more.textContent = `Show ${fmtInt(table.rows.length)} more rows`;
        else more.closest('tr').remove();
      }
      return;
    }

    const action = target.closest('[data-action]');
    if (action && state.report) {
      const name = action.dataset.action;
      if (name === 'new-scan') showLanding();
      else if (name === 'copy-summary') copyText(summaryText(state.report), 'Summary copied.');
      else if (name === 'download-json') downloadJson();
      else if (name === 'copy-json') copyText(JSON.stringify(state.report, null, 2), 'Full JSON copied.');
      else if (name === 'copy-prompt') {
        if (state.report.prompt) copyText(state.report.prompt, 'Agent prompt copied — paste it anywhere.');
        else toast('This report has no agent prompt.');
      } else if (name === 'download-prompt') {
        downloadPrompt();
      } else if (name === 'copy-blueprint') {
        const blueprint = state.report.crawl?.blueprint;
        if (blueprint) copyText(blueprint, 'Site blueprint copied.');
        else toast('This report has no site blueprint.');
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!refs.overlay.hidden) {
      if (state.scanning) cancelScan();
      else {
        hideOverlay();
        if (refs.input) refs.input.focus({ preventScroll: true });
      }
    }
  });
}

function init() {
  refs.body = document.body;
  refs.toast = $('#toast');
  refs.form = $('#scanForm');
  refs.input = $('#urlInput');
  refs.submit = $('.scan-submit', refs.form);
  refs.formError = $('#formError');
  refs.shell = $('#scanShell');
  refs.crawlPages = $('#crawlPages');
  refs.crawlDepth = $('#crawlDepth');
  refs.landing = $('#landingView');
  refs.reportView = $('#reportView');
  refs.newScan = $('.js-new-scan');
  refs.overlay = $('#scanOverlay');
  refs.cancel = $('#scanCancel');
  refs.live = $('#scanLive');
  refs.fail = $('#scanFail');
  refs.failTitle = $('#scanFailTitle');
  refs.failMessage = $('#scanFailMessage');
  refs.failCode = $('#scanFailCode');
  refs.progress = $('#scanProgress');
  refs.progressFill = $('#scanProgressFill');
  refs.percent = $('#scanPercent');
  refs.log = $('#scanLog');
  refs.detail = $('#scanDetail');
  refs.host = $('#scanTitle');
  refs.mode = $('#scanMode');
  refs.specimen = $('#scanSpecimen');

  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  wireEvents();
  setupLanding();
  setupDrawer();
}

init();
