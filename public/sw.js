// Minimal service worker: exists so the PWA is installable on secure
// origins. Deliberately NO caching — the dashboard is live-only, and stale
// copies of index.html have bitten this project before (see README).
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* network passthrough */ });
