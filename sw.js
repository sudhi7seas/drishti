/**
 * SeeForMe — Service Worker
 * Chapter 7: Offline Support & PWA Caching
 *
 * Caches the app shell so it loads offline.
 * Model weights are cached by Transformers.js separately (Cache API).
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS/fonts): Cache-first
 *  - AI model downloads: Transformers.js manages these in its own cache
 *  - Everything else: Network-first with cache fallback
 */

'use strict';

const CACHE_NAME = 'seeforme-v1';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/config.js',
  '/js/speech.js',
  '/js/camera.js',
  '/js/ai.js',
  '/js/ui.js',
  '/js/app.js',
  '/manifest.json',
  // Fonts (pre-cached)
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
];

// ── Install: cache app shell ───────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache failed:', err))
  );
});

// ── Activate: clean old caches ─────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache or network ─────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET, chrome-extension, and data: URLs
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.protocol === 'data:') return;

  // Skip HuggingFace model weight requests (Transformers.js caches these itself)
  if (url.hostname.includes('huggingface.co') || url.hostname.includes('cdn-lfs')) return;

  // App shell: cache-first
  const isAppShell = CACHE_URLS.some(u => request.url.endsWith(u) || request.url === u);
  if (isAppShell || url.origin === self.location.origin) {
    e.respondWith(
      caches.match(request)
        .then(cached => cached || fetch(request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return resp;
        }))
        .catch(() => {
          // Offline fallback
          if (request.destination === 'document') {
            return caches.match('/index.html');
          }
        })
    );
    return;
  }

  // CDN resources (fonts, Transformers.js): network-first with cache fallback
  e.respondWith(
    fetch(request)
      .then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(request))
  );
});
