/**
 * Drishti — Service Worker v0.1.2
 * FIX: Better caching strategy to prevent "starting from beginning" on iOS
 * FIX: Correct handling of ES module scripts
 */

'use strict';

const CACHE_NAME = 'drishti-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/main.js',
  '/js/config.js',
  '/js/speech.js',
  '/js/camera.js',
  '/js/ai.js',
  '/js/ui.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache partial fail:', err))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:' || url.protocol === 'data:') return;
  // Let Transformers.js manage HuggingFace model downloads itself
  if (url.hostname.includes('huggingface.co') || url.hostname.includes('cdn-lfs')) return;
  // Transformers.js CDN — network first, cache as backup
  if (url.hostname.includes('jsdelivr.net')) {
    e.respondWith(
      fetch(request).then(resp => {
        if (resp.ok) caches.open(CACHE_NAME).then(c => c.put(request, resp.clone()));
        return resp;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // App shell: cache-first (this is what stops iOS reloading from scratch)
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(resp => {
        if (resp.ok) {
          caches.open(CACHE_NAME).then(c => c.put(request, resp.clone()));
        }
        return resp;
      }).catch(() => {
        if (request.destination === 'document') return caches.match('/index.html');
      });
    })
  );
});
