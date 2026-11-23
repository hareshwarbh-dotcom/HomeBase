/* HomeBase service worker: opens instantly and works offline.
   - The app page is fetched fresh when online (so updates arrive), with the saved copy used when offline.
   - Icons, fonts and the sync library are served from the saved copy and refreshed in the background.
   - Supabase (your data) is never cached here; the app handles syncing itself. */
const VERSION = 'hb-shell-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const KEEP = [VERSION, 'hb-photos'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;                 // live data: always network

  // The app page: network first, saved copy when offline
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => { c.put(req, copy.clone()); c.put('./index.html', copy); });
        return res;
      }).catch(async () =>
        (await caches.match(req)) || (await caches.match('./index.html')) || (await caches.match('./'))
      )
    );
    return;
  }

  // Everything else we use (icons, fonts, sync library): saved copy first, refresh in background
  const ours = url.origin === location.origin ||
               /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) ||
               url.hostname === 'cdn.jsdelivr.net';
  if (!ours) return;
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') caches.open(VERSION).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

// ---------- notifications ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'HomeBase', {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'homebase',
    renotify: true,
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { c.focus(); return; } }
    return clients.openWindow(target);
  }));
});
