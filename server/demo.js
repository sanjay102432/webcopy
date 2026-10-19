import { analyzeSources } from './analyzer.js';

const DEMO_URL = 'https://aurelia-studio.example/';

const DEMO_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aurelia Studio — Objects in motion</title>
  <meta name="description" content="Aurelia is an independent design practice building tactile identities, digital objects and slow-moving experiences for cultural and consumer brands.">
  <meta name="theme-color" content="#14140f">
  <meta name="generator" content="Framer">
  <meta property="og:title" content="Aurelia Studio — Objects in motion">
  <meta property="og:description" content="Identities and digital objects made to be felt.">
  <meta property="og:image" content="https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1600&q=80">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="https://aurelia-studio.example/">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/aurelia-grotesk.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/site.css">
  <script type="module" src="/assets/main.js"></script>
  <script defer src="/assets/interactions.js"></script>
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"ProfessionalService","name":"Aurelia Studio","description":"Independent design practice","areaServed":"Worldwide"}
  </script>
</head>
<body data-framer>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="Aurelia Studio home">
      <span class="brand__mark" aria-hidden="true"></span>
      Aurelia
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a href="#work" data-scroll>Work</a>
      <a href="#approach" data-scroll>Approach</a>
      <a href="#journal" data-scroll>Journal</a>
      <a class="button button--small" href="#contact">Start a project</a>
    </nav>
  </header>

  <main id="main">
    <section class="hero" id="hero">
      <div class="hero__copy">
        <p class="eyebrow" data-aos="fade-up">Independent design practice / Copenhagen / 2026</p>
        <h1 class="hero__title" data-aos="fade-up" data-aos-delay="100">
          Objects in <em>motion.</em>
        </h1>
        <p class="hero__lede" data-aos="fade-up" data-aos-delay="180">
          We build tactile identities and digital objects for brands that would
          rather be felt than scrolled past.
        </p>
        <div class="hero__actions">
          <a class="button" href="#work" data-scroll>View the work <span aria-hidden="true">↘</span></a>
          <a class="text-link" href="#approach" data-scroll>Our approach</a>
        </div>
      </div>

      <figure class="hero__visual" data-reveal data-scroll-speed="1.6">
        <img
          src="https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1400&q=85"
          srcset="https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=700&q=80 700w, https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1400&q=85 1400w"
          sizes="(max-width: 720px) 100vw, 52vw"
          alt="Soft concrete curves of a modernist pavilion at golden hour"
          width="1400" height="1750" loading="eager" fetchpriority="high">
        <figcaption>
          <span>01 / Form study</span>
          <span>Copenhagen, 2026</span>
        </figcaption>
        <span class="pulse-dot" aria-hidden="true"></span>
      </figure>

      <div class="hero__orb" aria-hidden="true" style="animation: drift 16s cubic-bezier(.16,1,.3,1) infinite alternate;"></div>
    </section>

    <div class="marquee" aria-hidden="true">
      <div class="marquee__track">
        <span>IDENTITY</span><i></i><span>DIGITAL</span><i></i><span>OBJECTS</span><i></i><span>MOTION</span><i></i>
        <span>IDENTITY</span><i></i><span>DIGITAL</span><i></i><span>OBJECTS</span><i></i><span>MOTION</span><i></i>
      </div>
    </div>

    <section class="work" id="work">
      <div class="section-intro">
        <p class="eyebrow" data-aos="fade-right">Selected work / 2024—2026</p>
        <h2 data-aos="fade-up">Quietly <em>loud.</em></h2>
        <p data-aos="fade-up">Three objects, built around a single gesture. Each one is designed to unfold at the speed of a glance.</p>
      </div>

      <div class="work-grid">
        <article class="card" data-reveal>
          <a href="/work/kinetic-house" class="card__link">
            <div class="card__media">
              <img src="https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=1200&q=80" alt="White geometric house against a pale blue sky" width="1200" height="900" loading="lazy">
              <span class="card__tag">Architecture</span>
            </div>
            <h3>Kinetic House</h3>
            <p>A home that changes posture with the sun. Identity, wayfinding and a slow web film.</p>
          </a>
        </article>

        <article class="card" data-reveal>
          <a href="/work/soft-machine" class="card__link">
            <div class="card__media">
              <img src="https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1200&q=80" alt="Sculptural glass forms catching amber light" width="1200" height="900" loading="lazy">
              <span class="card__tag">Product</span>
            </div>
            <h3>Soft Machine</h3>
            <p>An adaptive identity for a furniture studio, drawn with light and drag.</p>
          </a>
        </article>

        <article class="card card--text" data-reveal>
          <div class="card__media card__media--plain">
            <span class="index">03</span>
            <p data-lottie="https://aurelia-studio.example/assets/orbit.json">Orbit is a living archive of the studio's experiments in type, space and motion.</p>
            <a class="text-link" href="https://orbit.aurelia-studio.example" target="_blank" rel="noopener noreferrer">Visit Orbit ↗</a>
          </div>
          <h3>Orbit Archive</h3>
          <p>Ongoing. A public notebook for work that is not quite finished.</p>
        </article>
      </div>
    </section>

    <section class="approach" id="approach">
      <div class="approach__sticky">
        <p class="eyebrow" data-aos="fade-right">The approach / 02</p>
        <h2 data-aos="fade-up">We design<br><em>the pause.</em></h2>
        <div class="meter" aria-hidden="true">
          <span class="meter__label">Attention</span>
          <span class="meter__track"><span class="meter__fill" style="--value: 82%"></span></span>
          <span class="meter__value">82</span>
        </div>
        <div class="meter" aria-hidden="true">
          <span class="meter__label">Restraint</span>
          <span class="meter__track"><span class="meter__fill" style="--value: 64%"></span></span>
          <span class="meter__value">64</span>
        </div>
        <div class="meter" aria-hidden="true">
          <span class="meter__label">Surprise</span>
          <span class="meter__track"><span class="meter__fill" style="--value: 91%"></span></span>
          <span class="meter__value">91</span>
        </div>
      </div>

      <div class="approach__steps">
        <article data-reveal>
          <span class="step-index">01</span>
          <h3>Read the room</h3>
          <p>We begin with the material at hand: a street, a surface, a half-finished thought. Research is a form of listening.</p>
        </article>
        <article data-reveal>
          <span class="step-index">02</span>
          <h3>Find the gesture</h3>
          <p>Every project gets one unmistakable physical move. A tilt, a reveal, a rhythm. Everything else supports it.</p>
        </article>
        <article data-reveal>
          <span class="step-index">03</span>
          <h3>Let it move</h3>
          <p>Motion is not decoration. It is how an object tells you it is alive. We tune it until it feels inevitable.</p>
        </article>
      </div>
    </section>

    <section class="reel" id="reel">
      <div class="section-intro">
        <p class="eyebrow" data-aos="fade-up">Studio reel / 2026</p>
        <h2 data-aos="fade-up">A minute of <em>weather.</em></h2>
      </div>
      <video
        class="reel__video"
        autoplay
        muted
        loop
        playsinline
        preload="metadata"
        poster="https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1600&q=80"
        data-reveal>
        <source src="https://cdn.aurelia-studio.example/reel/weather.webm" type="video/webm">
        <source src="https://cdn.aurelia-studio.example/reel/weather.mp4" type="video/mp4">
        Your browser does not support the video tag.
      </video>
      <div class="reel__meta">
        <span>Direction / Aurelia</span>
        <span>Sound / Hana K.</span>
        <span>1:04</span>
      </div>
      <canvas class="reel__canvas" width="800" height="480" aria-hidden="true"></canvas>
    </section>

    <section class="journal" id="journal">
      <div class="section-intro">
        <p class="eyebrow" data-aos="fade-up">Journal / Notes on making</p>
        <h2 data-aos="fade-up">Loose <em>thoughts.</em></h2>
      </div>
      <div class="journal__list">
        <a href="/journal/designing-for-the-glance" data-scroll>
          <span class="journal__date">May 2026</span>
          <span class="journal__title">Designing for the glance, not the gaze</span>
          <span class="journal__arrow" aria-hidden="true">↗</span>
        </a>
        <a href="/journal/against-the-auto-scroll" data-scroll>
          <span class="journal__date">March 2026</span>
          <span class="journal__title">Against the auto-scroll</span>
          <span class="journal__arrow" aria-hidden="true">↗</span>
        </a>
        <a href="/journal/a-case-for-slow-interfaces" data-scroll>
          <span class="journal__date">January 2026</span>
          <span class="journal__title">A case for slow interfaces</span>
          <span class="journal__arrow" aria-hidden="true">↗</span>
        </a>
      </div>
    </section>

    <section class="contact" id="contact">
      <p class="eyebrow" data-aos="fade-up">Start something / Worldwide</p>
      <h2 data-aos="fade-up">Bring us your <em>unfinished</em> idea.</h2>
      <form class="contact__form" action="/contact" method="post">
        <label for="email">Your email</label>
        <input id="email" name="email" type="email" placeholder="you@studio.com" autocomplete="email" required>
        <label for="message">A few words</label>
        <textarea id="message" name="message" rows="3" placeholder="What are you making?"></textarea>
        <button class="button" type="submit">Send the note <span aria-hidden="true">↗</span></button>
      </form>
      <div class="contact__aside">
        <img src="https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=80" width="800" height="1000" loading="lazy">
        <span class="pulse-dot" aria-hidden="true"></span>
      </div>
    </section>

    <section class="embed" aria-label="Studio interview">
      <iframe
        src="https://www.youtube.com/embed/ScMzIvxBSi4"
        title="Aurelia Studio — a conversation on motion"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen></iframe>
    </section>

    <svg class="signature" viewBox="0 0 420 80" aria-hidden="true">
      <path d="M8 56 C 42 10, 66 72, 102 40 S 160 6, 196 44 S 262 78, 300 36 S 370 12, 412 48" fill="none" stroke="#ff4d1d" stroke-width="2">
        <animate attributeName="stroke-dashoffset" values="320;0" dur="2.4s" repeatCount="indefinite" />
      </path>
    </svg>
  </main>

  <footer class="site-footer">
    <div>
      <span class="brand__mark" aria-hidden="true"></span>
      <p>Aurelia Studio<br>Refshalevej 163A<br>1432 Copenhagen K</p>
    </div>
    <div>
      <p class="footer-label">Elsewhere</p>
      <a href="https://www.instagram.com" target="_blank" rel="noopener noreferrer">Instagram ↗</a>
      <a href="https://www.are.na" target="_blank" rel="noopener noreferrer">Are.na ↗</a>
      <a href="mailto:hello@aurelia-studio.example">hello@aurelia-studio.example</a>
    </div>
    <div>
      <p class="footer-label">Studio</p>
      <a href="/about">About</a>
      <a href="/journal">Journal</a>
      <a href="/privacy">Privacy</a>
    </div>
    <p class="copyright">© 2026 Aurelia Studio. All motion reserved.</p>
  </footer>
</body>
</html>`;

const DEMO_CSS = `
@font-face {
  font-family: "Aurelia Grotesk";
  src: url("/fonts/aurelia-grotesk.woff2") format("woff2"), url("/fonts/aurelia-grotesk.woff") format("woff");
  font-weight: 300 800;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Editorial Serif";
  src: url("/fonts/editorial-serif.woff2") format("woff2");
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}
:root {
  --ink: #14140f;
  --paper: #f3efe4;
  --paper-deep: #e8e1d1;
  --ember: #ff4d1d;
  --acid: #dfff4f;
  --cobalt: #2c46ff;
  --muted: #6d6a5f;
  --line: rgba(20, 20, 15, 0.18);
  --font-sans: "Aurelia Grotesk", "Helvetica Neue", sans-serif;
  --font-serif: "Editorial Serif", Georgia, serif;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --radius-card: 22px;
  --shadow-lift: 10px 10px 0 #14140f;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: clamp(16px, 1.15vw, 19px);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
::selection { background: var(--acid); color: var(--ink); }
img, video, iframe { display: block; max-width: 100%; }
a { color: inherit; text-decoration: none; }
.skip-link {
  position: absolute; top: -100px; left: 24px; z-index: 80;
  background: var(--ink); color: var(--paper); padding: 12px 18px;
  transition: top 220ms var(--ease-out);
}
.skip-link:focus { top: 16px; }
.site-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 32px; padding: 24px clamp(20px, 4vw, 64px);
  border-bottom: 1px solid var(--line);
  position: sticky; top: 0; z-index: 40;
  background: rgba(243, 239, 228, 0.86);
  backdrop-filter: blur(14px);
}
.brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -0.04em; font-size: 22px; }
.brand__mark { width: 18px; height: 18px; border-radius: 50%; background: var(--ember); display: inline-block; animation: pulse 2.8s var(--ease-out) infinite; }
.site-nav { display: flex; align-items: center; gap: 28px; font-size: 14px; }
.site-nav a { position: relative; }
.site-nav a:not(.button)::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -4px; height: 1px;
  background: currentColor; transform: scaleX(0); transform-origin: right;
  transition: transform 420ms var(--ease-out);
}
.site-nav a:not(.button):hover::after, .site-nav a:not(.button):focus-visible::after { transform: scaleX(1); transform-origin: left; }
.button {
  display: inline-flex; align-items: center; gap: 18px;
  border: 1px solid var(--ink); background: var(--ink); color: var(--paper);
  padding: 17px 22px; font: inherit; font-size: 14px; cursor: pointer;
  transition: background-color 300ms var(--ease-out), color 300ms var(--ease-out), transform 300ms var(--ease-out), box-shadow 300ms var(--ease-out);
}
.button:hover { background: var(--ember); border-color: var(--ember); transform: translate(-2px, -2px); box-shadow: 4px 4px 0 var(--ink); }
.button--small { padding: 11px 16px; font-size: 13px; }
.text-link { text-decoration: underline; text-underline-offset: 4px; transition: color 220ms ease, text-underline-offset 220ms ease; }
.text-link:hover { color: var(--ember); text-underline-offset: 8px; }
.hero {
  display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: clamp(32px, 6vw, 96px); padding: clamp(48px, 8vw, 120px) clamp(20px, 4vw, 64px) 72px;
  position: relative; overflow: hidden;
}
.eyebrow { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin: 0 0 28px; }
.hero__title {
  font-size: clamp(64px, 11vw, 176px); line-height: 0.84; letter-spacing: -0.065em;
  font-weight: 500; margin: 0; max-width: 9ch;
  animation: reveal 1.1s var(--ease-out) both;
}
.hero__title em, h2 em { font-family: var(--font-serif); font-weight: 400; letter-spacing: -0.02em; }
.hero__lede { max-width: 42ch; margin: 32px 0 0; color: var(--muted); font-size: clamp(18px, 1.5vw, 23px); line-height: 1.4; }
.hero__actions { display: flex; align-items: center; gap: 28px; margin-top: 38px; }
.hero__visual {
  position: relative; margin: 0; align-self: end;
  border-radius: var(--radius-card); overflow: hidden; background: var(--paper-deep);
  box-shadow: var(--shadow-lift);
  transition: transform 700ms var(--ease-out), box-shadow 700ms var(--ease-out);
}
.hero__visual:hover { transform: translate(-6px, -6px) rotate(-0.35deg); box-shadow: 16px 16px 0 var(--ember); }
.hero__visual img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; transition: transform 1.2s var(--ease-out), filter 600ms ease; }
.hero__visual:hover img { transform: scale(1.035); filter: saturate(1.1) contrast(1.02); }
.hero__visual figcaption { display: flex; justify-content: space-between; gap: 20px; padding: 16px 18px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
.pulse-dot {
  position: absolute; top: 22px; right: 22px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--acid); box-shadow: 0 0 0 0 rgba(223, 255, 79, 0.55);
  animation: pulse-ring 2.4s var(--ease-out) infinite;
}
.hero__orb {
  position: absolute; z-index: -1; right: 16%; top: 8%; width: clamp(180px, 22vw, 360px); height: clamp(180px, 22vw, 360px);
  border-radius: 50%; filter: blur(28px); opacity: 0.7;
  background: radial-gradient(circle at 30% 30%, var(--acid), transparent 62%), radial-gradient(circle at 70% 70%, var(--ember), transparent 58%);
}
.marquee { overflow: hidden; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); background: var(--acid); }
.marquee__track { display: flex; align-items: center; gap: 28px; width: max-content; padding: 13px 0; animation: marquee 26s linear infinite; }
.marquee__track span { font-size: 12px; letter-spacing: 0.18em; font-weight: 600; }
.marquee__track i { width: 5px; height: 5px; border-radius: 50%; background: var(--ink); display: block; }
.work, .approach, .reel, .journal, .contact { padding: clamp(72px, 9vw, 140px) clamp(20px, 4vw, 64px); }
.section-intro { max-width: 760px; }
.section-intro h2, .approach h2, .contact h2 {
  font-size: clamp(44px, 7vw, 104px); line-height: 0.92; letter-spacing: -0.055em; margin: 0 0 26px; font-weight: 500;
}
.section-intro > p:last-child { max-width: 52ch; color: var(--muted); }
.work-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; margin-top: 64px; }
.card {
  border-radius: var(--radius-card); padding: 14px 14px 22px;
  background: var(--paper-deep);
  transition: transform 500ms var(--ease-out), background-color 500ms var(--ease-out), box-shadow 500ms var(--ease-out);
}
.card:hover { transform: translateY(-8px); background: #eee7d7; box-shadow: 8px 8px 0 var(--ink); }
.card__media { position: relative; overflow: hidden; border-radius: calc(var(--radius-card) - 8px); background: #d6cdbb; }
.card__media img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; transition: transform 900ms var(--ease-out); }
.card:hover .card__media img { transform: scale(1.05) rotate(0.3deg); }
.card__tag {
  position: absolute; top: 12px; left: 12px; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  padding: 7px 9px; background: var(--paper); border-radius: 999px;
  animation: shimmer 5s linear infinite;
}
.card h3 { font-size: 24px; letter-spacing: -0.03em; margin: 20px 6px 8px; }
.card p { margin: 0 6px; color: var(--muted); font-size: 14px; line-height: 1.55; }
.card--text .card__media--plain { aspect-ratio: auto; padding: 28px; display: flex; flex-direction: column; gap: 24px; justify-content: space-between; min-height: 250px; }
.index { font-size: 64px; line-height: 1; color: var(--ember); font-family: var(--font-serif); font-style: italic; }
.approach { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: clamp(40px, 7vw, 120px); background: var(--paper-deep); border-top: 1px solid var(--line); }
.approach__sticky { position: sticky; top: 120px; align-self: start; }
.meter { display: grid; grid-template-columns: 90px 1fr 36px; align-items: center; gap: 12px; margin-top: 14px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.meter__track { height: 6px; background: rgba(20, 20, 15, 0.12); border-radius: 999px; overflow: hidden; }
.meter__fill { display: block; height: 100%; width: var(--value); background: var(--ink); border-radius: inherit; transform-origin: left; transition: width 800ms var(--ease-out), background-color 300ms ease; }
.approach__sticky:hover .meter__fill { animation: grow 1.2s var(--ease-out) both; background: var(--ember); }
.approach__steps { display: flex; flex-direction: column; gap: 0; }
.approach__steps article { padding: 38px 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: 48px minmax(0, 0.6fr) minmax(0, 1.2fr); gap: 24px; align-items: start; transition: padding-left 400ms var(--ease-out); }
.approach__steps article:hover { padding-left: 12px; }
.approach__steps article:last-child { border-bottom: 1px solid var(--line); }
.step-index { font-family: var(--font-serif); font-style: italic; color: var(--ember); font-size: 20px; }
.approach__steps h3 { margin: 0; font-size: 23px; letter-spacing: -0.03em; }
.approach__steps p { margin: 0; color: var(--muted); font-size: 15px; }
.reel { background: var(--ink); color: var(--paper); }
.reel .eyebrow { color: rgba(243, 239, 228, 0.55); }
.reel .section-intro { max-width: 900px; margin-bottom: 48px; }
.reel__video { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius-card); background: #24241c; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35); }
.reel__meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 20px; padding-top: 18px; border-top: 1px solid rgba(243, 239, 228, 0.18); margin-top: 20px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(243, 239, 228, 0.6); }
.reel__canvas { display: none; }
.journal__list { margin-top: 56px; border-top: 1px solid var(--line); }
.journal__list a {
  display: grid; grid-template-columns: 130px 1fr 40px; gap: 24px; align-items: center;
  padding: 26px 0; border-bottom: 1px solid var(--line);
  transition: padding-left 420ms var(--ease-out), background-color 420ms var(--ease-out), color 300ms ease;
}
.journal__list a:hover { padding-left: 16px; background: var(--acid); }
.journal__date { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
.journal__title { font-size: clamp(20px, 2.2vw, 30px); letter-spacing: -0.035em; }
.journal__arrow { font-size: 22px; transition: transform 320ms var(--ease-out); }
.journal__list a:hover .journal__arrow { transform: translate(4px, -4px); }
.contact { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr); gap: clamp(40px, 8vw, 120px); align-items: end; background: var(--acid); border-top: 1px solid var(--ink); }
.contact .eyebrow { color: rgba(20, 20, 15, 0.65); }
.contact__form { display: flex; flex-direction: column; gap: 8px; margin-top: 40px; max-width: 620px; }
.contact__form label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; margin-top: 18px; }
.contact__form input, .contact__form textarea {
  border: 0; border-bottom: 1px solid var(--ink); background: transparent; padding: 12px 0;
  font: inherit; color: var(--ink); resize: vertical; transition: border-color 220ms ease, background-color 220ms ease;
}
.contact__form input::placeholder, .contact__form textarea::placeholder { color: rgba(20, 20, 15, 0.42); }
.contact__form input:focus, .contact__form textarea:focus { outline: none; border-bottom-color: var(--cobalt); background: rgba(243, 239, 228, 0.35); }
.contact__form .button { align-self: flex-start; margin-top: 26px; }
.contact__aside { position: relative; }
.contact__aside img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: var(--radius-card); filter: grayscale(1) contrast(1.05); box-shadow: 10px 10px 0 var(--ink); transition: filter 600ms ease, transform 600ms var(--ease-out); }
.contact__aside:hover img { filter: grayscale(0); transform: rotate(-0.6deg); }
.embed iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: var(--radius-card); margin-top: 64px; }
.signature { width: min(420px, 70vw); margin: 80px auto; display: block; }
.site-footer { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 48px; padding: 64px clamp(20px, 4vw, 64px) 40px; border-top: 1px solid var(--line); font-size: 14px; }
.site-footer p { margin: 18px 0 0; color: var(--muted); }
.site-footer a { display: block; margin-top: 8px; transition: color 220ms ease, transform 220ms var(--ease-out); }
.site-footer a:hover { color: var(--ember); transform: translateX(3px); }
.footer-label { font-size: 10px !important; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink) !important; margin: 0 !important; }
.copyright { grid-column: 1 / -1; border-top: 1px solid var(--line); padding-top: 22px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
.scroll-progress { position: fixed; top: 0; left: 0; right: 0; height: 3px; transform-origin: left; background: var(--ember); z-index: 90; animation: grow 1s linear both; animation-timeline: scroll(root); animation-range: entry 0% cover 60%; }
@keyframes reveal {
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-18px) rotate(1.5deg); }
}
@keyframes drift {
  0% { transform: translate3d(-4%, 0, 0) scale(1); }
  45% { transform: translate3d(6%, -8%, 0) scale(1.12) rotate(8deg); }
  100% { transform: translate3d(2%, 6%, 0) scale(0.95) rotate(-4deg); }
}
@keyframes marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.18); background: var(--cobalt); }
}
@keyframes pulse-ring {
  0% { box-shadow: 0 0 0 0 rgba(223, 255, 79, 0.65); }
  65% { box-shadow: 0 0 0 16px rgba(223, 255, 79, 0); }
  100% { box-shadow: 0 0 0 0 rgba(223, 255, 79, 0); }
}
@keyframes grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@keyframes shimmer {
  0% { background-position: -180% 0; color: var(--ember); }
  50% { color: var(--cobalt); }
  100% { background-position: 180% 0; color: var(--ember); }
}
@keyframes orbit {
  0% { transform: rotate(0deg) translateX(18px) rotate(0deg); }
  100% { transform: rotate(360deg) translateX(18px) rotate(-360deg); }
}
@supports (animation-timeline: scroll()) {
  .scroll-progress { animation-name: grow; animation-duration: auto; animation-timeline: scroll(root); animation-range: entry 0% cover 60%; }
}
@media (max-width: 1080px) {
  .hero { grid-template-columns: 1fr; }
  .hero__visual { max-width: 640px; }
  .work-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .approach { grid-template-columns: 1fr; }
  .approach__sticky { position: static; }
  .contact { grid-template-columns: 1fr; }
  .contact__aside { max-width: 420px; }
}
@media (max-width: 720px) {
  .site-nav a:not(.button) { display: none; }
  .hero { padding-top: 40px; }
  .hero__title { font-size: clamp(54px, 17vw, 92px); }
  .hero__actions { flex-direction: column; align-items: flex-start; gap: 18px; }
  .work-grid { grid-template-columns: 1fr; }
  .approach__steps article { grid-template-columns: 36px 1fr; }
  .approach__steps article p { grid-column: 2; }
  .journal__list a { grid-template-columns: 1fr 32px; gap: 8px; }
  .journal__date { grid-column: 1 / -1; }
  .site-footer { grid-template-columns: 1fr 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .marquee__track { animation: none; }
  .hero__visual:hover img { transform: none; }
}
`;

const DEMO_JS = `
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import lottie from 'lottie-web';

gsap.registerPlugin(ScrollTrigger);

const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 1.1 });
lenis.on('scroll', ScrollTrigger.update);
function tick(time) {
  requestAnimationFrame(tick);
  lenis.raf(time);
}
requestAnimationFrame(tick);

gsap.utils.toArray('[data-reveal]').forEach(function (element) {
  gsap.fromTo(element, { y: 48, opacity: 0 }, {
    y: 0,
    opacity: 1,
    duration: 1.1,
    ease: 'power3.out',
    scrollTrigger: { trigger: element, start: 'top 88%', once: true }
  });
});

gsap.to('.reel__video', {
  scale: 1.06,
  ease: 'none',
  scrollTrigger: { trigger: '.reel__video', start: 'top bottom', end: 'bottom top', scrub: 1, pin: true }
});

gsap.utils.toArray('[data-aos]').forEach(function (element) {
  gsap.to(element, {
    opacity: 1,
    y: 0,
    scrollTrigger: { trigger: element, start: 'top 90%' }
  });
});

lottie.loadAnimation({
  container: document.querySelector('[data-lottie]'),
  renderer: 'svg',
  loop: true,
  autoplay: true,
  path: '/assets/orbit.json'
});

const observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    document.documentElement.style.setProperty('--last-reveal', Date.now().toString());
  });
}, { threshold: 0.2, rootMargin: '0px 0px -12% 0px' });

document.querySelectorAll('.card, .approach__steps article').forEach(function (node) {
  observer.observe(node);
});

const glow = document.querySelector('.hero__orb');
window.addEventListener('pointermove', function (event) {
  if (!glow) return;
  const x = event.clientX / window.innerWidth - 0.5;
  const y = event.clientY / window.innerHeight - 0.5;
  glow.style.transform = 'translate(' + x * 28 + 'px, ' + y * 28 + 'px)';
  document.documentElement.style.setProperty('--pointer-x', event.clientX + 'px');
});

window.addEventListener('scroll', function () {
  const offset = window.scrollY;
  const progress = document.querySelector('.scroll-progress');
  if (!progress) return;
  document.body.dataset.scrolled = offset > 24 ? 'yes' : 'no';
  const rect = document.body.getBoundingClientRect();
  progress.style.transform = 'scaleX(' + Math.min(1, -rect.top / (rect.height - innerHeight)) + ')';
}, { passive: true });

const bars = document.querySelectorAll('.meter__fill');
bars.forEach(function (bar) {
  bar.addEventListener('mouseenter', function () {
    bar.animate([
      { transform: 'scaleX(0)' },
      { transform: 'scaleX(1)' }
    ], { duration: 900, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
  });
});

document.querySelectorAll('.card').forEach(function (card) {
  card.addEventListener('mouseenter', function () {
    card.style.transform = 'translateY(-8px)';
  });
  card.addEventListener('mouseleave', function () {
    card.style.transform = '';
  });
});

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if (!reduceMotion.matches) {
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      lenis.scrollTo(target, { duration: 1.4 });
    });
  });
}

if (document.startViewTransition) {
  document.querySelectorAll('a[href^="/work/"]').forEach(function (link) {
    link.addEventListener('click', function () {
      document.startViewTransition(function () {
        document.body.classList.add('is-transitioning');
      });
    });
  });
}

setInterval(function () {
  document.body.dataset.tick = String(Date.now());
}, 8000);
`;

const DEMO_JS_EXTRA = `
import Swiper from 'swiper';

const gallery = new Swiper('.work-grid', {
  slidesPerView: 1.15,
  spaceBetween: 24,
  speed: 900,
  grabCursor: true,
  breakpoints: {
    720: { slidesPerView: 2.2 },
    1080: { slidesPerView: 3 }
  }
});

document.querySelectorAll('.journal__list a').forEach(function (row) {
  row.addEventListener('pointerenter', function () {
    row.style.setProperty('--row-tilt', '-0.35deg');
    row.animate([{ opacity: 0.85 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  });
});
`;

function makeSource(label, url, content, extra = {}) {
  return {
    label,
    url,
    content,
    bytes: Buffer.byteLength(content, 'utf8'),
    status: 200,
    baseUrl: url,
    inline: false,
    ...extra,
  };
}

export function buildDemoReport() {
  const styleUrl = 'https://aurelia-studio.example/assets/site.css';
  const mainUrl = 'https://aurelia-studio.example/assets/main.js';
  const interactionsUrl = 'https://aurelia-studio.example/assets/interactions.js';

  return analyzeSources({
    requestedUrl: DEMO_URL,
    finalUrl: DEMO_URL,
    html: DEMO_HTML,
    cssSources: [makeSource('site.css', styleUrl, DEMO_CSS)],
    jsSources: [
      makeSource('main.js', mainUrl, DEMO_JS, { module: true }),
      makeSource('interactions.js', interactionsUrl, DEMO_JS_EXTRA, { defer: true }),
    ],
    warnings: [],
    responseHeaders: {},
    pageInfo: {
      bytes: Buffer.byteLength(DEMO_HTML, 'utf8'),
      downloadedBytes: Buffer.byteLength(DEMO_HTML, 'utf8'),
      status: 200,
      contentType: 'text/html; charset=utf-8',
      elapsedMs: 0,
      truncated: false,
    },
    fetchMeta: {
      styleSkipped: 0,
      scriptSkipped: 0,
      styleStats: { external: 1, inline: 0, fetched: 1, failed: 0, skipped: 0, imported: 0 },
      scriptStats: { external: 2, inline: 0, fetched: 2, failed: 0, skipped: 0 },
    },
    demo: true,
  });
}
