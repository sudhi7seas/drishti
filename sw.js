/**
 * Drishti — Service Worker v0.1.3
 *
 * ROOT CAUSE of "loops back to start":
 * iOS Safari kills PWA state when memory is low OR when the
 * service worker cache is stale/missing. The fix is:
 * 1. Version-stamp the cache (bump CACHE_VER to force refresh)
 * 2. Cache ALL app shell files reliably on install
 * 3. Always serve index.html from cache for navigation requests
 * 4. Never cache model files (Transformers.js handles those)
 */

'use strict';

const CACHE_VER = 'drishti-v5'; // ← bump this every deploy
const BASE = '/drishti';

const APP_SHELL = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/css/style.css`,
  `${BASE}/js/main.js`,
  `${BASE}/js/config.js`,
  `${BASE}/js/speech.js`,
  `${BASE}/js/camera.js`,
  `${BASE}/js/ai.js`,
  `${BASE}/js/ui.js`,
  `${BASE}/js/app.js`,
  `${BASE}/manifest.json`,
  `${BASE}/icons/icon-152.png`,
  `${BASE}/icons/icon-167.png`,
  `${BASE}/icons/icon-180.png`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
];

// Install: cache everything
self.addEventListener('install', (e) => {
  console.log('[SW] Installing', CACHE_VER);
  e.waitUntil(
    caches.open(CACHE_VER)
      .then(cache => {
        // Add individually so one failure doesn't block all
        return Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: delete ALL old caches
self.addEventListener('activate', (e) => {
  console.log('[SW] Activating', CACHE_VER);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VER).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip HuggingFace model downloads — Transformers.js caches these itself
  if (url.hostname.includes('huggingface.co') || url.hostname.includes('cdn-lfs')) return;

  // Skip chrome extensions
  if (url.protocol === 'chrome-extension:') return;

  // Transformers.js CDN — network first, cache as fallback
  if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('cdn.jsdelivr')) {
    e.respondWith(
      fetch(request)
        .then(resp => {
          if (resp.ok) caches.open(CACHE_VER).then(c => c.put(request, resp.clone()));
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Fonts
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(
      caches.match(request).then(c => c || fetch(request).then(r => {
        if (r.ok) caches.open(CACHE_VER).then(cache => cache.put(request, r.clone()));
        return r;
      }))
    );
    return;
  }

  // App shell: cache-first — this is what keeps the app alive offline
  // and prevents iOS from "starting from the beginning"
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request)
        .then(resp => {
          if (resp.ok) {
            caches.open(CACHE_VER).then(c => c.put(request, resp.clone()));
          }
          return resp;
        })
        .catch(() => {
          // Offline fallback: serve index.html for navigation
          if (request.destination === 'document' || request.mode === 'navigate') {
            return caches.match(`${BASE}/index.html`) || caches.match(`${BASE}/`);
          }
        });
    })
  );
});
