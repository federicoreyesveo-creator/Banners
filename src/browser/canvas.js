// Puente entre rasters (RGBA puros) y canvas del navegador.
import { makeRaster } from '../core/raster.js';

const cache = new WeakMap();

export function rasterToCanvas(r) {
  let c = cache.get(r);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = r.w; c.height = r.h;
  c.getContext('2d').putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
  cache.set(r, c);
  return c;
}

export function canvasToRaster(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  return makeRaster(c.width, c.height, d.data);
}

export function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

/** Re-muestrea un raster a escala s con suavizado de alta calidad (por pasos si achica mucho). */
export function scaledCanvas(r, s) {
  const src = rasterToCanvas(r);
  if (Math.abs(s - 1) < 1e-3) return src;
  let cur = src, cw = r.w, ch = r.h;
  const tw = Math.max(1, Math.round(r.w * s)), th = Math.max(1, Math.round(r.h * s));
  while (cw / 2 > tw) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const c = newCanvas(nw, nh), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, nw, nh);
    cur = c; cw = nw; ch = nh;
  }
  const out = newCanvas(tw, th), ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, tw, th);
  return out;
}

export function toBlob(canvas, type, quality) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

export async function decodeImage(blob) {
  const bmp = await createImageBitmap(blob);
  const c = newCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  return canvasToRaster(c);
}

// ---- PNG gris+alfa para sombras (mitad de canales que RGBA: pesa mucho menos y conserva el alfa completo) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function zlib(bytes) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Codifica un raster de un solo color (sombra) como PNG gris+alfa, con filtro por fila. */
export async function encodeShadowPng(r) {
  const { w, h, data } = r;
  const gray = Math.round((data[0] + data[1] + data[2]) / 3) || 0;
  const row = w * 2, raw = new Uint8Array((row + 1) * h);
  let prev = new Uint8Array(row);
  for (let y = 0; y < h; y++) {
    const cur = new Uint8Array(row);
    for (let x = 0; x < w; x++) { cur[x * 2] = gray; cur[x * 2 + 1] = data[(y * w + x) * 4 + 3]; }
    // Elige entre "Sub" y "Up" el filtro con menor suma (heurística estándar).
    const sub = new Uint8Array(row), up = new Uint8Array(row);
    let ss = 0, su = 0;
    for (let i = 0; i < row; i++) {
      sub[i] = (cur[i] - (i >= 2 ? cur[i - 2] : 0)) & 255; up[i] = (cur[i] - prev[i]) & 255;
      ss += sub[i] < 128 ? sub[i] : 256 - sub[i]; su += up[i] < 128 ? up[i] : 256 - up[i];
    }
    const o = y * (row + 1);
    if (ss <= su) { raw[o] = 1; raw.set(sub, o + 1); } else { raw[o] = 2; raw.set(up, o + 1); }
    prev = cur;
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 4;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await zlib(raw)), chunk('IEND', new Uint8Array())];
  return new Blob(parts, { type: 'image/png' });
}
