// Utilidades compartidas por las páginas de producto (/p/...) y el sitemap.
// Leen el catálogo por /api/catalogo, así aprovechan la misma copia del
// borde y nunca le pegan directo a Apps Script.

export async function leerCatalogo(origin) {
  const r = await fetch(origin + '/api/catalogo');
  const d = await r.json();
  if (!d || !d.ok || !Array.isArray(d.productos)) throw new Error('sin catálogo');
  return d.productos.filter(estaPublicado);
}

// Misma regla que la tienda (index.html → estaPublicado)
function estaPublicado(p) {
  const v = String(p.publicado ?? '').trim().toLowerCase();
  if (v === '') return true;
  return !['no', 'false', '0', 'oculto'].includes(v);
}

// Misma agrupación que la tienda (index.html → agruparProductos): marca + nombre;
// los tonos son variantes del mismo producto.
export function agrupar(productos) {
  const grupos = new Map();
  for (const p of productos) {
    const slug = slugDe(p);
    if (!slug) continue;
    if (!grupos.has(slug)) grupos.set(slug, { slug, marca: p.marca || '', nombre: p.nombre || '', categoria: p.categoria || '', variantes: [] });
    grupos.get(slug).variantes.push(p);
  }
  return [...grupos.values()];
}

export function slugDe(p) {
  return ((p.marca || '') + ' ' + (p.nombre || ''))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

// Misma cuenta que la tienda (index.html → precioFinal)
export function precioFinal(p) {
  const precio = Number(p.precioVenta) || 0;
  const pct = Number(p.descuento) || 0;
  return pct > 0 ? Math.round(precio * (1 - pct / 100)) : precio;
}

export function hayStock(p) {
  return p.modalidad !== 'encargo' && (Number(p.stock) || 0) > 0;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Mismo formato que la tienda (index.html → colones): ₡6.000
export const colones = n => '₡' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
