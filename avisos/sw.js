// Service worker de "Avellana Avisos": recibe los avisos de pedidos y los
// muestra como notificación. No guarda nada en caché a propósito: la app es
// una sola pantalla y siempre conviene la versión más nueva.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', evento => evento.waitUntil(self.clients.claim()));

self.addEventListener('push', evento => {
  let datos = {};
  try { datos = evento.data ? evento.data.json() : {}; }
  catch (err) { datos = { body: evento.data ? evento.data.text() : '' }; }
  // iPhone exige mostrar una notificación por cada aviso que llega.
  evento.waitUntil(self.registration.showNotification(datos.title || 'Avellana', {
    body: datos.body || 'Hay algo nuevo en el panel.',
    icon: '/apple-touch-icon.png',
    badge: '/favicon.png',
    data: { url: datos.url || 'https://belleza-panel.pages.dev/' }
  }));
});

// Tocar el aviso abre el panel.
self.addEventListener('notificationclick', evento => {
  evento.notification.close();
  const url = (evento.notification.data && evento.notification.data.url) || 'https://belleza-panel.pages.dev/';
  evento.waitUntil(self.clients.openWindow(url));
});
