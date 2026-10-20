/**
 * Vercel serverless entry for the whole webcopy API.
 *
 * Vercel runs functions, not long-lived servers: only the files under `api/`
 * are invoked, while everything else is served as static output (the `public/`
 * build). This adapter forwards every `/api/*` request into the same Express
 * app the local `npm start` server uses, so local and hosted behavior stay
 * identical. SSE streaming works because the app already flushes headers,
 * skips compression for event streams and heartbeats; the crawl budget in
 * server/crawl.js self-clamps to stay inside the function duration limit.
 */

import { app } from '../server/index.js';

export default function handler(req, res) {
  return app(req, res);
}
