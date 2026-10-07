// Cloudflare Pages Function: /api/aviso
//
// Manda los avisos de pedidos al celular como notificaciones "de verdad"
// (Web Push), a la app "Avellana Avisos" que se instala desde
// /avisos/ en la pantalla de inicio. Sin apps de terceros ni cuentas: el
// aviso va directo al servicio de notificaciones de Apple (o de Google en
// Android), que lo entrega al celular.
//
// Por qué existe este puente: Apps Script no puede cifrar ni firmar como
// exige Web Push (no tiene criptografía de curvas elípticas), y Cloudflare
// sí. Antes se intentó con ntfy.sh, pero ntfy no acepta conexiones desde
// Google ni desde Cloudflare.
//
// Lo llama SOLO Apps Script (avisarCelular en Code.gs), con:
//   { vapid: { publica, jwk: {x, y, d} }, suscripcion: { endpoint, keys: { p256dh, auth } },
//     titulo, mensaje }
// Las llaves viven en las propiedades del script de Apps Script; acá no se
// guarda nada. Solo se aceptan direcciones de los servicios de
// notificaciones conocidos, y el link al tocar el aviso va fijo al panel.

const PANEL_URL = 'https://belleza-panel.pages.dev/';
// Contacto que exige Web Push para identificar quién manda los avisos.
const CONTACTO = 'https://avellana-studio.pages.dev';
const SERVICIOS = [
  /^web\.push\.apple\.com$/, /\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/
];

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'GET') return new Response('puente-ok', { headers: { 'content-type': 'text/plain' } });
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  let d;
  try { d = await request.json(); } catch (err) { return json({ ok: false, error: 'json invalido' }, 400); }

  const s = d && d.suscripcion;
  const v = d && d.vapid;
  let destino;
  try { destino = new URL(String(s && s.endpoint)); } catch (err) { return json({ ok: false, error: 'suscripcion invalida' }, 400); }
  if (destino.protocol !== 'https:' || !SERVICIOS.some(re => re.test(destino.hostname))) {
    return json({ ok: false, error: 'servicio de avisos no permitido' }, 400);
  }
  if (!s.keys || !s.keys.p256dh || !s.keys.auth || !v || !v.publica || !v.jwk) {
    return json({ ok: false, error: 'faltan llaves' }, 400);
  }

  const contenido = JSON.stringify({
    title: recortar(d.titulo, 120) || 'Avellana',
    body: recortar(d.mensaje, 500),
    url: PANEL_URL
  });

  try {
    const cuerpo = await cifrar(contenido, s.keys.p256dh, s.keys.auth);
    const jwt = await firmarVapid(destino.origin, v.jwk);
    const r = await fetch(destino.toString(), {
      method: 'POST',
      headers: {
        'Authorization': 'vapid t=' + jwt + ', k=' + v.publica,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': '86400',
        'Urgency': 'high'
      },
      body: cuerpo
    });
    // 404/410: ese celular ya no tiene la app o quitó el permiso. Apps
    // Script lo borra de la lista al ver "vencida".
    const vencida = r.status === 404 || r.status === 410;
    if (r.ok) return json({ ok: true, estado: r.status });
    const detalle = recortar(await r.text().catch(() => ''), 300);
    return json({ ok: false, estado: r.status, vencida: vencida, error: detalle || ('respondio ' + r.status) }, vencida ? 200 : 502);
  } catch (err) {
    return json({ ok: false, error: 'no se pudo mandar: ' + (err && err.message || String(err)) }, 502);
  }
}

// ---------- Web Push: cifrado (RFC 8291, aes128gcm) ----------

async function cifrar(texto, p256dh, auth) {
  const pubCelular = b64aBytes(p256dh);   // llave pública del celular (65 bytes)
  const secretoAuth = b64aBytes(auth);    // secreto compartido (16 bytes)

  // Par de llaves de un solo uso para este aviso
  const efimera = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubServidor = new Uint8Array(await crypto.subtle.exportKey('raw', efimera.publicKey));
  const llaveCelular = await crypto.subtle.importKey('raw', pubCelular, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secretoEcdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: llaveCelular }, efimera.privateKey, 256));

  const prkAuth = await hmac(secretoAuth, secretoEcdh);
  const infoLlave = unir(texto2bytes('WebPush: info\0'), pubCelular, pubServidor);
  const ikm = (await hmac(prkAuth, unir(infoLlave, new Uint8Array([1])))).slice(0, 32);

  const sal = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(sal, ikm);
  const cek = (await hmac(prk, unir(texto2bytes('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, unir(texto2bytes('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const llaveAes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const plano = unir(texto2bytes(texto), new Uint8Array([2])); // 2 = último (y único) bloque
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, llaveAes, plano));

  // Encabezado: sal (16) · tamaño de bloque (4) · largo de la llave (1) · llave pública del servidor (65)
  const encabezado = new Uint8Array(16 + 4 + 1 + pubServidor.length);
  encabezado.set(sal, 0);
  new DataView(encabezado.buffer).setUint32(16, 4096);
  encabezado[20] = pubServidor.length;
  encabezado.set(pubServidor, 21);
  return unir(encabezado, cifrado);
}

// ---------- Web Push: firma VAPID (RFC 8292, ES256) ----------

async function firmarVapid(audiencia, jwk) {
  const llave = await crypto.subtle.importKey('jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cabecera = bytesAb64(texto2bytes(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const datos = bytesAb64(texto2bytes(JSON.stringify({
    aud: audiencia,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: CONTACTO
  })));
  const firma = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, llave, texto2bytes(cabecera + '.' + datos)));
  return cabecera + '.' + datos + '.' + bytesAb64(firma);
}

// ---------- utilidades ----------

async function hmac(llave, datos) {
  const k = await crypto.subtle.importKey('raw', llave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, datos));
}

function unir(...partes) {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const salida = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { salida.set(p, i); i += p.length; }
  return salida;
}

function texto2bytes(t) { return new TextEncoder().encode(t); }

function b64aBytes(b64) {
  const normal = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(normal + '==='.slice((normal.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function bytesAb64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
