// Modelo del proyecto, layout por tamaño y línea de tiempo. Sin DOM.

export const ANIMS = {
  fromL: { label: 'Entra desde la izquierda', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: 'translateX(-16px)' },
  fromR: { label: 'Entra desde la derecha', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: 'translateX(16px)' },
  fromT: { label: 'Entra desde arriba', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: 'translateY(-7.5px)' },
  fromB: { label: 'Entra desde abajo', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: 'translateY(7.5px)' },
  fade: { label: 'Fundido', dur: 0.375, ease: 'cubic-bezier(.25,.46,.45,.94)', from: '' },
  zoom: { label: 'Zoom (escala)', dur: 0.375, ease: 'cubic-bezier(.215,.61,.355,1)', from: 'scale(1.27)' },
  zoomL: { label: 'Zoom logo', dur: 0.5, ease: 'cubic-bezier(.215,.61,.355,1)', from: 'scale(1.28)' },
  none: { label: 'Sin animación', dur: 0, ease: 'linear', from: '' },
};

export const TRANSITIONS = {
  wipe: { label: 'Barrido', dur: 0.5, textLag: 0.415 },
  fade: { label: 'Fundido', dur: 0.4, textLag: 0.45 },
};

export const PRESET_SIZES = ['300x250', '728x90', '160x600', '300x600', '320x50', '970x250', '336x280', '320x480'];

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
    const s = Math.max(W / r.w, H / r.h);
    // Centro de lo que se veía en el maestro, relativo a la foto.
    const cx = (frame.w / 2 - frame.bg.x) / r.w, cy = (frame.h / 2 - frame.bg.y) / r.h;
    let x = W / 2 - cx * r.w * s, y = H / 2 - cy * r.h * s;
    x = Math.min(0, Math.max(W - r.w * s, x));
    y = Math.min(0, Math.max(H - r.h * s, y));
    out.bg = { x: Math.round(x), y: Math.round(y), s: Math.round(s * 1000) / 1000 };
  }
  const els = frame.elements;
  if (!els.length) return out;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.raster.w); y1 = Math.max(y1, e.y + e.raster.h); }
  const gw = x1 - x0, gh = y1 - y0;
  const pad = Math.max(4, Math.round(Math.min(W, H) * 0.08));
  const g = Math.min(1.25, (W - pad * 2) / gw, (H - pad * 2) / gh);
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
 * project: { frames:[{ id, duration, anims:{elId:{anim,delay}}, src }], transition, layouts:{size:{frameId: layout}} }
 */
export function buildPlan(project, size) {
  const { w: W, h: H } = parseSize(size);
  const tr = TRANSITIONS[project.transition] || TRANSITIONS.wipe;
  const frames = [];
  let t = 0;
  project.frames.forEach((pf, i) => {
    const src = pf.sources[size] || pf.sources[project.master];
    const lay = project.layouts[size][pf.id];
    const textStart = i === 0 ? 0.21 : t + tr.textLag;
    const items = src.elements.filter((e) => !(lay.el[e.id] && lay.el[e.id].hidden)).map((e) => {
      const L = lay.el[e.id] || { x: e.x, y: e.y, s: 1 };
      const a = pf.anims[e.id] || { anim: 'fade', delay: 0 };
      const spec = ANIMS[a.anim] || ANIMS.fade;
      return { id: e.id, kind: e.kind, name: e.name, raster: e.raster, shadow: e.shadow, x: L.x, y: L.y, s: L.s, anim: a.anim, start: textStart + (a.delay || 0), dur: spec.dur };
    });
    // Una sola sombra suave por frame para los textos; logo y botón llevan la suya y se animan con su elemento.
    const shadows = [];
    const textSh = items.filter((it) => it.kind === 'text' && it.shadow);
    if (textSh.length) {
      const first = textSh.reduce((a, b) => (a.start <= b.start ? a : b));
      shadows.push({ id: `sh${i + 1}`, items: textSh, params: textSh[0].shadow, anim: 'fade', start: first.start, dur: 0.375, follows: null });
    }
    for (const it of items) {
      if (it.kind !== 'text' && it.shadow) shadows.push({ id: `${it.id}s`, items: [it], params: it.shadow, anim: it.anim, start: it.start, dur: it.dur, follows: it.id });
    }
    frames.push({ index: i, id: pf.id, start: t, dur: pf.duration, bg: src.bg && lay.bg ? { raster: src.bg.raster, ...lay.bg } : null, items, shadows });
    t += pf.duration;
  });
  return { W, H, size, transition: project.transition, trDur: tr.dur, total: t, frames };
}
