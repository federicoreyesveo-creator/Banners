// Genera el index.html del banner (CSS animations, clickTag estándar, sin loop).
import { ANIMS } from './plan.js';

const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * plan: salida de buildPlan.
 * assets: { frames: [{ bg: {src}, items: {id:{name,src,x,y,w,h}}, shadows: {id:{name,src,x,y,w,h,ox,oy}} }] }
 */
export function buildHtml(plan, assets, { title, clickTag }) {
  const { W, H, transition } = plan;
  const css = [];
  const html = [];
  css.push(`html, body { margin: 0; padding: 0; }`);
  css.push(`#banner { position: relative; display: block; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; cursor: pointer; }`);
  if (transition === 'wipe') {
    css.push(`.frame { position: absolute; top: 0; left: 0; width: 0; height: ${H}px; overflow: hidden; }`);
    css.push(`#f1 { width: ${W}px; }`);
  } else {
    css.push(`.frame { position: absolute; top: 0; left: 0; width: ${W}px; height: ${H}px; overflow: hidden; }`);
  }
  css.push(`.frame img { position: absolute; display: block; border: 0; }`);
  css.push(`.frame img.bg { left: 0; top: 0; width: ${W}px; height: ${H}px; }`);
  css.push(`.tx, .sh { opacity: 0; }`);
  css.push(`.st { opacity: 1; }`);
  css.push(`.sh { mix-blend-mode: multiply; }`);
  if (transition === 'wipe') css.push(`@keyframes wipe { from { width: 0; } to { width: ${W}px; } }`);
  else css.push(`@keyframes out { from { opacity: 1; } to { opacity: 0; } }`);
  // Entradas como la referencia de Animate: fade + desplazamiento corto / escala, quadOut, sin motion blur.
  for (const [k, a] of Object.entries(ANIMS)) {
    if (k === 'none') continue;
    css.push(`@keyframes ${k} { from { opacity: 0;${a.from ? ` transform: ${a.from};` : ''} } to { opacity: 1;${a.from ? ' transform: none;' : ''} } }`);
  }
  const anim = (sel, name, dur, ease, delay) => css.push(`.go #${sel} { animation: ${name} ${r3(dur)}s ${ease} ${r3(delay)}s both; }`);

  const n = plan.frames.length;
  plan.frames.forEach((f, i) => {
    const A = assets.frames[i];
    const fid = `f${i + 1}`;
    if (transition === 'wipe') { if (i > 0) anim(fid, 'wipe', plan.trDur, 'cubic-bezier(.65,0,.35,1)', f.start); }
    else if (i < n - 1) anim(fid, 'out', plan.trDur, 'linear', f.start + f.dur);
    const z = transition === 'wipe' ? '' : ` style="z-index:${n - i + 1}"`;
    html.push(`    <div class="frame" id="${fid}"${z}>`);
    if (A.bg) html.push(`      <img class="bg" src="${A.bg.src}" alt="">`);
    // Sombras primero (debajo de los textos), cada elemento con su propia animación.
    const shBy = new Map(f.shadows.map((s) => [s.id, s]));
    const emitShadow = (s) => {
      const a = A.shadows[s.id];
      if (!a) return;
      const spec = ANIMS[s.anim] || ANIMS.fade;
      const origin = s.follows ? `;transform-origin:${r3(a.ox)}px ${r3(a.oy)}px` : '';
      if (s.anim === 'none') { html.push(`      <img class="sh st" id="${a.name}" src="${a.src}" style="left:${a.x}px;top:${a.y}px" alt="">`); return; }
      html.push(`      <img class="sh" id="${a.name}" src="${a.src}" style="left:${a.x}px;top:${a.y}px${origin}" alt="">`);
      anim(a.name, s.anim, s.dur || spec.dur, spec.ease, s.start);
    };
    for (const s of f.shadows) if (!s.follows) emitShadow(s);
    for (const it of f.items) {
      for (const s of f.shadows) if (s.follows === it.id) emitShadow(s);
      const a = A.items[it.id];
      const spec = ANIMS[it.anim] || ANIMS.fade;
      if (it.anim === 'none') { html.push(`      <img class="tx st" id="${a.name}" src="${a.src}" style="left:${a.x}px;top:${a.y}px" alt="">`); continue; }
      html.push(`      <img class="tx" id="${a.name}" src="${a.src}" style="left:${a.x}px;top:${a.y}px;transform-origin:${r3(a.w / 2)}px ${r3(a.h / 2)}px" alt="">`);
      anim(a.name, it.anim, it.dur || spec.dur, spec.ease, it.start);
    }
    html.push(`    </div>`);
    void shBy;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="ad.size" content="width=${W},height=${H}">
<title>${esc(title)}</title>
<script type="text/javascript">
  var clickTag = "${String(clickTag).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}";
</script>
<style>
  ${css.join('\n  ')}
</style>
</head>
<body>
  <a id="banner" href="javascript:window.open(window.clickTag)">
${html.join('\n')}
  </a>
<script type="text/javascript">
  // Arranca cuando cargan las imagenes. Dura ${r3(plan.total).toFixed(1)} s, sin loop, termina en el ultimo frame.
  window.onload = function () { document.getElementById("banner").className = "go"; };
</script>
</body>
</html>
`;
}
