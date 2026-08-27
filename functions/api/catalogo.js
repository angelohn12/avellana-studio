// Cloudflare Pages Function: /api/catalogo
//
// Antes, la tienda le preguntaba directo a Google Apps Script en cada visita.
// Apps Script a veces responde lento o falla bajo carga (cuenta gratuita,
// límite de ejecuciones simultáneas) — eso dejaba a las clientas viendo el
// catálogo de ejemplo en vez del real.
//
// Ahora esta función hace de intermediario: guarda una copia del catálogo
// en el borde de Cloudflare (compartida entre TODAS las visitas, no una
// por navegador) por 5 minutos. La mayoría de las visitas ni siquiera
// tocan Apps Script — reciben la copia guardada, al instante. Y si Apps
// Script falla justo cuando toca refrescar, se sirve la copia vieja en
// vez de nada — mejor una copia con unos minutos de atraso que ninguna.
//
// Mismo patrón que /api/proxy de belleza-panel — no reinventar si se toca.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxQVdDsH_Qgg9MnRgb0rDyzYPkvRESEi2FGD-ENHeT9L7CMbZl_xTaVxDs0wfNe3tflMg/exec';
const FRESCURA_MS = 5 * 60 * 1000; // 5 minutos — mismo tiempo que el caché del navegador

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  const cache = caches.default;
  const url = new URL(request.url);
  const cacheKey = new Request(url.toString(), request);

  // 1. ¿Hay algo guardado en el borde de Cloudflare?
  const cachedResp = await cache.match(cacheKey);
  if (cachedResp) {
    const guardadoEn = Number(cachedResp.headers.get('x-cacheado-en') || 0);
    const fresco = Date.now() - guardadoEn < FRESCURA_MS;
    if (fresco) return cachedResp; // Directo desde Cloudflare, sin tocar Apps Script
  }

  // 2. Traer datos frescos de Apps Script
  try {
    const text = await fetchFollow(APPS_SCRIPT_URL + '?accion=catalogo', { method: 'GET' });
    const data = JSON.parse(text); // valida que sea JSON de verdad antes de guardarlo
    if (!data || !data.ok || !Array.isArray(data.productos)) throw new Error('respuesta sin catálogo válido');

    const resp = new Response(text, {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=300',
        'x-cacheado-en': String(Date.now())
      }
    });
    context.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;

  } catch (err) {
    // 3. Apps Script falló — mejor la copia vieja (aunque no esté fresca)
    //    que dejar a la clienta sin catálogo real.
    if (cachedResp) return cachedResp;
    return json({ ok: false, error: 'no se pudo cargar el catálogo: ' + (err && err.message || String(err)) }, 502);
  }
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
