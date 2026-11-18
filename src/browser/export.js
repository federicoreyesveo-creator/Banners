// Renderiza los assets de un tamaño, arma el ZIP HTML5 (dentro del peso) y el GIF de respaldo.
import { buildPlan } from '../core/plan.js';
import { buildShadow } from '../core/raster.js';
import { buildHtml } from '../core/html.js';
import { buildGsapHtml } from '../core/html-gsap.js';
import { GSAP_CDN } from '../core/plan.js';

const GSAP_LOCAL = new URL('../../vendor/gsap.min.js', import.meta.url);
let gsapBlob = null;
async function localGsap() { gsapBlob ||= await (await fetch(GSAP_LOCAL)).blob(); return gsapBlob; }

/** Elige el motor: CSS puro (más liviano) salvo que se use algo que necesite GSAP. */
function makeHtml(plan, assets, { title, clickTag, embedGsap }) {
  if (!plan.gsap) return buildHtml(plan, assets, { title, clickTag });
  return buildGsapHtml(plan, assets, { title, clickTag, gsapSrc: embedGsap ? 'gsap.min.js' : GSAP_CDN });
}
import { rasterToCanvas, scaledCanvas, newCanvas, toBlob, encodeShadowPng } from './canvas.js';
import { GIFEncoder, quantize, applyPalette } from '../../vendor/gifenc.esm.js';

const JSZip = () => window.JSZip;

function letters(i) { return String.fromCharCode(97 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''); }

/** Renderiza fondo, elementos y sombras en canvas, en las posiciones finales del tamaño. */
export function renderFrameParts(plan) {
  const { W, H } = plan;
  const kindFrames = (k) => plan.frames.filter((x) => x.items.some((y) => y.kind === k)).length;
  return plan.frames.map((f, fi) => {
    let bg = null;
    if (f.bg) {
      bg = newCanvas(W, H);
      const ctx = bg.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingQuality = 'high';
      const src = f.bg.s === 1 ? rasterToCanvas(f.bg.raster) : scaledCanvas(f.bg.raster, f.bg.s);
      ctx.drawImage(src, Math.round(f.bg.x), Math.round(f.bg.y));
    }
    const counters = { text: 0, logo: 0, cta: 0 };
    const items = {};
    for (const it of f.items) {
      const c = scaledCanvas(it.raster, it.s);
      const n = counters[it.kind]++;
      const name = it.kind === 'text' ? `t${fi + 1}${letters(n)}` : `${it.kind}${n ? n + 1 : ''}${kindFrames(it.kind) > 1 ? `_f${fi + 1}` : ''}`;
      items[it.id] = { name, canvas: c, x: Math.round(it.x), y: Math.round(it.y), w: c.width, h: c.height };
    }
    const shadows = {};
    for (const s of f.shadows) {
      const sItems = s.items.map((it) => ({ raster: it.raster, x: Math.round(it.x), y: Math.round(it.y), scale: it.s }));
      const avgS = s.items.reduce((a, it) => a + it.s, 0) / s.items.length;
      const sh = buildShadow(sItems, s.params, W, H, avgS);
      if (!sh) continue;
      const name = s.follows ? `${items[s.follows].name}_sh` : `sh${fi + 1}`;
      const fol = s.follows ? items[s.follows] : null;
      shadows[s.id] = {
        name, raster: sh.raster, canvas: rasterToCanvas(sh.raster), x: sh.x, y: sh.y, w: sh.raster.w, h: sh.raster.h,
        ox: fol ? fol.x + fol.w / 2 - sh.x : 0, oy: fol ? fol.y + fol.h / 2 - sh.y : 0,
      };
    }
    return { bg, items, shadows };
  });
}

/** Imagen final de cada frame (todo visible), para el GIF y las miniaturas. */
export function composeFinal(plan, parts, fi) {
  const { W, H } = plan;
  const c = newCanvas(W, H), ctx = c.getContext('2d');
  const p = parts[fi], f = plan.frames[fi];
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (p.bg) ctx.drawImage(p.bg, 0, 0);
  const drawSh = (s) => { ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(s.canvas, s.x, s.y); ctx.globalCompositeOperation = 'source-over'; };
  for (const s of f.shadows) if (!s.follows && p.shadows[s.id]) drawSh(p.shadows[s.id]);
  for (const it of f.items) {
    for (const s of f.shadows) if (s.follows === it.id && p.shadows[s.id]) drawSh(p.shadows[s.id]);
    const a = p.items[it.id];
    ctx.drawImage(a.canvas, a.x, a.y);
  }
  return c;
}

async function encodeAssets(plan, parts, jpegQ) {
  const files = {}; // nombre -> Blob
  const assets = { frames: [] };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const A = { bg: null, items: {}, shadows: {} };
    if (p.bg) {
      const name = `bg${i + 1}.jpg`;
      files[name] = await toBlob(p.bg, 'image/jpeg', jpegQ);
      A.bg = { src: `images/${name}` };
    }
    for (const [id, a] of Object.entries(p.items)) {
      const name = `${a.name}.png`;
      files[name] ||= await toBlob(a.canvas, 'image/png');
      A.items[id] = { ...a, src: `images/${name}` };
    }
    for (const [id, a] of Object.entries(p.shadows)) {
      const name = `${a.name}.png`;
      files[name] ||= await encodeShadowPng(a.raster);
      A.shadows[id] = { ...a, src: `images/${name}` };
    }
    assets.frames.push(A);
  }
  return { files, assets };
}

/** Exporta un tamaño: ZIP HTML5 bajo el peso máximo (bajando calidad JPG si hace falta) + GIF. */
export async function exportSize(project, size, { title, clickTag, maxKB = 228, baseName, onProgress, embedGsap = false } = {}) {
  const plan = buildPlan(project, size);
  const parts = renderFrameParts(plan);
  const qualities = [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35];
  let best = null;
  for (const q of qualities) {
    onProgress?.(`Comprimiendo ${size} (JPG ${Math.round(q * 100)})…`);
    const { files, assets } = await encodeAssets(plan, parts, q);
    const html = makeHtml(plan, assets, { title, clickTag, embedGsap });
    const zip = new (JSZip())();
    zip.file('index.html', html);
    if (plan.gsap && embedGsap) zip.file('gsap.min.js', await localGsap());
    const img = zip.folder('images');
    for (const [n, b] of Object.entries(files)) img.file(n, b);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    best = { zip: blob, html, files, quality: q, plan, parts };
    if (blob.size <= maxKB * 1024) break;
  }
  onProgress?.(`Armando GIF ${size}…`);
  const gif = encodeGif(plan, parts);
  return { ...best, gif, size, fits: best.zip.size <= maxKB * 1024, baseName };
}

/** GIF de respaldo: un cuadro por frame (estado final), sin loop, paleta propia por cuadro para que las sombras no hagan banding. */
export function encodeGif(plan, parts) {
  const enc = GIFEncoder();
  plan.frames.forEach((f, i) => {
    const c = composeFinal(plan, parts, i);
    const { data } = c.getContext('2d').getImageData(0, 0, plan.W, plan.H);
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');
    enc.writeFrame(index, plan.W, plan.H, { palette, delay: Math.round(f.dur * 1000), repeat: -1 });
  });
  enc.finish();
  return new Blob([enc.bytes()], { type: 'image/gif' });
}

/** HTML con blobs locales, para la vista previa en vivo sin generar el ZIP. */
export async function previewHtml(project, size, opts) {
  const plan = buildPlan(project, size);
  const parts = renderFrameParts(plan);
  const { files, assets } = await encodeAssets(plan, parts, 0.92);
  const urls = {};
  for (const [n, b] of Object.entries(files)) urls[`images/${n}`] = URL.createObjectURL(b);
  let html = makeHtml(plan, assets, { ...opts, embedGsap: false });
  // La vista previa usa la copia local de GSAP (dentro de la app no se puede cargar el CDN de Google).
  if (plan.gsap) { const u = URL.createObjectURL(await localGsap()); urls['__gsap'] = u; html = html.replace(GSAP_CDN, u); }
  html = html.replace(/images\/[\w.-]+/g, (m) => urls[m] || m);
  return { html, urls: Object.values(urls), plan };
}
