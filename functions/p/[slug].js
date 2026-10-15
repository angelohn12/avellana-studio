// Página de producto para Google: /p/<marca-nombre>
//
// La tienda (index.html) es una sola página que arma los productos con
// JavaScript, así que Google no veía ningún producto. Esta función arma,
// desde el catálogo real, una página sencilla por producto con nombre,
// foto, precio, tonos y los datos de producto que Google usa para mostrar
// el precio en los resultados. El botón lleva a la tienda con la ficha
// del producto ya abierta (/?p=<id>), donde se pide como siempre.
import { leerCatalogo, agrupar, precioFinal, hayStock, esc, colones } from '../_lib/catalogo.js';

export async function onRequest({ request, params }) {
  const url = new URL(request.url);
  const origin = url.origin;
  let grupos;
  try { grupos = agrupar(await leerCatalogo(origin)); }
  catch (err) { return Response.redirect(origin + '/', 302); }

  const g = grupos.find(x => x.slug === params.slug);
  if (!g) return Response.redirect(origin + '/', 302);

  const v = g.variantes;
  const conStock = v.filter(hayStock);
  const principal = conStock[0] || v[0];
  const precios = v.map(precioFinal).filter(n => n > 0);
  const min = precios.length ? Math.min(...precios) : 0, max = precios.length ? Math.max(...precios) : 0;
  const foto = (v.find(x => x.foto) || {}).foto || origin + '/icon-512.png';
  const desc = (v.find(x => x.descripcion) || {}).descripcion || '';
  const titulo = `${g.nombre}${g.marca ? ' de ' + g.marca : ''}`;
  const metaDesc = (desc ? desc + ' ' : '') + `Precio en Costa Rica: ${colones(min)}. Envíos a todo el país, pago por SINPE Móvil.`;
  const canonical = origin + '/p/' + g.slug;
  const tonos = v.filter(x => x.tono).map(x => x.tono);

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: titulo,
    image: v.filter(x => x.foto).slice(0, 5).map(x => x.foto),
    description: desc || titulo,
    brand: g.marca ? { '@type': 'Brand', name: g.marca } : undefined,
    category: g.categoria || undefined,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'CRC',
      lowPrice: min,
      highPrice: max,
      offerCount: v.length,
      availability: conStock.length ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
      url: canonical,
      seller: { '@type': 'Organization', name: 'Avellana Studio' }
    }
  };

  // Otros productos de la misma marca: enlaces internos para que Google
  // (y la clienta) recorra el catálogo.
  const relacionados = grupos.filter(x => x.slug !== g.slug && x.marca === g.marca).slice(0, 8);

  const html = `<!doctype html>
<html lang="es-CR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} — ${esc(colones(min))} | Avellana Studio</title>
<meta name="description" content="${esc(metaDesc.slice(0, 300))}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/favicon.png" type="image/png">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Avellana Studio">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(metaDesc.slice(0, 200))}">
<meta property="og:image" content="${esc(foto)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="es_CR">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Serif+Display&display=swap">
<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>
<style>
:root{--vino:#3B0F1F;--baya:#6E1D3B;--tinta:#0F0F0F;--tinta-2:#5B5852;--linea:#E2E0DC;--hueso:#F7F6F4}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--tinta);font:400 16px/1.55 'DM Sans',system-ui,sans-serif}
header{border-bottom:1px solid var(--linea);padding:14px 16px}
header a{color:var(--vino);font:400 22px 'DM Serif Display',serif;text-decoration:none}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px;display:grid;gap:28px}
@media(min-width:760px){main{grid-template-columns:1fr 1fr;align-items:start}}
.foto{width:100%;aspect-ratio:1;object-fit:cover;background:var(--hueso);border-radius:12px}
.marca{color:var(--tinta-2);font-size:14px;letter-spacing:.06em;text-transform:uppercase;margin:0}
h1{font:400 32px/1.15 'DM Serif Display',serif;color:var(--vino);margin:6px 0 12px}
.precio{font-size:22px;font-weight:500;margin:0 0 6px;font-variant-numeric:tabular-nums}
.estado{color:var(--tinta-2);margin:0 0 18px}
.tonos{display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:0 0 18px;list-style:none}
.tonos li{border:1px solid var(--linea);border-radius:999px;padding:3px 10px;font-size:14px}
.btn{display:inline-block;background:var(--baya);color:#fff;text-decoration:none;font-weight:500;padding:13px 22px;border-radius:999px}
.rel{grid-column:1/-1;border-top:1px solid var(--linea);padding-top:20px}
.rel h2{font:400 22px 'DM Serif Display',serif;color:var(--vino);margin:0 0 10px}
.rel ul{padding:0;margin:0;list-style:none;display:grid;gap:6px}
.rel a{color:var(--tinta)}
footer{text-align:center;color:var(--tinta-2);font-size:14px;padding:24px 16px;border-top:1px solid var(--linea)}
</style>
</head>
<body>
<header><a href="/">avellana studio</a></header>
<main>
  <img class="foto" src="${esc(foto)}" alt="${esc(titulo)}" width="800" height="800">
  <div>
    ${g.marca ? `<p class="marca">${esc(g.marca)}</p>` : ''}
    <h1>${esc(g.nombre)}</h1>
    <p class="precio">${min === max ? esc(colones(min)) : 'Desde ' + esc(colones(min))}</p>
    <p class="estado">${conStock.length ? 'Disponible para entrega inmediata' : 'Disponible por encargo'}</p>
    ${desc ? `<p>${esc(desc)}</p>` : ''}
    ${tonos.length > 1 ? `<p class="marca">${tonos.length} tonos</p><ul class="tonos">${tonos.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <a class="btn" href="/?p=${encodeURIComponent(principal.id)}">Ver en la tienda y pedir</a>
  </div>
  ${relacionados.length ? `<section class="rel"><h2>Más de ${esc(g.marca)}</h2><ul>${relacionados.map(r => `<li><a href="/p/${r.slug}">${esc(r.nombre)}</a></li>`).join('')}</ul></section>` : ''}
</main>
<footer>Avellana Studio · Maquillaje y skincare en Costa Rica · Envíos a todo el país · <a href="/">Ir a la tienda</a></footer>
</body>
</html>`;

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600' } });
}
