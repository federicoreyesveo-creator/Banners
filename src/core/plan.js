// Modelo del proyecto, layout por tamaño y línea de tiempo. Sin DOM.
import { splitColumns, alphaBounds } from './raster.js';

export const ANIMS = {
  fromL: { label: 'Entra desde la izquierda', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: 'translateX(-16px)' },
  fromR: { label: 'Entra desde la derecha', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: 'translateX(16px)' },
  fromT: { label: 'Entra desde arriba', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: 'translateY(-7.5px)' },
  fromB: { label: 'Entra desde abajo', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: 'translateY(7.5px)' },
  fade: { label: 'Fundido', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: '' },
  zoom: { label: 'Zoom (escala)', dur: 0.375, ease: 'cubic-bezier(.215,.61,.355,1)', from: 'scale(1.27)' },
  zoomL: { label: 'Zoom logo', dur: 0.5, ease: 'cubic-bezier(.215,.61,.355,1)', from: 'scale(1.28)' },
  letters: { label: 'Letra por letra (GSAP)', dur: 0.3, ease: 'power1.out', from: '', split: 'letters', stagger: 0.03, gsap: true },
  words: { label: 'Palabra por palabra (GSAP)', dur: 0.375, ease: 'power1.out', from: '', split: 'words', stagger: 0.08, gsap: true },
  typewriter: { label: 'Máquina de escribir (GSAP)', dur: 0.01, ease: 'none', from: '', split: 'letters', stagger: 0.045, gsap: true },
  none: { label: 'Sin animación', dur: 0, ease: 'linear', from: '' },
};

/** Efectos de la foto de fondo (terminan siempre en la posición del diseño). */
export const PHOTO_FX = {
  none: { label: 'Sin efecto' },
  kenburns: { label: 'Ken Burns (zoom lento)', gsap: true },
  parallax: { label: 'Parallax (desplazamiento lento)', gsap: true },
};

/** Efecto del botón al final. */
export const CTA_FX = {
  none: { label: 'Sin efecto' },
  pulse: { label: 'Pulso', gsap: true },
  shine: { label: 'Brillo', gsap: true },
};

export const GSAP_CDN = 'https://s0.2mdn.net/ads/studio/cached_libs/gsap_3.12.5_min.js';

export const TRANSITIONS = {
  wipe: { label: 'Barrido', dur: 0.5, textLag: 0.415, css: true },
  fade: { label: 'Fundido', dur: 0.4, textLag: 0.45, css: true },
  slide: { label: 'Deslizar (empuja)', dur: 0.5, textLag: 0.45 },
  zoom: { label: 'Zoom', dur: 0.5, textLag: 0.45 },
  diagonal: { label: 'Barrido diagonal', dur: 0.6, textLag: 0.5 },
  circle: { label: 'Círculo', dur: 0.6, textLag: 0.5 },
  mask: { label: 'Máscara desde el centro', dur: 0.5, textLag: 0.45 },
  blur: { label: 'Desenfoque', dur: 0.5, textLag: 0.45 },
};

const frameTransition = (project, pf) => (pf.transition && TRANSITIONS[pf.transition] ? pf.transition : project.transition);

/** ¿Hace falta GSAP? Solo cuando se usa algo que CSS puro de este motor no cubre (o si se pidió GSAP). */
export function needsGsap(project) {
  if (project.engine === 'gsap') return true;
  if (project.ctaFx && project.ctaFx !== 'none') return true;
  const trs = new Set(project.frames.slice(1).map((pf) => frameTransition(project, pf)));
  if (trs.size > 1) return true;
  for (const t of trs) if (!TRANSITIONS[t]?.css) return true;
  if (!TRANSITIONS[project.transition]?.css) return true;
  for (const pf of project.frames) {
    const fx = pf.photoFx || project.photoFx;
    if (fx && fx !== 'none') return true;
    for (const a of Object.values(pf.anims)) if (ANIMS[a.anim]?.gsap) return true;
  }
  return false;
}

// Ordenados por volumen de inventario (IAB / Google): primero los que más impresiones mueven.
export const PRESET_SIZES = ['300x250', '728x90', '300x600', '320x50', '160x600', '970x250', '336x280', '320x480'];

export const parseSize = (s) => { const [w, h] = s.split('x').map(Number); return { w, h }; };

/** Duraciones por defecto: el último frame (CTA) queda más tiempo y el total ronda 12-14 s. */
export function defaultDurations(n) {
  if (n <= 1) return [3];
  const last = 3;
  const each = Math.min(2.4, Math.max(1.6, Math.round(((13 - last) / (n - 1)) * 10) / 10));
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? last : each));
}

/** Animación por defecto de cada elemento, según la referencia de Animate. */
export function defaultAnims(frame, frameIndex) {
  const texts = frame.elements.filter((e) => e.kind === 'text');
  const hasLogo = frame.elements.some((e) => e.kind === 'logo');
  const out = {};
  let k = frameIndex % 2;
  for (const e of frame.elements) {
    if (e.kind === 'logo') out[e.id] = { anim: 'zoomL', delay: 0 };
    else if (e.kind === 'cta') out[e.id] = { anim: 'fade', delay: hasLogo ? 1.0 : 0.4 };
    else if (texts.length === 1 && e.y + e.raster.h / 2 < frame.h / 2) out[e.id] = { anim: 'fromT', delay: 0 };
    else { out[e.id] = { anim: k % 2 === 0 ? 'fromL' : 'fromR', delay: 0 }; k++; }
  }
  return out;
}

/** Layout identidad para el tamaño original del PSD. */
export function identityLayout(frame) {
  const el = {};
  for (const e of frame.elements) el[e.id] = { x: e.x, y: e.y, s: 1 };
  return { bg: frame.bg ? { x: frame.bg.x, y: frame.bg.y, s: 1 } : null, el };
}

/** Adapta un frame del tamaño maestro a otro tamaño: foto en modo "cover", elementos escalados y centrados. */
export function autoLayout(frame, W, H) {
  const out = { bg: null, el: {} };
  if (frame.bg) {
    const r = frame.bg.raster;
    // Solo cuenta la parte opaca de la foto (puede tener bordes transparentes o degradados).
    const ob = (r._opaque ||= alphaBounds(r, 250) || { x: 0, y: 0, w: r.w, h: r.h });
    const s = Math.max(W / ob.w, H / ob.h);
    // Centro de lo que se veía en el maestro, relativo a la foto.
    const cx = (frame.w / 2 - frame.bg.x), cy = (frame.h / 2 - frame.bg.y);
    let x = W / 2 - cx * s, y = H / 2 - cy * s;
    x = Math.min(-ob.x * s, Math.max(W - (ob.x + ob.w) * s, x));
    y = Math.min(-ob.y * s, Math.max(H - (ob.y + ob.h) * s, y));
    out.bg = { x: Math.round(x), y: Math.round(y), s: Math.round(s * 1000) / 1000 };
  }
  const els = frame.elements;
  if (!els.length) return out;
  const pad = Math.max(4, Math.round(Math.min(W, H) * 0.1));
  // Formatos apaisados (728x90, 970x250, 320x50): los renglones y el logo/botón se acomodan en fila.
  if (W / H >= 2.6) {
    const order = [...els].sort((a, b) => (a.kind === 'text') === (b.kind === 'text') ? a.y - b.y || a.x - b.x : a.kind === 'text' ? -1 : 1);
    const gapOf = (h) => Math.round(h * 0.3);
    const rowSize = (row) => ({ w: row.reduce((a, e, i) => a + e.raster.w + (i ? gapOf(e.raster.h) : 0), 0), h: Math.max(...row.map((e) => e.raster.h)) });
    const layouts = [[order]];
    for (let k = 1; k < order.length; k++) layouts.push([order.slice(0, k), order.slice(k)]);
    let best = null;
    for (const rows of layouts) {
      const sizes = rows.map(rowSize);
      const vgap = rows.length > 1 ? Math.round(sizes[0].h * 0.2) : 0;
      const tw = Math.max(...sizes.map((z) => z.w)), th = sizes.reduce((a, z) => a + z.h, 0) + vgap;
      const g = Math.min(1, (W - pad * 2) / tw, (H - pad * 2) / th);
      if (!best || g > best.g + 0.02) best = { rows, sizes, vgap, g, th };
    }
    const { rows, sizes, vgap, g, th } = best;
    let y = (H - th * g) / 2;
    rows.forEach((row, ri) => {
      const z = sizes[ri];
      let x = (W - z.w * g) / 2;
      for (const e of row) {
        out.el[e.id] = { x: Math.round(x), y: Math.round(y + ((z.h - e.raster.h) / 2) * g), s: Math.round(g * 1000) / 1000 };
        x += (e.raster.w + gapOf(e.raster.h)) * g;
      }
      y += (z.h + vgap) * g;
    });
    return out;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.raster.w); y1 = Math.max(y1, e.y + e.raster.h); }
  const gw = x1 - x0, gh = y1 - y0;
  // Nunca agranda los textos (se verían borrosos); solo los achica si no entran.
  const g = Math.min(1, (W - pad * 2) / gw, (H - pad * 2) / gh);
  const tw = gw * g, th = gh * g;
  // Mantiene la posición relativa del bloque y lo encierra dentro del área segura.
  const rcx = (x0 + gw / 2) / frame.w, rcy = (y0 + gh / 2) / frame.h;
  let gx = rcx * W - tw / 2, gy = rcy * H - th / 2;
  gx = Math.min(W - pad - tw, Math.max(pad, gx));
  gy = Math.min(H - pad - th, Math.max(pad, gy));
  for (const e of els) {
    out.el[e.id] = { x: Math.round(gx + (e.x - x0) * g), y: Math.round(gy + (e.y - y0) * g), s: Math.round(g * 1000) / 1000 };
  }
  return out;
}

/**
 * Plan completo de un tamaño: tiempos, posiciones y animaciones.
 * project: { frames:[{ id, duration, anims:{elId:{anim,delay,dur?}}, src }], transition, layouts:{size:{frameId: layout}} }
 */
export function buildPlan(project, size) {
  const { w: W, h: H } = parseSize(size);
  const tr = TRANSITIONS[project.transition] || TRANSITIONS.wipe;
  const frames = [];
  let t = 0;
  project.frames.forEach((pf, i) => {
    const src = pf.sources[size] || pf.sources[project.master];
    const lay = project.layouts[size][pf.id];
    const ftKey = frameTransition(project, pf);
    const ft = TRANSITIONS[ftKey] || tr;
    const textStart = i === 0 ? 0.21 : t + ft.textLag;
    const items = src.elements.filter((e) => !(lay.el[e.id] && lay.el[e.id].hidden)).map((e) => {
      const L = lay.el[e.id] || { x: e.x, y: e.y, s: 1 };
      const a = pf.anims[e.id] || { anim: 'fade', delay: 0 };
      const spec = ANIMS[a.anim] || ANIMS.fade;
      const it = { id: e.id, kind: e.kind, name: e.name, raster: e.raster, shadow: e.shadow, x: L.x, y: L.y, s: L.s, anim: a.anim, start: textStart + (a.delay || 0), dur: a.dur || spec.dur, stagger: spec.stagger };
      if (spec.split) {
        // Letras o palabras recortadas de la misma imagen: no cambia el diseño ni suma archivos.
        const gap = spec.split === 'words' ? Math.max(3, Math.round(e.raster.h * 0.22)) : 1;
        it.segs = splitColumns(e.raster, gap);
        const n = Math.max(1, it.segs.length - 1);
        // Si se estiró en la línea de tiempo, el escalonado se reparte en la nueva duración.
        if (a.dur) it.stagger = Math.max(0.005, (a.dur - spec.dur) / n);
        it.dur = spec.dur + it.stagger * (it.segs.length - 1);
      }
      return it;
    });
    // Una sola sombra suave por frame para los textos; logo y botón llevan la suya y se animan con su elemento.
    const shadows = [];
    const textSh = items.filter((it) => it.kind === 'text' && it.shadow);
    if (textSh.length) {
      const first = textSh.reduce((a, b) => (a.start <= b.start ? a : b));
      shadows.push({ id: `sh${i + 1}`, items: textSh, params: textSh[0].shadow, anim: 'fade', start: first.start, dur: Math.max(0.375, Math.min(1.2, first.dur)), follows: null });
    }
    for (const it of items) {
      if (it.kind !== 'text' && it.shadow) shadows.push({ id: `${it.id}s`, items: [it], params: it.shadow, anim: it.anim, start: it.start, dur: it.dur, follows: it.id });
    }
    frames.push({ index: i, id: pf.id, start: t, dur: pf.duration, transition: ftKey, trDur: ft.dur, photoFx: pf.photoFx || project.photoFx || 'none', bg: src.bg && lay.bg ? { raster: src.bg.raster, src: src.bg, ...lay.bg } : null, items, shadows });
    t += pf.duration;
  });
  return { W, H, size, transition: project.transition, trDur: tr.dur, total: t, frames, ctaFx: project.ctaFx || 'none', gsap: needsGsap(project), linked: project.linked || null };
}
