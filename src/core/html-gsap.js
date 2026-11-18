// index.html con una línea de tiempo GSAP: más transiciones y efectos, mismas reglas de siempre
// (diseño intacto, sombra suave por frame, clickTag estándar, sin loop, termina en el CTA).
import { ANIMS, GSAP_CDN } from './plan.js';

const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const q = (id) => `"#${id}"`;

// Equivalentes GSAP de las curvas de la referencia: quadOut = power1.out, cubicOut = power2.out.
const EL = {
  fromL: { from: { x: -16 }, ease: 'power1.out' },
  fromR: { from: { x: 16 }, ease: 'power1.out' },
  fromT: { from: { y: -7.5 }, ease: 'power1.out' },
  fromB: { from: { y: 7.5 }, ease: 'power1.out' },
  fade: { from: {}, ease: 'power1.out' },
  zoom: { from: { scale: 1.27 }, ease: 'power2.out' },
  zoomL: { from: { scale: 1.28 }, ease: 'power2.out' },
};
const obj = (o) => JSON.stringify(o).replace(/"(\w+)":/g, '$1:');

function tweenIn(sel, anim, dur, at) {
  const e = EL[anim] || EL.fade;
  const to = { opacity: 1, duration: r3(dur), ease: e.ease };
  for (const k of Object.keys(e.from)) to[k] = k === 'scale' ? 1 : 0;
  return `tl.fromTo(${sel}, ${obj({ opacity: 0, ...e.from })}, ${obj(to)}, ${r3(at)});`;
}

/** Entrada del frame i (i > 0) según su transición. */
function transitionIn(i, f, prevId) {
  const id = q(`f${i + 1}`), d = r3(f.trDur), at = r3(f.start);
  const show = `tl.set(${id}, { visibility: "visible" }, ${at});`;
  switch (f.transition) {
    case 'fade': return `${show} tl.fromTo(${id}, { opacity: 0 }, { opacity: 1, duration: ${d}, ease: "none" }, ${at});`;
    case 'slide': return `${show} tl.fromTo(${id}, { xPercent: 100 }, { xPercent: 0, duration: ${d}, ease: "power2.inOut" }, ${at}); tl.to(${q(prevId)}, { xPercent: -100, duration: ${d}, ease: "power2.inOut" }, ${at});`;
    case 'zoom': return `${show} tl.fromTo(${id}, { opacity: 0, scale: 1.15 }, { opacity: 1, scale: 1, duration: ${d}, ease: "power2.out" }, ${at});`;
    case 'diagonal': return `${show} tl.fromTo(${id}, { clipPath: "polygon(0% 0%, 0% 0%, -40% 100%, 0% 100%)" }, { clipPath: "polygon(0% 0%, 140% 0%, 100% 100%, 0% 100%)", duration: ${d}, ease: "power2.inOut" }, ${at});`;
    case 'circle': return `${show} tl.fromTo(${id}, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)", duration: ${d}, ease: "power2.inOut" }, ${at});`;
    case 'mask': return `${show} tl.fromTo(${id}, { clipPath: "inset(50% 50% 50% 50%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: ${d}, ease: "power2.inOut" }, ${at});`;
    case 'blur': return `${show} tl.fromTo(${id}, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: ${d}, ease: "power1.out" }, ${at});`;
    case 'wipe':
    default: return `${show} tl.fromTo(${id}, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: ${d}, ease: "power2.inOut" }, ${at});`;
  }
}

/**
 * plan: salida de buildPlan. assets: igual que buildHtml.
 * opts: { title, clickTag, gsapSrc } (gsapSrc = URL del CDN o "gsap.min.js" si va dentro del ZIP).
 */
export function buildGsapHtml(plan, assets, { title, clickTag, gsapSrc = GSAP_CDN }) {
  const { W, H } = plan;
  const html = [], js = [];
  const n = plan.frames.length;
  plan.frames.forEach((f, i) => {
    const A = assets.frames[i];
    const fid = `f${i + 1}`;
    html.push(`    <div class="frame" id="${fid}" style="z-index:${i + 1}${i ? ';visibility:hidden' : ''}">`);
    if (A.bg) html.push(`      <img class="bg" id="bg${i + 1}" src="${A.bg.src}" alt="">`);
    if (i > 0) js.push(transitionIn(i, f, `f${i}`));
    // Efecto de foto: arranca cuando entra el frame y termina en la posición del diseño.
    if (A.bg && f.photoFx !== 'none') {
      const next = plan.frames[i + 1];
      const d = r3(f.dur + (next ? next.trDur : 0));
      const from = f.photoFx === 'kenburns' ? { scale: 1.08 } : { scale: 1.06, x: i % 2 ? -8 : 8 };
      const to = f.photoFx === 'kenburns' ? { scale: 1 } : { scale: 1, x: 0 };
      js.push(`tl.fromTo("#bg${i + 1}", ${obj(from)}, ${obj({ ...to, duration: d, ease: 'none' })}, ${r3(f.start)});`);
    }
    const emitShadow = (s) => {
      const a = A.shadows[s.id];
      if (!a) return;
      const origin = s.follows ? `;transform-origin:${r3(a.ox)}px ${r3(a.oy)}px` : '';
      html.push(`      <img class="sh" id="${a.name}" src="${a.src}" style="left:${a.x}px;top:${a.y}px${origin}" alt="">`);
      if (s.anim === 'none') js.push(`tl.set(${q(a.name)}, { opacity: 1 }, 0);`);
      else js.push(tweenIn(q(a.name), EL[s.anim] ? s.anim : 'fade', s.dur, s.start));
      return a;
    };
    for (const s of f.shadows) if (!s.follows) emitShadow(s);
    for (const it of f.items) {
      let followSh = null;
      for (const s of f.shadows) if (s.follows === it.id) followSh = emitShadow(s);
      const a = A.items[it.id];
      const spec = ANIMS[it.anim] || ANIMS.fade;
      const box = `left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px`;
      if (it.segs && spec.split) {
        // Cada letra/palabra es una ventana sobre la misma imagen.
        const k = a.w / it.raster.w;
        html.push(`      <div class="tx sp" id="${a.name}" style="${box}">`);
        it.segs.forEach(([x0, x1], j) => {
          const l = Math.round(x0 * k), w = Math.round(x1 * k) - l;
          html.push(`        <div class="seg" style="left:${l}px;width:${w}px;height:${a.h}px"><img src="${a.src}" style="left:${-l}px;top:0" alt=""></div>`);
          void j;
        });
        html.push(`      </div>`);
        js.push(`tl.set(${q(a.name)}, { opacity: 1 }, ${r3(it.start)});`);
        const segs = `"#${a.name} .seg"`;
        if (it.anim === 'typewriter') js.push(`tl.fromTo(${segs}, { opacity: 0 }, { opacity: 1, duration: 0.01, ease: "none", stagger: ${spec.stagger} }, ${r3(it.start)});`);
        else if (it.anim === 'words') js.push(`tl.fromTo(${segs}, { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: ${spec.dur}, ease: "power1.out", stagger: ${spec.stagger} }, ${r3(it.start)});`);
        else js.push(`tl.fromTo(${segs}, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: ${spec.dur}, ease: "power1.out", stagger: ${spec.stagger} }, ${r3(it.start)});`);
      } else {
        html.push(`      <img class="tx" id="${a.name}" src="${a.src}" style="left:${a.x}px;top:${a.y}px;transform-origin:${r3(a.w / 2)}px ${r3(a.h / 2)}px" alt="">`);
        if (it.anim === 'none') js.push(`tl.set(${q(a.name)}, { opacity: 1 }, 0);`);
        else js.push(tweenIn(q(a.name), it.anim, spec.dur, it.start));
      }
      // Efecto final del botón: después de que entró, termina en reposo.
      if (it.kind === 'cta' && plan.ctaFx !== 'none') {
        const t0 = r3(it.start + it.dur + 0.6);
        if (plan.ctaFx === 'pulse') {
          const targets = [q(a.name)];
          if (followSh) targets.push(q(followSh.name));
          js.push(`tl.to([${targets.join(', ')}], { scale: 1.06, duration: 0.3, ease: "sine.inOut", yoyo: true, repeat: 3 }, ${t0});`);
        } else if (plan.ctaFx === 'shine') {
          html.push(`      <div class="shine" id="${a.name}_shine" style="${box};-webkit-mask-image:url(${a.src});mask-image:url(${a.src})"></div>`);
          js.push(`tl.fromTo(${q(`${a.name}_shine`)}, { backgroundPosition: "150% 0" }, { backgroundPosition: "-50% 0", duration: 0.9, ease: "power1.inOut", repeat: 1, repeatDelay: 0.8 }, ${t0});`);
        }
      }
    }
    html.push(`    </div>`);
  });
  void n;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="ad.size" content="width=${W},height=${H}">
<title>${esc(title)}</title>
<script type="text/javascript">
  var clickTag = "${String(clickTag).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}";
</script>
<script type="text/javascript" src="${gsapSrc}"></script>
<style>
  html, body { margin: 0; padding: 0; }
  #banner { position: relative; display: block; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; cursor: pointer; }
  .frame { position: absolute; top: 0; left: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  .frame img, .frame .sp, .frame .seg, .frame .shine { position: absolute; display: block; border: 0; }
  .frame img.bg { left: 0; top: 0; width: ${W}px; height: ${H}px; }
  .seg { top: 0; overflow: hidden; }
  .tx, .sh { opacity: 0; }
  .sh { mix-blend-mode: multiply; }
  .shine { pointer-events: none; background: linear-gradient(110deg, rgba(255,255,255,0) 40%, rgba(255,255,255,.7) 50%, rgba(255,255,255,0) 60%) no-repeat; background-size: 250% 100%; background-position: 150% 0; -webkit-mask-size: 100% 100%; mask-size: 100% 100%; }
</style>
</head>
<body>
  <a id="banner" href="javascript:window.open(window.clickTag)">
${html.join('\n')}
  </a>
<script type="text/javascript">
  // Línea de tiempo GSAP. Dura ${r3(plan.total).toFixed(1)} s, sin loop, termina en el último frame.
  window.onload = function () {
    var tl = gsap.timeline();
    ${js.join('\n    ')}
  };
</script>
</body>
</html>
`;
}
