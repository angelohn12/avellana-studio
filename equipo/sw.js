// Service worker de la app del equipo de Avellana.
// Guarda solo la app (los datos van en el almacenamiento del celular), para
// que abra al instante y aunque no haya señal.
// - La página: primero internet (para recibir arreglos); si no hay, la guardada.
// - El Apps Script y las fotos de Google nunca se guardan acá.
const VERSION = 'avl-eq-1';
const BASE = ['/equipo/', '/equipo/manifest.webmanifest', '/apple-touch-icon.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('avl-eq-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/equipo/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => {
      const copia = r.clone(); caches.open(VERSION).then(c => c.put('/equipo/', copia)); return r;
    }).catch(() => caches.match('/equipo/')));
    return;
  }
  e.respondWith(caches.match(e.request).then(g => g || fetch(e.request)));
});
