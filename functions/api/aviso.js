// Cloudflare Pages Function: /api/aviso
//
// Puente de los avisos al celular: Apps Script → acá → ntfy.sh → celular.
// ntfy.sh no acepta conexiones que vienen de los servidores de Google
// (Apps Script falla con "Address unavailable"), pero sí desde Cloudflare.
//
// No necesita clave: solo reenvía a canales con el formato de Avellana
// ('avellana-' + 14 letras/números), y el canal real es secreto. Quien no
// lo conoce no puede mandarle nada a nadie — igual que en ntfy mismo, que
// tampoco pide clave. El link al tocar el aviso va fijo acá, así que el
// puente no sirve para mandar links a otro lado.

const NTFY = 'https://ntfy.sh';
const CANAL_VALIDO = /^avellana-[0-9a-f]{14}$/;
const PANEL_URL = 'https://belleza-panel.pages.dev/';

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'GET') return new Response('puente-ok', { headers: { 'content-type': 'text/plain' } });
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  let d;
  try { d = await request.json(); } catch (err) { return json({ ok: false, error: 'json invalido' }, 400); }
  if (!d || !CANAL_VALIDO.test(String(d.topic || ''))) return json({ ok: false, error: 'canal invalido' }, 400);

  const aviso = {
    topic: d.topic,
    title: recortar(d.title, 120),
    message: recortar(d.message, 500) || 'Aviso de Avellana',
    tags: Array.isArray(d.tags) ? d.tags.slice(0, 5).map(t => recortar(t, 40)) : [],
    priority: 4,
    click: PANEL_URL
  };

  try {
    const r = await fetch(NTFY, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(aviso)
    });
    if (!r.ok) return json({ ok: false, error: 'ntfy respondio ' + r.status }, 502);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'ntfy no respondio' }, 502);
  }
}

function recortar(t, max) {
  return String(t == null ? '' : t).slice(0, max);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json' }
  });
}
