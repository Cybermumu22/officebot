// Minimal service worker: exists so the PWA is installable on secure
// origins. Deliberately NO caching — the dashboard is live-only, and stale
// copies of index.html have bitten this project before (see README).
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* network passthrough */ });

// CONVO approval notifications: the action buttons answer the prompt WITHOUT
// opening the app — /deck/key types the key straight into the tab's tmux
// session (Termux keeps running in the background). Tapping the body opens
// or focuses the deck instead.
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const d = e.notification.data || {};
  if (e.action && d.tab) {
    e.waitUntil(fetch('/deck/key?session=' + encodeURIComponent(d.tab) + '&key=' + encodeURIComponent(e.action), { headers: { 'X-Deck': '1' } }).catch(function () {}));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].url.indexOf('deck.html') !== -1 && 'focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow('/deck.html');
  }));
});
