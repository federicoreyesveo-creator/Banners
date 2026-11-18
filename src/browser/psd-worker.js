// Lee el PSD fuera del hilo principal para que la página no se congele con archivos grandes.
import '../../vendor/ag-psd.js';
import { psdToSources } from '../core/psd.js';

const ag = self.agPsd;
ag.initializeCanvas(
  (w, h) => new OffscreenCanvas(w, h),
  (w, h) => new ImageData(w, h),
);

self.onmessage = (ev) => {
  try {
    const { buffer } = ev.data;
    const sources = psdToSources(ag.readPsd, new Uint8Array(buffer));
    const transfer = [];
    for (const frames of Object.values(sources.sizes)) {
      for (const f of frames) {
        if (f.bg) transfer.push(f.bg.raster.data.buffer);
        for (const e of f.elements) transfer.push(e.raster.data.buffer);
      }
    }
    // Varios rasters pueden compartir buffer: solo se transfieren los únicos.
    self.postMessage({ ok: true, sources }, [...new Set(transfer)]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
