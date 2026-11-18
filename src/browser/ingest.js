// Lee lo que sube el usuario: ZIP (con PNG y/o PSD), PSD suelto o imágenes sueltas.
import { flatImagesToFrames } from '../core/psd.js';
import { decodeImage } from './canvas.js';

const IMG_RE = /\.(png|jpe?g|webp)$/i;
const SKIP_RE = /(__MACOSX|\/\.|storyboard|reference|referencia)/i;

let worker = null;
function parsePsd(buffer) {
  worker ||= new Worker(new URL('./psd-worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = (ev) => (ev.data.ok ? resolve(ev.data.sources) : reject(new Error(ev.data.error)));
    worker.onerror = (e) => reject(new Error(e.message || 'Error leyendo el PSD'));
    worker.postMessage({ buffer }, [buffer]);
  });
}

/**
 * Devuelve { sizes: {'WxH': frames[]}, kind: 'psd'|'png', notes: [] }.
 * Si hay PSD se usa el PSD (capas separadas); si no, los PNG aplanados como frames.
 */
export async function ingest(fileList, onStatus = () => {}) {
  const psds = [], images = [], notes = [];
  for (const file of fileList) {
    const name = file.name;
    if (/\.zip$/i.test(name)) {
      onStatus(`Abriendo ${name}…`);
      const zip = await window.JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((e) => !e.dir && !SKIP_RE.test('/' + e.name));
      for (const e of entries) {
        if (/\.psd$/i.test(e.name)) psds.push({ name: e.name, get: () => e.async('arraybuffer') });
        else if (IMG_RE.test(e.name)) images.push({ name: e.name.split('/').pop(), get: () => e.async('blob') });
      }
    } else if (/\.psd$/i.test(name)) psds.push({ name, get: () => file.arrayBuffer() });
    else if (IMG_RE.test(name)) images.push({ name, get: async () => file });
  }

  const sizes = {}, linked = {};
  if (psds.length) {
    for (const p of psds) {
      onStatus(`Leyendo capas de ${p.name.split('/').pop()}…`);
      const buf = await p.get();
      const src = await parsePsd(buf);
      for (const [k, frames] of Object.entries(src.sizes)) (sizes[k] ||= []).push(...frames);
      Object.assign(linked, src.linked);
    }
    if (images.length) notes.push('Usé el PSD (capas separadas). Los PNG del ZIP quedaron como referencia.');
    return { sizes, linked, kind: 'psd', notes };
  }
  if (images.length) {
    const decoded = [];
    for (const im of images) {
      onStatus(`Leyendo ${im.name}…`);
      decoded.push({ name: im.name, raster: await decodeImage(await im.get()) });
    }
    for (const f of flatImagesToFrames(decoded)) (sizes[`${f.w}x${f.h}`] ||= []).push(f);
    notes.push('Sin PSD: cada PNG es un frame completo, así que los textos no se animan por separado. Subí el PSD para animarlos.');
    return { sizes, kind: 'png', notes };
  }
  throw new Error('No encontré PSD ni imágenes PNG/JPG en lo que subiste.');
}
