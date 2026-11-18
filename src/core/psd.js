// Convierte un PSD (con mesas de trabajo o con grupos por frame) en "fuentes" de banner.
// readPsd se inyecta (ag-psd) para que este módulo funcione igual en el navegador y en Node.
import { makeRaster, alphaBounds, crop, splitLines } from './raster.js';

const LOGO_RE = /logo/i;
const CTA_RE = /(learn\s*more|cta|bot[oó]n|button|shop|book|ver\s*m[aá]s|comprar|reserv|sign\s*up|get\s*started|descubr)/i;

function natCmp(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function toRaster(imageData) {
  return makeRaster(imageData.width, imageData.height, new Uint8ClampedArray(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength));
}

/** Composición simple (source-over con opacidad) de capas sobre un lienzo. */
function compositeInto(dst, ox, oy, layer) {
  const r = layer.raster, op = layer.opacity ?? 1;
  for (let j = 0; j < r.h; j++) {
    const ty = layer.y - oy + j;
    if (ty < 0 || ty >= dst.h) continue;
    for (let i = 0; i < r.w; i++) {
      const tx = layer.x - ox + i;
      if (tx < 0 || tx >= dst.w) continue;
      const s = (j * r.w + i) * 4, d = (ty * dst.w + tx) * 4;
      const sa = (r.data[s + 3] / 255) * op;
      if (sa <= 0) continue;
      const da = dst.data[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst.data[d + c] = Math.round((r.data[s + c] * sa + dst.data[d + c] * da * (1 - sa)) / oa);
      }
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
}

function readShadow(effects) {
  if (!effects || effects.disabled) return null;
  const list = Array.isArray(effects.dropShadow) ? effects.dropShadow : effects.dropShadow ? [effects.dropShadow] : [];
  const ds = list.find((d) => d && d.enabled !== false);
  if (!ds) return null;
  const px = (v) => (v && typeof v === 'object' ? v.value : v) || 0;
  return {
    size: px(ds.size),
    spread: px(ds.choke),
    distance: px(ds.distance),
    angle: ds.angle ?? 90,
    opacity: ds.opacity ?? 0.75,
    color: ds.color && 'r' in ds.color ? { r: Math.round(ds.color.r), g: Math.round(ds.color.g), b: Math.round(ds.color.b) } : { r: 0, g: 0, b: 0 },
  };
}

/** Aplana una lista de capas de ag-psd (recursivo), devolviendo solo las visibles con pixeles. */
function flatten(layers, out = [], parentOpacity = 1) {
  for (const l of layers || []) {
    if (l.hidden) continue;
    const op = (l.opacity ?? 1) * parentOpacity;
    if (l.children) { flatten(l.children, out, op); continue; }
    if (!l.imageData || !l.imageData.width || !l.imageData.height) continue;
    out.push({
      name: l.name || 'capa',
      x: l.left || 0,
      y: l.top || 0,
      raster: toRaster(l.imageData),
      opacity: op,
      isText: !!l.text,
      isSmart: !!l.placedLayer,
      shadow: readShadow(l.effects),
      // Objeto inteligente: guarda la foto original embebida para armar fondos 2x.
      smart: l.placedLayer && l.placedLayer.id && l.placedLayer.transform && !l.mask ? { id: l.placedLayer.id, t: l.placedLayer.transform } : null,
    });
  }
  return out;
}

let uid = 0;
const P = Math.random().toString(36).slice(2, 6);
const nextId = (p) => `${p}${++uid}_${P}`;

/**
 * Arma un frame a partir de las capas de una mesa de trabajo.
 * Fondo = capas que cubren buena parte del frame; el resto son elementos (texto, logo, botón).
 */
export function buildFrame(name, rect, layers) {
  const W = rect.right - rect.left, H = rect.bottom - rect.top;
  const local = layers.map((l) => ({ ...l, x: l.x - rect.left, y: l.y - rect.top }));
  const isBg = (l) => {
    if (l.isText || LOGO_RE.test(l.name) || CTA_RE.test(l.name)) return false;
    const ix = Math.max(0, Math.min(W, l.x + l.raster.w) - Math.max(0, l.x));
    const iy = Math.max(0, Math.min(H, l.y + l.raster.h) - Math.max(0, l.y));
    return (ix * iy) / (W * H) > 0.45;
  };
  // Todo lo que está debajo del último fondo también es fondo (degradados, viñetas, etc.).
  let lastBg = -1;
  local.forEach((l, i) => { if (isBg(l)) lastBg = i; });
  const bgLayers = local.slice(0, lastBg + 1);
  const fgLayers = local.slice(lastBg + 1);

  let bg = null;
  if (bgLayers.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of bgLayers) { x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y); x1 = Math.max(x1, l.x + l.raster.w); y1 = Math.max(y1, l.y + l.raster.h); }
    // La foto se guarda completa (sin recortar al frame) para poder moverla en el editor.
    const canvas = makeRaster(x1 - x0, y1 - y0);
    for (const l of bgLayers) compositeInto(canvas, x0, y0, l);
    bg = { raster: canvas, x: x0, y: y0 };
    // Piezas del fondo, para recomponerlo en 2x con las fotos originales (si las hay).
    if (bgLayers.some((l) => l.smart)) {
      bg.parts = bgLayers.map((l) => ({
        x: l.x - x0, y: l.y - y0, raster: l.raster, opacity: l.opacity,
        smart: l.smart ? { id: l.smart.id, t: l.smart.t.map((v, i) => v - (i % 2 ? rect.top + y0 : rect.left + x0)) } : null,
      }));
    }
  }

  const elements = [];
  for (const l of fgLayers) {
    const bb = alphaBounds(l.raster, 2);
    if (!bb) continue;
    const r = crop(l.raster, bb.x, bb.y, bb.w, bb.h);
    if (l.opacity < 1) for (let i = 3; i < r.data.length; i += 4) r.data[i] = Math.round(r.data[i] * l.opacity);
    const kind = LOGO_RE.test(l.name) ? 'logo' : CTA_RE.test(l.name) ? 'cta' : 'text';
    const base = { x: l.x + bb.x, y: l.y + bb.y };
    if (kind === 'text') {
      // Cada renglón se anima por separado, como en la referencia de Animate.
      const lines = splitLines(r);
      lines.forEach((ln, i) => {
        elements.push({
          id: nextId('t'), name: lines.length > 1 ? `${l.name} · ${i + 1}` : l.name, kind,
          raster: crop(r, ln.x, ln.y, ln.w, ln.h), x: base.x + ln.x, y: base.y + ln.y,
          shadow: l.shadow, group: l.name,
        });
      });
    } else {
      elements.push({ id: nextId(kind === 'logo' ? 'logo' : 'cta'), name: l.name, kind, raster: r, x: base.x, y: base.y, shadow: l.shadow, group: l.name });
    }
  }
  return { id: nextId('f'), name, w: W, h: H, bg, elements };
}

/**
 * Lee el PSD y devuelve { sizes: { 'WxH': frames[] } }.
 * Soporta mesas de trabajo (artboards) y, si no hay, grupos de primer nivel como frames.
 */
export function psdToSources(readPsd, buffer) {
  const psd = readPsd(buffer, { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const top = (psd.children || []).filter((g) => !g.hidden);
  const boards = top.filter((g) => g.children && g.artboard && g.artboard.rect);
  const frames = [];
  if (boards.length) {
    for (const g of boards) frames.push(buildFrame(g.name, g.artboard.rect, flatten(g.children)));
  } else {
    const groups = top.filter((g) => g.children);
    const rect = { left: 0, top: 0, right: psd.width, bottom: psd.height };
    if (groups.length > 1) for (const g of groups) frames.push(buildFrame(g.name, rect, flatten(g.children)));
    else frames.push(buildFrame(psd.name || 'Frame 1', rect, flatten(top)));
  }
  frames.sort((a, b) => natCmp(a.name, b.name));
  const sizes = {};
  for (const f of frames) (sizes[`${f.w}x${f.h}`] ||= []).push(f);
  // Archivos embebidos de los objetos inteligentes (la foto original en alta): JPG, PNG o PSB/PSD.
  // need = el ancho más grande al que aparece colocado (px del PSD), para no decodificar de más.
  const need = {};
  for (const fs of Object.values(sizes)) for (const f of fs) for (const p of f.bg?.parts || []) {
    if (!p.smart) continue;
    const t = p.smart.t, w = Math.max(Math.hypot(t[2] - t[0], t[3] - t[1]), Math.hypot(t[6] - t[0], t[7] - t[1]));
    need[p.smart.id] = Math.max(need[p.smart.id] || 0, w);
  }
  const linked = {};
  for (const lf of psd.linkedFiles || []) {
    if (!(lf.id in need) || !lf.data) continue;
    const d = lf.data;
    const type = d[0] === 0xff && d[1] === 0xd8 ? 'image/jpeg' : d[0] === 0x89 && d[1] === 0x50 ? 'image/png'
      : d[0] === 0x38 && d[1] === 0x42 && d[2] === 0x50 && d[3] === 0x53 ? 'psd' : null;
    if (type) linked[lf.id] = { type, data: d, need: need[lf.id] };
  }
  return { sizes, linked };
}

/** PNG/JPG aplanados (uno por frame): solo fondo, sin capas separadas. */
export function flatImagesToFrames(images) {
  const sorted = [...images].sort((a, b) => natCmp(a.name, b.name));
  return sorted.map((im) => ({
    id: nextId('f'), name: im.name, w: im.raster.w, h: im.raster.h,
    bg: { raster: im.raster, x: 0, y: 0 }, elements: [],
  }));
}
