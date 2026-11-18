// Fondo en alta resolución a partir de las fotos originales de los objetos inteligentes.
// Se compone a la escala exacta que se necesita (retina del banner, zoom del editor), siempre achicando
// desde el original; solo las capas sin original (degradados, viñetas) salen de los pixeles del PSD.
import { rasterToCanvas, newCanvas } from './canvas.js';

const cache = new WeakMap(); // bg -> Map(F -> canvas)
const layerCanvases = new WeakMap();

function layerCanvas(r) {
  let c = layerCanvases.get(r);
  if (!c) { c = rasterToCanvas(r); layerCanvases.set(r, c); }
  return c;
}

/** Achica en pasos de a la mitad (más nítido y sin aliasing que un solo drawImage grande). */
function stepDown(img, tw) {
  let src = img, w = img.width, h = img.height;
  while (w / 2 >= tw * 1.05) {
    const c = newCanvas(Math.round(w / 2), Math.round(h / 2));
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    src = c; w = c.width; h = c.height;
  }
  return src;
}

/** ¿Este fondo tiene alguna foto original disponible? */
export function hasOriginal(bg, linked) {
  return !!(bg && bg.parts && linked && bg.parts.some((p) => p.smart && linked[p.smart.id]));
}

/**
 * Fondo compuesto a F veces su tamaño en el PSD (F = escala del layout × densidad).
 * Devuelve null si no hay originales (se usa la capa normal).
 */
export function bgAt(bg, F, linked, { round = false } = {}) {
  if (!hasOriginal(bg, linked)) return null;
  if (round) F = Math.max(0.25, Math.ceil(F * 4) / 4); // en el editor: escalones de 0,25 para reusar lo ya armado
  F = Math.round(F * 1000) / 1000;
  let m = cache.get(bg);
  if (!m) { m = new Map(); cache.set(bg, m); }
  if (m.has(F)) return m.get(F);
  const W = Math.round(bg.raster.w * F), H = Math.round(bg.raster.h * F);
  const c = newCanvas(W, H), ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  for (const p of bg.parts) {
    ctx.globalAlpha = p.opacity ?? 1;
    const img = p.smart && linked[p.smart.id];
    if (img) {
      // Transform del objeto inteligente: esquinas sup-izq, sup-der, inf-der, inf-izq (sirve rotado o espejado).
      const t = p.smart.t.map((v) => v * F);
      const tw = Math.hypot(t[2] - t[0], t[3] - t[1]);
      const src = stepDown(img, tw);
      ctx.setTransform((t[2] - t[0]) / src.width, (t[3] - t[1]) / src.width, (t[6] - t[0]) / src.height, (t[7] - t[1]) / src.height, t[0], t[1]);
      ctx.drawImage(src, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(layerCanvas(p.raster), p.x * F, p.y * F, p.raster.w * F, p.raster.h * F);
    }
  }
  ctx.globalAlpha = 1;
  if (m.size > 4) m.delete(m.keys().next().value);
  m.set(F, c);
  return c;
}
