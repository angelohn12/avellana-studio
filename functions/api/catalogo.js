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
//   · Copia de entre 2 y 30 min    → se entrega AL INSTANTE y, por detrás,
//                                    se pide una nueva a Apps Script. Nadie
//                                    espera los 3-4 s que tarda el Sheet.
//   · Copia de más de 30 min (o nada) → se espera a Apps Script; si falla,
//                                    se entrega la vieja antes que dejar a
//                                    la clienta sin catálogo.
//
// Antes la copia se guardaba con "max-age=300": Cloudflare la botaba a los
// 5 min y el plan B de "copia vieja si Apps Script falla" nunca tenía qué
// entregar. Ahora el borde la guarda 24 h y la frescura la decide este
// archivo con la marca x-cacheado-en.
//
// Mismo patrón que /api/proxy de belleza-panel — no reinventar si se toca.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxQVdDsH_Qgg9MnRgb0rDyzYPkvRESEi2FGD-ENHeT9L7CMbZl_xTaVxDs0wfNe3tflMg/exec';
const FRESCURA_MS = 2 * 60 * 1000;          // hasta acá la copia es "fresca"
const TOLERANCIA_MS = 30 * 60 * 1000;       // hasta acá se entrega vieja mientras se renueva (el stock cambia: no más)
const VIDA_EN_BORDE_S = 24 * 60 * 60;       // cuánto Cloudflare conserva la copia
const NAVEGADOR_S = 60;                     // cuánto la reutiliza el navegador de la clienta

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  const cache = caches.default;
  const url = new URL(request.url);
  const cacheKey = new Request(url.toString(), request);
  // Marca de "ya hay alguien renovando la copia": evita que 20 visitas
  // seguidas disparen 20 pedidos a Apps Script a la vez.
  const marcaKey = new Request(url.origin + '/__catalogo_renovando', { method: 'GET' });

  // 1. ¿Hay algo guardado en el borde de Cloudflare?
  const cachedResp = await cache.match(cacheKey);
  if (cachedResp) {
    const edad = Date.now() - Number(cachedResp.headers.get('x-cacheado-en') || 0);

    // 1a. Fresca: directo, sin tocar Apps Script
    if (edad < FRESCURA_MS) return paraNavegador(cachedResp);

    // 1b. Algo vieja pero usable: se entrega ya y se renueva por detrás
    if (edad < TOLERANCIA_MS) {
      if (!(await cache.match(marcaKey))) {
        context.waitUntil((async () => {
          await cache.put(marcaKey, new Response('1', { headers: { 'cache-control': 'public, max-age=25' } }));
          try { await renovar(cache, cacheKey); } catch (err) { /* la copia vieja sigue sirviendo */ }
        })());
      }
      return paraNavegador(cachedResp);
    }
  }

  // 2. Sin copia útil: hay que esperar datos frescos de Apps Script
  try {
    const text = await renovar(cache, cacheKey);
    return paraNavegador(new Response(text, { headers: { 'content-type': 'application/json' } }));
  } catch (err) {
    // 3. Apps Script falló — mejor la copia vieja (aunque no esté fresca)
    //    que dejar a la clienta sin catálogo real.
    if (cachedResp) return paraNavegador(cachedResp);
    return json({ ok: false, error: 'no se pudo cargar el catálogo: ' + (err && err.message || String(err)) }, 502);
  }
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
