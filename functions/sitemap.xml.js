// Sitemap automático: la portada + una página por producto (/p/...),
// sacado del catálogo real. Se arma solo cada vez que cambia el catálogo.
import { leerCatalogo, agrupar } from './_lib/catalogo.js';

export async function onRequest({ request }) {
  const origin = new URL(request.url).origin;
  let urls = [origin + '/'];
  try {
    urls = urls.concat(agrupar(await leerCatalogo(origin)).map(g => origin + '/p/' + g.slug));
  } catch (err) { /* sin catálogo: al menos la portada */ }
  const hoy = new Date().toISOString().slice(0, 10);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(u => `  <url><loc>${u}</loc><lastmod>${hoy}</lastmod></url>`).join('\n')
    + '\n</urlset>\n';
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
