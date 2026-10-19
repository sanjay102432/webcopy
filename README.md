# webcopy

**Motion forensics for the web.** Paste a public website link and webcopy reads
the delivered HTML, CSS and JavaScript — then counts every keyframe, animation
assignment, transition, scroll system, animation library, design token, asset
and outbound link it can find, and gives you the receipts as a browsable
report plus clean JSON.

```
npm install
npm start        # http://localhost:4173
```

No build step. Node 20.11+ required.

## What it reads

webcopy performs a **static read of the delivered source**. It never renders,
screenshots or executes the target page.

| Ledger | Contents |
| --- | --- |
| **A · Motion** | `@keyframes` definitions and their frame maps, animation shorthand/longhand assignments, transition rules, easing curves, duration statistics, motion libraries (GSAP, Lenis, AOS, Lottie, Swiper, Three.js, …), JS runtime triggers (`requestAnimationFrame`, WAAPI, observers, pointer tracking, view transitions), scroll systems (`animation-timeline` with ranges and named timelines, scroll snap types, smooth scroll, sticky elements with offsets, ScrollTrigger configs — scrub, pin, start/end, toggleClass — IntersectionObserver thresholds/rootMargins, scroll position reads, scroll libraries), special surfaces (SMIL, canvas, WebGL, marquee, animated GIFs, autoplay video), reduced-motion coverage |
| **B · Design** | Color frequency, type families with specimens, per-rule typography (family, size, weight, line-height, letter-spacing, transforms), measurement buckets for weights/line-heights/spacing, `@font-face` rules, font files, type scale, radii, shadows, gradients, CSS custom properties, breakpoints, registered `@property` definitions |
| **C · Assets** | Images with alt-text audit, srcsets and picture sources, video elements and files, embeds (YouTube/Vimeo/…), iframes, stylesheets, scripts, fonts, CSS-referenced files, meta images, every internal/external/mailto link and external domain — all searchable and filterable |
| **D · Structure** | Metadata (title, description, canonical, OG/Twitter, viewport…), detected frameworks/CMS/builders, heading outline, sections, landmarks, forms and input types, word count, JSON-LD |
| **E · Source** | Page status, byte counts for HTML/CSS/JS, resources read/failed/skipped, warnings, reading notes and the full machine-readable JSON |

Each report ends with a composite **motion score** (0–100) across six measured
parts. It describes motion *density in the source*, not visual quality,
performance or accessibility.

Every report also carries one **agent prompt** (`report.prompt`): a single
copy-ready brief written so an AI agent or a teammate can rebuild the site
without ever seeing it. It walks through, in order: the target and page
skeleton; the design system (palette, tokens, shape, breakpoints);
**typography** (families with face/file details, grouped type specimens,
size/weight/line-height/spacing buckets); the **image, video, embed and meta
inventory** (URLs, alt text, dimensions, srcset and poster details); the
**motion system** (every `@keyframes`, animation assignment, transition,
easing and library); and a **scroll choreography** section that details every
scroll behaviour found — scroll-driven animation timelines with their ranges,
sticky elements and offsets, scroll snap, scripted scrub/pin/start/end
configs, IntersectionObserver thresholds and root margins, smooth-scroll
library options, and markup `data-*` reveal hooks with sample values — plus
reduced-motion and fidelity rules. The UI shows it right after the design
ledger with copy and download-as-Markdown actions.

## How it works

- Fetches the page with [undici](https://github.com/nodejs/undici) using manual
  redirect handling, a 5 MB document ceiling, per-file size limits and a
  connect-time private-network guard (DNS is resolved and filtered per request).
- Parses HTML with [Cheerio](https://cheerio.js.org/), CSS with
  [PostCSS](https://postcss.org/), and scripts with normalized regex signal
  scans.
- Streams progress to the browser over Server-Sent Events
  (`/api/analyze/stream`), with `POST /api/analyze` as a JSON fallback.
- Treats every scraped string as untrusted: the front end escapes all text and
  validates URLs, colors, gradients and font stacks before injecting them.

The fictional **Aurelia Studio** specimen (`/api/demo`, or the *specimen*
buttons in the UI) exercises the whole pipeline without touching the network.

## API

| Route | Description |
| --- | --- |
| `GET /api/health` | Liveness check |
| `GET /api/demo` | Full demo report (no network) |
| `GET /api/analyze?url=…` | Blocking JSON analysis |
| `POST /api/analyze` | JSON analysis, body `{ "url": "…", "demo": false }` |
| `GET /api/analyze/stream?url=…` | SSE progress + `{type:'result'|'fail'}` messages. `?demo=1` streams the specimen |
| `GET /api/analyze/stream?demo=1` | Streamed demo |

Errors use a stable shape:

```json
{ "error": { "message": "…", "code": "DNS_FAILED", "detail": "…" } }
```

## Limits & privacy

- Public `http(s)` pages only, no logins. Private/local addresses are blocked
  unless `ALLOW_PRIVATE=1` is set.
- Reads at most 5 MB of HTML, 1.2 MB per stylesheet, 950 KB per script.
- Up to 14 external stylesheets, 14 external scripts and 6 CSS `@import`s per
  scan; the report notes anything skipped.
- Rate limit: 60 scans per IP per 10 minutes (configurable).
- Reports are generated in memory and returned; **nothing is stored**.

## Configuration

Copy `.env.example` to `.env`:

```
PORT=4173             # server port
ALLOW_PRIVATE=1       # allow localhost/private targets (development only)
RATE_LIMIT_PER_10M=60 # scans per IP per 10 minutes
NODE_ENV=production   # serves static assets with cache headers
```

## Tests

```
npm test
```

Covers URL normalization, private-address blocking, CSS motion extraction,
the inline-source pipeline and the demo specimen integrity.

## Known limits

Counts describe declarations and code signatures in delivered source. Browser
computed styles, cross-origin iframes, shadow DOM, canvas frames, video
contents and runtime-injected animations are not rendered or executed. A
keyframe can be defined and never used; a single transition can affect every
element on a page. Read the warnings in each report before quoting a number.

## License

MIT
