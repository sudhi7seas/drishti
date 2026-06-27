/**
 * Drishti — Service Worker v0.1.4
 *
 * iOS RESTART LOOP FIX:
 * iOS Safari PWAs reload from scratch when:
 *   (a) The app has been in background > ~30 seconds
 *   (b) The service worker cache doesn't serve index.html instantly
 *   (c) Any navigation request hits the network (even briefly)
 *
 * Solution: serve index.html from cache for ALL navigation requests,
 * with zero network fallback for the document itself.
 * The app state (model loaded) is preserved via a sessionStorage flag
 * set by the app — if the flag exists, skip the splash screen.
 */

'use strict';

const CACHE_VER = 'drishti-v6';   // bump on every deploy
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

self.addEventListener('install', (e) => {
  console.log('[SW] Install', CACHE_VER);
  e.waitUntil(
    caches.open(CACHE_VER).then(cache =>
      Promise.allSettled(APP_SHELL.map(url =>
        cache.add(url).catch(err => console.warn('[SW] Could not cache:', url, err.message))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  console.log('[SW] Activate', CACHE_VER);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VER).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // HuggingFace model files — let Transformers.js manage these
  if (url.hostname.includes('huggingface.co') || url.hostname.includes('cdn-lfs')) return;

  // NAVIGATION REQUESTS (opening the app, refreshing):
  // Always serve cached index.html — this prevents the iOS restart loop
  if (request.mode === 'navigate' || request.destination === 'document') {
    e.respondWith(
      caches.match(`${BASE}/index.html`).then(cached => {
        if (cached) return cached;
        // Not in cache yet — fetch and cache it
        return fetch(request).then(resp => {
          if (resp.ok) {
            caches.open(CACHE_VER).then(c => c.put(`${BASE}/index.html`, resp.clone()));
          }
          return resp;
        });
      })
    );
    return;
  }

  // Transformers.js CDN (jsdelivr) — network first, cache fallback
  if (url.hostname.includes('jsdelivr')) {
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

  // Google Fonts — cache first
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(
      caches.match(request).then(c => c || fetch(request).then(r => {
        if (r.ok) caches.open(CACHE_VER).then(cache => cache.put(request, r.clone()));
        return r;
      }))
    );
    return;
  }

  // Everything else (JS, CSS, images) — cache first, network fallback
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(resp => {
        if (resp.ok) caches.open(CACHE_VER).then(c => c.put(request, resp.clone()));
        return resp;
      }).catch(() => {
        console.warn('[SW] Offline, no cache for:', url.pathname);
      });
    })
  );
});
