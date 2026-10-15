// Cloudflare Pages Function: /api/catalogo
//
// Antes, la tienda le preguntaba directo a Google Apps Script en cada visita.
// Apps Script a veces responde lento o falla bajo carga (cuenta gratuita,
// límite de ejecuciones simultáneas) — eso dejaba a las clientas viendo el
// catálogo de ejemplo en vez del real.
//
// Ahora esta función hace de intermediario: guarda una copia del catálogo
// en el borde de Cloudflare (compartida entre TODAS las visitas, no una
// por navegador) y la reparte así:
//
//   · Copia de menos de 2 minutos  → se entrega tal cual, sin tocar Apps Script.
//   · Copia de más de 2 min (hasta 24 h) → se entrega AL INSTANTE y, por
//                                    detrás, se pide una nueva a Apps Script.
//   · Sin copia en el borde         → se espera a Apps Script como máximo
//                                    ESPERA_MAX_MS; si no llega a tiempo se
//                                    entrega catalogo-respaldo.json (copia
//                                    publicada con la tienda) y la lectura
//                                    sigue por detrás para la próxima visita.
//
// Por qué (14/10/2026): con pocas visitas, Cloudflare bota la copia del
// borde o la copia pasaba de 30 min, y la siguiente clienta esperaba a
// Apps Script en frío: se midieron 13–20 s. Nadie que llega de un anuncio
// espera eso. Una copia de minutos u horas se corrige sola en segundos,
// y el pedido igual se confirma por WhatsApp.
//
// Antes la copia se guardaba con "max-age=300": Cloudflare la botaba a los
// 5 min y el plan B de "copia vieja si Apps Script falla" nunca tenía qué
// entregar. Ahora el borde la guarda 24 h y la frescura la decide este
// archivo con la marca x-cacheado-en.
//
// Mismo patrón que /api/proxy de belleza-panel — no reinventar si se toca.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxQVdDsH_Qgg9MnRgb0rDyzYPkvRESEi2FGD-ENHeT9L7CMbZl_xTaVxDs0wfNe3tflMg/exec';
const FRESCURA_MS = 2 * 60 * 1000;          // hasta acá la copia es "fresca"
const ESPERA_MAX_MS = 4000;                 // sin copia: lo máximo que se espera a Apps Script
const VIDA_EN_BORDE_S = 24 * 60 * 60;       // cuánto Cloudflare conserva la copia
const NAVEGADOR_S = 60;                     // cuánto la reutiliza el navegador de la clienta

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  const cache = caches.default;
  const url = new URL(request.url);
  // La clave NO incluye el query string ni las cabeceras de quien pide: la respuesta es
  // siempre la misma, y con una clave por variante cualquiera podía forzar una lectura
  // del Sheet por petición (?x=1, ?x=2…) y llenar el borde de copias.
  const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
  // Marca de "ya hay alguien renovando la copia": evita que 20 visitas
  // seguidas disparen 20 pedidos a Apps Script a la vez.
  const marcaKey = new Request(url.origin + '/__catalogo_renovando', { method: 'GET' });

  // 1. ¿Hay algo guardado en el borde de Cloudflare?
  const cachedResp = await cache.match(cacheKey);
  if (cachedResp) {
    const edad = Date.now() - Number(cachedResp.headers.get('x-cacheado-en') || 0);

    // 1a. Fresca: directo, sin tocar Apps Script
    if (edad < FRESCURA_MS) return paraNavegador(cachedResp);

    // 1b. Vieja pero de hoy: se entrega ya y se renueva por detrás
    if (!(await cache.match(marcaKey))) {
      context.waitUntil((async () => {
        await cache.put(marcaKey, new Response('1', { headers: { 'cache-control': 'public, max-age=25' } }));
        try { await renovar(cache, cacheKey); } catch (err) { /* la copia vieja sigue sirviendo */ }
      })());
    }
    return paraNavegador(cachedResp);
  }

  // 2. Sin copia en el borde: se le da a Apps Script hasta ESPERA_MAX_MS.
  //    La lectura no se cancela si se pasa: sigue por detrás y deja la copia
  //    guardada para la próxima visita.
  context.waitUntil(cache.put(marcaKey, new Response('1', { headers: { 'cache-control': 'public, max-age=25' } })));
  const lectura = renovar(cache, cacheKey);
  context.waitUntil(lectura.catch(() => {}));
  const aTiempo = await Promise.race([
    lectura.then(text => ({ text }), err => ({ err })),
    new Promise(r => setTimeout(() => r({ tarde: true }), ESPERA_MAX_MS))
  ]);
  if (aTiempo.text) return paraNavegador(new Response(aTiempo.text, { headers: { 'content-type': 'application/json' } }));

  // 3. Apps Script tardó o falló: copia de respaldo publicada con la tienda
  const respaldo = await leerRespaldo(context, url);
  if (respaldo) return respaldo;
  if (aTiempo.tarde) {
    // Sin respaldo: no queda más que esperar la lectura en curso
    try {
      const text = await lectura;
      return paraNavegador(new Response(text, { headers: { 'content-type': 'application/json' } }));
    } catch (err) { aTiempo.err = err; }
  }
  return json({ ok: false, error: 'no se pudo cargar el catálogo: ' + (aTiempo.err && aTiempo.err.message || String(aTiempo.err)) }, 502);
}

// catalogo-respaldo.json: copia del catálogo que se publica con la tienda.
// Se marca con x-catalogo: respaldo para que el navegador no la guarde.
async function leerRespaldo(context, url) {
  try {
    const r = await context.env.ASSETS.fetch(new Request(url.origin + '/catalogo-respaldo.json'));
    if (!r.ok) return null;
    const h = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-catalogo': 'respaldo' });
    return new Response(r.body, { status: 200, headers: h });
  } catch (err) { return null; }
}

// Pide el catálogo a Apps Script, lo valida y lo guarda en el borde.
async function renovar(cache, cacheKey) {
  const text = await fetchFollow(APPS_SCRIPT_URL + '?accion=catalogo', { method: 'GET' });
  const data = JSON.parse(text); // valida que sea JSON de verdad antes de guardarlo
  if (!data || !data.ok || !Array.isArray(data.productos)) throw new Error('respuesta sin catálogo válido');
  await cache.put(cacheKey, new Response(text, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=' + VIDA_EN_BORDE_S,
      'x-cacheado-en': String(Date.now())
    }
  }));
  return text;
}

// Lo que ve el navegador: una copia con vida corta, sin importar cuánto
// viva la copia en el borde.
function paraNavegador(resp) {
  const h = new Headers(resp.headers);
  h.set('cache-control', 'public, max-age=' + NAVEGADOR_S);
  return new Response(resp.body, { status: resp.status, headers: h });
}

// Sigue redirects manualmente hasta 5 saltos — Apps Script devuelve 302
// hacia script.googleusercontent.com, y `redirect:'follow'` da problemas
// en el runtime de Cloudflare Workers.
async function fetchFollow(url, init) {
  let r = await fetch(url, Object.assign({}, init, { redirect: 'manual' }));
  for (let i = 0; i < 5; i++) {
    if (r.status !== 301 && r.status !== 302 && r.status !== 303 && r.status !== 307 && r.status !== 308) break;
    const loc = r.headers.get('location');
    if (!loc) break;
    r = await fetch(loc, { method: 'GET', redirect: 'manual' });
  }
  return await r.text();
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json' }
  });
}
