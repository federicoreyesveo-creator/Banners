// Lee el PSD fuera del hilo principal para que la página no se congele con archivos grandes.
// También arma los fondos 2x con las fotos originales embebidas en los objetos inteligentes.
import '../../vendor/ag-psd.js';
import { psdToSources } from '../core/psd.js';

const ag = self.agPsd;
ag.initializeCanvas(
  (w, h) => new OffscreenCanvas(w, h),
  (w, h) => new ImageData(w, h),
);

const HI = 2;

function rasterCanvas(r) {
  const c = new OffscreenCanvas(r.w, r.h);
  c.getContext('2d').putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
  return c;
}

/** Recompone el fondo en 2x: fotos originales donde existan, el resto agrandado desde 1x. */
async function buildHiBg(bg, linked) {
  const W = bg.raster.w * HI, H = bg.raster.h * HI;
  const c = new OffscreenCanvas(W, H), ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  let used = false;
  for (const p of bg.parts) {
    ctx.globalAlpha = p.opacity ?? 1;
    const t = p.smart && p.smart.t;
    const file = p.smart && linked[p.smart.id];
    const axis = t && Math.abs(t[1] - t[3]) < 0.5 && Math.abs(t[0] - t[6]) < 0.5;
    if (file && axis) {
      try {
        const x = t[0] * HI, y = t[1] * HI, w = (t[2] - t[0]) * HI, h = (t[7] - t[1]) * HI;
        // Decodifica la foto original ya achicada al tamaño 2x (no carga los 8000 px en el canvas).
        const bmp = await createImageBitmap(new Blob([file.data], { type: file.type }), { resizeWidth: Math.max(1, Math.round(w)), resizeHeight: Math.max(1, Math.round(h)), resizeQuality: 'high' });
        ctx.drawImage(bmp, x, y, w, h);
        bmp.close();
        used = true;
        continue;
      } catch (e) { /* si no se puede decodificar, usa los pixeles 1x */ }
    }
    ctx.drawImage(rasterCanvas(p.raster), p.x * HI, p.y * HI, p.raster.w * HI, p.raster.h * HI);
  }
  ctx.globalAlpha = 1;
  if (!used) return null;
  const d = ctx.getImageData(0, 0, W, H);
  return { w: W, h: H, data: d.data, k: HI };
}

self.onmessage = async (ev) => {
  try {
    const { buffer } = ev.data;
    const sources = psdToSources(ag.readPsd, new Uint8Array(buffer));
    for (const frames of Object.values(sources.sizes)) {
      for (const f of frames) {
        if (f.bg && f.bg.parts) {
          f.bg.hi = await buildHiBg(f.bg, sources.linked);
          delete f.bg.parts;
        }
      }
    }
    delete sources.linked;
    const transfer = [];
    for (const frames of Object.values(sources.sizes)) {
      for (const f of frames) {
        if (f.bg) { transfer.push(f.bg.raster.data.buffer); if (f.bg.hi) transfer.push(f.bg.hi.data.buffer); }
        for (const e of f.elements) transfer.push(e.raster.data.buffer);
      }
    }
    self.postMessage({ ok: true, sources }, [...new Set(transfer)]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
