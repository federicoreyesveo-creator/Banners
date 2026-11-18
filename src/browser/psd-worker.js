// Lee el PSD fuera del hilo principal para que la página no se congele con archivos grandes.
// Además decodifica las fotos originales de los objetos inteligentes (JPG, PNG o PSB anidado),
// así los fondos salen de la foto en alta y no de la vista previa chica de la capa.
import '../../vendor/ag-psd.js';
import { psdToSources } from '../core/psd.js';

const ag = self.agPsd;
ag.initializeCanvas(
  (w, h) => new OffscreenCanvas(w, h),
  (w, h) => new ImageData(w, h),
);

// Hasta 4 veces el tamaño colocado: alcanza para retina (2x) y para agrandar la foto en otros formatos.
const CAP = 4;

async function decodeOriginal(f) {
  let src;
  if (f.type === 'psd') {
    // PSB/PSD embebido: se usa su imagen compuesta (sin leer las capas internas).
    const sub = ag.readPsd(f.data, { useImageData: true, skipLayerImageData: true, skipThumbnail: true });
    if (!sub.imageData) return null;
    const c = new OffscreenCanvas(sub.width, sub.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(sub.imageData.data.buffer, sub.imageData.data.byteOffset, sub.imageData.data.byteLength), sub.width, sub.height), 0, 0);
    src = c;
  } else {
    src = await createImageBitmap(new Blob([f.data], { type: f.type }));
  }
  const w = src.width, h = src.height;
  const k = Math.min(1, (f.need * CAP) / w);
  if (k >= 1) return src instanceof ImageBitmap ? src : createImageBitmap(src);
  const bmp = await createImageBitmap(src, { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: 'high' });
  if (src.close) src.close();
  return bmp;
}

self.onmessage = async (ev) => {
  try {
    const { buffer } = ev.data;
    const sources = psdToSources(ag.readPsd, new Uint8Array(buffer));
    const originals = {};
    for (const [id, f] of Object.entries(sources.linked)) {
      try { const b = await decodeOriginal(f); if (b) originals[id] = b; } catch (e) { /* queda la capa en baja */ }
    }
    sources.linked = originals;
    const transfer = Object.values(originals);
    for (const frames of Object.values(sources.sizes)) {
      for (const f of frames) {
        if (f.bg) {
          transfer.push(f.bg.raster.data.buffer);
          // Solo se guardan las piezas si alguna tiene la foto original.
          if (f.bg.parts && f.bg.parts.some((p) => p.smart && originals[p.smart.id])) for (const p of f.bg.parts) transfer.push(p.raster.data.buffer);
          else delete f.bg.parts;
        }
        for (const e of f.elements) transfer.push(e.raster.data.buffer);
      }
    }
    self.postMessage({ ok: true, sources }, [...new Set(transfer)]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
