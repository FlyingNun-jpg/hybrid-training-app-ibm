/* Milkbag service worker — handles daily-reminder push notifications. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { /* plain-text payload */ }
  e.waitUntil(self.registration.showNotification(data.title || 'Milkbag', {
    body: data.body || 'Time to train.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus() }
    return self.clients.openWindow('/dashboard')
  }))
})
