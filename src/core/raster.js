// Utilidades de pixeles puras (sin DOM): funcionan en el navegador y en Node.
// Un "raster" es { w, h, data: Uint8ClampedArray RGBA }.

export function makeRaster(w, h, data) {
  return { w, h, data: data || new Uint8ClampedArray(w * h * 4) };
}

/** Caja que contiene los pixeles con alpha > umbral. null si está vacío. */
export function alphaBounds(r, threshold = 0) {
  const { w, h, data } = r;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function crop(r, x, y, w, h) {
  const out = makeRaster(w, h);
  for (let j = 0; j < h; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= r.h) continue;
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= r.w) continue;
      const s = (sy * r.w + sx) * 4, d = (j * w + i) * 4;
      out.data[d] = r.data[s]; out.data[d + 1] = r.data[s + 1];
      out.data[d + 2] = r.data[s + 2]; out.data[d + 3] = r.data[s + 3];
    }
  }
  return out;
}

/**
 * Separa una capa de texto en renglones buscando filas totalmente transparentes.
 * Devuelve [{ x, y, w, h }] relativos a la capa (ya recortados al contenido).
 */
export function splitLines(r, { minGap = 2, minLineHeight = 4 } = {}) {
  const { w, h, data } = r;
  const rowHas = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) { rowHas[y] = 1; break; }
    }
  }
  const bands = [];
  let start = -1, gap = 0;
  for (let y = 0; y <= h; y++) {
    const on = y < h && rowHas[y];
    if (on) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap >= minGap || y === h) {
        bands.push([start, y - gap + 1]);
        start = -1; gap = 0;
      }
    }
  }
  // Une bandas muy finas (puntos, acentos sueltos) con la vecina más cercana.
  const merged = [];
  for (const b of bands) {
    const last = merged[merged.length - 1];
    if (last && (b[1] - b[0] < minLineHeight || last[1] - last[0] < minLineHeight)) last[1] = b[1];
    else merged.push([b[0], b[1]]);
  }
  return merged.map(([y0, y1]) => {
    const band = crop(r, 0, y0, w, y1 - y0);
    const bb = alphaBounds(band) || { x: 0, y: 0, w, h: y1 - y0 };
    return { x: bb.x, y: y0 + bb.y, w: bb.w, h: bb.h };
  });
}

function gaussKernel(sigma) {
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(rad * 2 + 1);
  let sum = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + rad] = v; sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, rad };
}

/** Desenfoque gaussiano separable sobre un mapa Float32 de w*h. */
export function gaussianBlur(src, w, h, sigma) {
  if (sigma <= 0.01) return Float32Array.from(src);
  const { k, rad } = gaussKernel(sigma);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      const a = Math.max(0, x - rad), b = Math.min(w - 1, x + rad);
      for (let i = a; i <= b; i++) acc += src[row + i] * k[i - x + rad];
      tmp[row + x] = acc;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const a = Math.max(0, y - rad), b = Math.min(h - 1, y + rad);
      for (let i = a; i <= b; i++) acc += tmp[i * w + x] * k[i - y + rad];
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** Dilatación (máximo) separable de radio r. */
export function dilate(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) { const v = src[y * w + i]; if (v > m) m = v; }
    tmp[y * w + x] = m;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let m = 0;
    for (let i = Math.max(0, y - r); i <= Math.min(h - 1, y + r); i++) { const v = tmp[i * w + x]; if (v > m) m = v; }
    out[y * w + x] = m;
  }
  return out;
}

/** Factor que relaciona el "Tamaño" de Photoshop con la sigma del gaussiano (calibrado con los PSD del proyecto). */
export const PS_SIZE_TO_SIGMA = 0.42;

/**
 * Sombra paralela estilo Photoshop, como un solo PNG suave con alpha completo.
 * items: [{ raster, x, y, scale }] posicionados en el lienzo del banner.
 * shadow: { size, spread (0-100), opacity (0-1), distance, angle, color:{r,g,b} } en px de la fuente.
 * Devuelve { raster, x, y } o null.
 */
export function buildShadow(items, shadow, canvasW, canvasH, scaleOverride, sigmaFactor = PS_SIZE_TO_SIGMA) {
  if (!items.length || !shadow) return null;
  const scale = scaleOverride ?? 1;
  const size = shadow.size * scale;
  const spreadPx = Math.round(size * (shadow.spread || 0) / 100);
  const sigma = Math.max(0.5, (size - spreadPx) * sigmaFactor);
  const pad = Math.ceil(spreadPx + sigma * 3 + 2);
  const ang = ((shadow.angle ?? 90) * Math.PI) / 180;
  const dist = (shadow.distance || 0) * scale;
  const dx = -Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
  // Caja que contiene todos los items
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    const s = it.scale ?? 1;
    x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y);
    x1 = Math.max(x1, it.x + it.raster.w * s); y1 = Math.max(y1, it.y + it.raster.h * s);
  }
  const ox = Math.floor(x0 + dx) - pad, oy = Math.floor(y0 + dy) - pad;
  const W = Math.ceil(x1 - x0) + pad * 2 + 2, H = Math.ceil(y1 - y0) + pad * 2 + 2;
  const mask = new Float32Array(W * H);
  for (const it of items) {
    const s = it.scale ?? 1, r = it.raster;
    const tw = Math.round(r.w * s), th = Math.round(r.h * s);
    const bx = it.x + dx - ox, by = it.y + dy - oy;
    for (let j = 0; j < th; j++) {
      const sy = Math.min(r.h - 1, Math.floor(j / s));
      const ty = Math.round(by + j);
      if (ty < 0 || ty >= H) continue;
      for (let i = 0; i < tw; i++) {
        const sx = Math.min(r.w - 1, Math.floor(i / s));
        const tx = Math.round(bx + i);
        if (tx < 0 || tx >= W) continue;
        const a = r.data[(sy * r.w + sx) * 4 + 3] / 255;
        const idx = ty * W + tx;
        if (a > mask[idx]) mask[idx] = a;
      }
    }
  }
  const blurred = gaussianBlur(dilate(mask, W, H, spreadPx), W, H, sigma);
  const col = shadow.color || { r: 0, g: 0, b: 0 };
  const op = shadow.opacity ?? 0.75;
  const full = makeRaster(W, H);
  for (let i = 0; i < W * H; i++) {
    full.data[i * 4] = col.r; full.data[i * 4 + 1] = col.g; full.data[i * 4 + 2] = col.b;
    full.data[i * 4 + 3] = Math.round(Math.min(1, blurred[i]) * op * 255);
  }
  // Recorta al área visible del banner y a lo que tiene alpha.
  const vx0 = Math.max(0, -ox), vy0 = Math.max(0, -oy);
  const vx1 = Math.min(W, canvasW - ox), vy1 = Math.min(H, canvasH - oy);
  if (vx1 <= vx0 || vy1 <= vy0) return null;
  const vis = crop(full, vx0, vy0, vx1 - vx0, vy1 - vy0);
  const bb = alphaBounds(vis, 0);
  if (!bb) return null;
  return { raster: crop(vis, bb.x, bb.y, bb.w, bb.h), x: ox + vx0 + bb.x, y: oy + vy0 + bb.y };
}
