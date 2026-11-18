// Interfaz: carga, editor visual, vista previa y exportación.
import { ANIMS, TRANSITIONS, PHOTO_FX, CTA_FX, needsGsap, PRESET_SIZES, parseSize, defaultDurations, defaultAnims, identityLayout, autoLayout, buildPlan } from './core/plan.js';
import { buildShadow } from './core/raster.js';
import { interpretPrompt } from './core/prompt.js';
import { ingest } from './browser/ingest.js';
import { rasterToCanvas, newCanvas } from './browser/canvas.js';
import { exportSize, previewHtml, renderFrameParts, composeFinal } from './browser/export.js';
import { demoSources } from './browser/demo.js';
import { bgAt, hasOriginal } from './browser/hires.js';

const $ = (id) => document.getElementById(id);
const S = {
  sources: null, master: null, project: null,
  sizes: [], cur: null, frame: 0, sel: null,
  outputs: {}, history: [], previewUrls: [],
};

// ---------- utilidades de UI ----------
const status = (t) => { $('status').textContent = t || ''; };
function busy(on, text) { $('busy').hidden = !on; if (text) $('busyText').textContent = text; }
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const slug = (s) => (s || 'banner').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'banner';
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- proyecto ----------
function buildProject(sources) {
  const sizesList = Object.keys(sources.sizes);
  const master = sizesList.reduce((a, b) => (sources.sizes[b].length > sources.sizes[a].length ? b : a));
  const mframes = sources.sizes[master];
  const durs = defaultDurations(mframes.length);
  const frames = mframes.map((mf, i) => {
    const pf = { id: mf.id, name: mf.name, duration: durs[i], sources: { [master]: mf }, anims: {} };
    for (const s of sizesList) {
      if (s !== master && sources.sizes[s].length === mframes.length) pf.sources[s] = sources.sizes[s][i];
    }
    for (const f of Object.values(pf.sources)) Object.assign(pf.anims, defaultAnims(f, i));
    return pf;
  });
  return { master, frames, linked: sources.linked || null, transition: currentTransition(), photoFx: $('photoFx').value, ctaFx: $('ctaFx').value, layouts: {} };
}

function ensureLayout(size) {
  const P = S.project;
  if (P.layouts[size]) return;
  const { w, h } = parseSize(size);
  P.layouts[size] = {};
  for (const pf of P.frames) P.layouts[size][pf.id] = freshLayout(pf, size, w, h);
}
function freshLayout(pf, size, w, h) {
  const own = pf.sources[size];
  return own ? identityLayout(own) : autoLayout(pf.sources[S.project.master], w, h);
}
const curPF = () => S.project.frames[S.frame];
const curSrc = () => curPF().sources[S.cur] || curPF().sources[S.project.master];
const curLay = () => S.project.layouts[S.cur][curPF().id];

function pushHistory() {
  S.history.push(JSON.stringify({ layouts: S.project.layouts, frames: S.project.frames.map((f) => ({ d: f.duration, a: f.anims })) }));
  if (S.history.length > 80) S.history.shift();
}
function undo() {
  const h = S.history.pop();
  if (!h) return;
  const o = JSON.parse(h);
  S.project.layouts = o.layouts;
  S.project.frames.forEach((f, i) => { f.duration = o.frames[i].d; f.anims = o.frames[i].a; });
  renderAll();
}

// ---------- carga ----------
async function handleFiles(files) {
  if (!files || !files.length) return;
  busy(true, 'Leyendo archivos…');
  try {
    const res = await ingest(files, (t) => busy(true, t));
    loadSources(res);
    $('ingestInfo').textContent = '';
    if (res.notes.length) status(res.notes.join(' '));
    if ($('campaign').value === 'Banner' && files[0]) $('campaign').value = files[0].name.replace(/\.(zip|psd|png|jpe?g)$/i, '');
  } catch (e) {
    console.error(e);
    $('ingestInfo').textContent = `No pude leer el archivo: ${e.message}`;
  } finally { busy(false); }
}

function loadSources(res) {
  S.sources = res;
  S.project = buildProject(res);
  S.sizes = Object.keys(res.sizes);
  S.cur = S.project.master;
  S.frame = 0; S.sel = null; S.history = []; S.outputs = {};
  S.sizes.forEach(ensureLayout);
  $('btnGenerate').disabled = false;
  $('empty').hidden = true; $('stage').hidden = false;
  document.body.classList.remove('noproject');
  viewZoom = 'auto';
  renderAll();
  refreshPreview();
}

// ---------- tamaños ----------
function renderSizes() {
  const all = [...new Set([...PRESET_SIZES, ...S.sizes, ...(S.sources ? Object.keys(S.sources.sizes) : [])])];
  const box = $('sizes'); box.innerHTML = '';
  for (const s of all) {
    const b = document.createElement('button');
    b.className = 'chip' + (S.sizes.includes(s) ? ' on' : '');
    b.innerHTML = s + (S.sources && S.sources.sizes[s] ? '<span class="src">· PSD</span>' : '');
    b.title = S.sources && S.sources.sizes[s] ? 'Este tamaño viene armado en tu archivo' : 'Se adapta automáticamente desde el tamaño maestro';
    b.onclick = () => toggleSize(s);
    box.appendChild(b);
  }
}
function toggleSize(s, force) {
  const on = force ?? !S.sizes.includes(s);
  if (on && !S.sizes.includes(s)) { S.sizes.push(s); if (S.project) ensureLayout(s); if (S.project) S.cur = s; }
  if (!on) { S.sizes = S.sizes.filter((x) => x !== s); if (S.cur === s) S.cur = S.sizes[0] || null; }
  renderAll();
  if (on) refreshPreview();
}

// ---------- render general ----------
function renderAll() {
  renderSizes();
  if (!S.project) return;
  if (!S.cur || !S.sizes.includes(S.cur)) S.cur = S.sizes[0];
  if (!S.cur) return;
  ensureLayout(S.cur);
  renderTabs(); renderStage(); renderInspector(); scheduleThumbs(); renderPills();
}

// Textos de las pastillas de arriba.
function renderPills() {
  const n = S.sizes.length;
  $('pillSizes').textContent = n ? `${S.sizes[0]}${n > 1 ? ` +${n - 1}` : ''}` : '—';
  $('pillAnim').textContent = TRANSITIONS[currentTransition()].label;
  const u = $('clickTag').value.trim().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  $('pillClick').textContent = u || 'sin URL';
  $('pillWeight').textContent = `${parseInt($('maxKB').value, 10) || 228} KB`;
}

function renderTabs() {
  const box = $('sizeTabs'); box.innerHTML = '';
  for (const s of S.sizes) {
    const b = document.createElement('button');
    b.textContent = s; b.className = s === S.cur ? 'on' : '';
    b.onclick = () => { S.cur = s; S.sel = null; renderAll(); refreshPreview(); };
    box.appendChild(b);
  }
  const total = S.project.frames.reduce((a, f) => a + f.duration, 0);
  $('frameLabel').textContent = `Frame ${S.frame + 1} / ${S.project.frames.length}`;
  $('totalInfo').textContent = `${total.toFixed(1).replace('.', ',')} s · sin loop`;
}

let thumbTimer = 0;
function scheduleThumbs() { clearTimeout(thumbTimer); thumbTimer = setTimeout(renderThumbs, 250); }
function renderThumbs() {
  if (!S.project || !S.cur) return;
  const plan = buildPlan(S.project, S.cur);
  const parts = renderFrameParts(plan);
  const box = $('strip'); box.innerHTML = '';
  plan.frames.forEach((f, i) => {
    const d = document.createElement('button');
    d.className = 'thumb' + (i === S.frame ? ' on' : '');
    const c = composeFinal(plan, parts, i);
    const k = Math.min(96 / plan.W, 52 / plan.H);
    const t = newCanvas(plan.W * k, plan.H * k);
    const ctx = t.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, 0, 0, t.width, t.height);
    d.appendChild(t);
    d.append(`${i + 1} · ${f.dur.toFixed(1).replace('.', ',')} s`);
    d.title = `Frame ${i + 1}`;
    d.onclick = () => { S.frame = i; S.sel = null; renderAll(); };
    box.appendChild(d);
  });
}

// ---------- editor ----------
let zoom = 1;
// Zoom de la vista (no cambia el banner). Arranca en 100 % = tamaño real; null = ajustar a la ventana.
let viewZoom = 'auto'; // 'auto' = tamaño real si entra, si no lo achica; null = ajustar
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
function fitZoom(W, H) {
  const wrap = $('stageWrap');
  return Math.max(0.1, Math.min(4, (wrap.clientWidth - 56) / W, (wrap.clientHeight - 56) / H));
}
function setViewZoom(z) { viewZoom = z; if (S.project) renderStage(); }
function stepZoom(dir) {
  const cur = zoom;
  const next = dir > 0 ? ZOOMS.find((z) => z > cur + 1e-3) : [...ZOOMS].reverse().find((z) => z < cur - 1e-3);
  setViewZoom(next ?? cur);
}
function renderStage() {
  const { w: W, h: H } = parseSize(S.cur);
  const wrap = $('stageWrap');
  const availW = wrap.clientWidth - 80, availH = wrap.clientHeight - 80;
  void availW; void availH;
  zoom = viewZoom == null ? fitZoom(W, H) : viewZoom === 'auto' ? Math.min(1, fitZoom(W, H)) : viewZoom;
  $('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
  const stage = $('stage');
  stage.style.width = `${W * zoom}px`; stage.style.height = `${H * zoom}px`;
  const world = $('world');
  world.style.width = `${W}px`; world.style.height = `${H}px`;
  world.style.transform = `scale(${zoom})`;
  world.innerHTML = '';
  const src = curSrc(), lay = curLay();
  if (src.bg && lay.bg) {
    // En el editor la foto también sale del original en alta, a la resolución de la pantalla.
    const hi = bgAt(src.bg, lay.bg.s * zoom * (window.devicePixelRatio || 1), S.project.linked, { round: true });
    const c = cloneCanvas(hi || rasterToCanvas(src.bg.raster));
    c.className = 'bgc'; c.dataset.id = 'bg';
    placeEl(c, lay.bg.x, lay.bg.y, src.bg.raster.w * lay.bg.s, src.bg.raster.h * lay.bg.s);
    world.appendChild(c);
  }
  const sh = document.createElement('canvas'); sh.id = 'shadowLayer'; sh.style.pointerEvents = 'none';
  world.appendChild(sh);
  for (const e of src.elements) {
    const L = lay.el[e.id]; if (!L || L.hidden) continue;
    const c = cloneCanvas(rasterToCanvas(e.raster));
    c.className = 'el'; c.dataset.id = e.id;
    placeEl(c, L.x, L.y, e.raster.w * L.s, e.raster.h * L.s);
    world.appendChild(c);
  }
  updateShadow(); updateSelBox();
}
function cloneCanvas(src) { const c = newCanvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }
function placeEl(el, x, y, w, h) { el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.width = `${w}px`; el.style.height = `${h}px`; }

let shRaf = 0;
function updateShadow() {
  cancelAnimationFrame(shRaf);
  shRaf = requestAnimationFrame(() => {
    const c = $('shadowLayer'); if (!c) return;
    const { w: W, h: H } = parseSize(S.cur);
    const plan = buildPlan(S.project, S.cur);
    const f = plan.frames[S.frame];
    c.width = W; c.height = H; placeEl(c, 0, 0, W, H);
    const ctx = c.getContext('2d');
    for (const s of f.shadows) {
      const items = s.items.map((it) => ({ raster: it.raster, x: Math.round(it.x), y: Math.round(it.y), scale: it.s }));
      const avg = s.items.reduce((a, it) => a + it.s, 0) / s.items.length;
      const r = buildShadow(items, s.params, W, H, avg);
      if (r) ctx.drawImage(rasterToCanvas(r.raster), r.x, r.y);
    }
    c.style.mixBlendMode = 'multiply';
  });
}

function selGeom() {
  const src = curSrc(), lay = curLay();
  if (S.sel === 'bg' && src.bg && lay.bg) return { x: lay.bg.x, y: lay.bg.y, w: src.bg.raster.w * lay.bg.s, h: src.bg.raster.h * lay.bg.s, L: lay.bg, base: src.bg.raster };
  const e = src.elements.find((x) => x.id === S.sel);
  if (!e || !lay.el[e.id]) return null;
  const L = lay.el[e.id];
  return { x: L.x, y: L.y, w: e.raster.w * L.s, h: e.raster.h * L.s, L, base: e.raster };
}
function updateSelBox() {
  const g = S.sel && selGeom();
  const b = $('selbox');
  if (!g) { b.hidden = true; $('selPanel').hidden = true; return; }
  b.hidden = false;
  placeEl(b, g.x * zoom, g.y * zoom, g.w * zoom, g.h * zoom);
  $('selPanel').hidden = false;
  $('selTitle').textContent = S.sel === 'bg' ? 'Foto (recorte)' : (curSrc().elements.find((e) => e.id === S.sel)?.name || 'Selección');
  $('selScale').value = g.L.s; $('selX').value = Math.round(g.L.x); $('selY').value = Math.round(g.L.y); $('selS').value = Math.round(g.L.s * 100);
  $('btnCover').hidden = S.sel !== 'bg';
  for (const el of document.querySelectorAll('.layer')) el.classList.toggle('on', el.dataset.id === S.sel);
}

function moveSel(dx, dy) {
  const g = selGeom(); if (!g) return;
  g.L.x = Math.round(g.L.x + dx); g.L.y = Math.round(g.L.y + dy);
  syncSelected();
}
function scaleSel(newS, anchor) {
  const g = selGeom(); if (!g) return;
  newS = Math.max(0.05, Math.min(6, newS));
  const ax = anchor ? anchor.x : g.x + g.w / 2, ay = anchor ? anchor.y : g.y + g.h / 2;
  const k = newS / g.L.s;
  g.L.x = Math.round(ax - (ax - g.L.x) * k); g.L.y = Math.round(ay - (ay - g.L.y) * k);
  g.L.s = Math.round(newS * 1000) / 1000;
  syncSelected();
}
function syncSelected() {
  const g = selGeom(); if (!g) return;
  const el = $('world').querySelector(`[data-id="${CSS.escape(S.sel)}"]`);
  if (el) placeEl(el, g.L.x, g.L.y, g.base.w * g.L.s, g.base.h * g.L.s);
  updateSelBox(); updateShadow(); scheduleThumbs();
}

function setupStage() {
  const stage = $('stage');
  let drag = null;
  stage.addEventListener('pointerdown', (ev) => {
    if (!S.project) return;
    const t = ev.target;
    if (t.id === 'handle') {
      const g = selGeom(); if (!g) return;
      pushHistory();
      drag = { mode: 'scale', x0: ev.clientX, s0: g.L.s, w0: g.w, anchor: { x: g.x, y: g.y } };
    } else {
      const id = t.dataset && t.dataset.id;
      // Si la foto está seleccionada, arrastrar en cualquier lado mueve el recorte.
      if (S.sel === 'bg' && (!id || id === 'bg')) { /* keep bg */ }
      else if (id) { if (S.sel !== id) { S.sel = id; renderInspector(); } }
      else { S.sel = null; updateSelBox(); return; }
      pushHistory();
      const g0 = selGeom();
      drag = { mode: 'move', x: ev.clientX, y: ev.clientY, sx: g0 ? g0.L.x : 0, sy: g0 ? g0.L.y : 0 };
    }
    stage.setPointerCapture(ev.pointerId);
    updateSelBox();
    ev.preventDefault();
  });
  stage.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (drag.mode === 'move') {
      const g = selGeom(); if (!g) return;
      let nx = drag.sx + (ev.clientX - drag.x) / zoom, ny = drag.sy + (ev.clientY - drag.y) / zoom;
      // Imán al centro del banner (Alt lo desactiva). Umbral de 6 px en pantalla.
      const { w: W, h: H } = parseSize(S.cur);
      const th = 6 / zoom;
      let snapV = false, snapH = false;
      if (!ev.altKey) {
        if (Math.abs(nx + g.w / 2 - W / 2) < th) { nx = W / 2 - g.w / 2; snapV = true; }
        if (Math.abs(ny + g.h / 2 - H / 2) < th) { ny = H / 2 - g.h / 2; snapH = true; }
      }
      showGuides(snapV, snapH);
      const rx = Math.round(nx), ry = Math.round(ny);
      if (rx !== g.L.x || ry !== g.L.y) { g.L.x = rx; g.L.y = ry; syncSelected(); }
    } else {
      const dw = (ev.clientX - drag.x0) / zoom;
      scaleSel(drag.s0 * (drag.w0 + dw) / drag.w0, drag.anchor);
    }
  });
  const end = () => { showGuides(false, false); if (drag) { drag = null; refreshPreviewSoon(); } };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  $('stageWrap').addEventListener('wheel', (ev) => {
    if (!S.sel || !S.project) return;
    ev.preventDefault();
    const g = selGeom(); if (!g) return;
    if (!wheelTimer) pushHistory();
    clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { wheelTimer = 0; refreshPreviewSoon(); }, 400);
    const rect = $('stage').getBoundingClientRect();
    const anchor = { x: (ev.clientX - rect.left) / zoom, y: (ev.clientY - rect.top) / zoom };
    scaleSel(g.L.s * Math.exp(-ev.deltaY * 0.0015), anchor);
  }, { passive: false });
  window.addEventListener('keydown', (ev) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (document.activeElement?.closest?.('.split')) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
    if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); stepZoom(1); return; }
    if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); stepZoom(-1); return; }
    if (ev.key === '0') { ev.preventDefault(); setViewZoom(1); return; }
    if (!S.sel) return;
    const step = ev.shiftKey ? 10 : 1;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[ev.key]) { ev.preventDefault(); pushHistory(); moveSel(...map[ev.key]); refreshPreviewSoon(); }
    if (ev.key === 'Escape') { S.sel = null; updateSelBox(); }
  });
  window.addEventListener('resize', () => { if (S.project) { renderStage(); fitPreview(); } });
}
let wheelTimer = 0;
function showGuides(v, h) {
  const { w: W, h: H } = parseSize(S.cur);
  const gv = $('guideV'), gh = $('guideH');
  gv.hidden = !v; gh.hidden = !h;
  // La línea cae exactamente en el centro del banner, a la escala del editor.
  gv.style.left = `${(W / 2) * zoom}px`; gh.style.top = `${(H / 2) * zoom}px`;
}

// Íconos por tipo de capa (trazo de 1.5, como el resto de la interfaz).
const KIND = {
  bg: { label: 'Foto', svg: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><circle cx="6" cy="6.75" r="1.1"/><path d="m2.75 11.5 3.25-3 2.25 2 2-1.75 3 2.75"/>' },
  text: { label: 'Texto', svg: '<path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5"/>' },
  logo: { label: 'Logo', svg: '<path d="M8 2.5 9.6 6l3.9.4-2.9 2.6.8 3.8L8 10.9l-3.4 1.9.8-3.8L2.5 6.4 6.4 6z"/>' },
  cta: { label: 'Botón', svg: '<rect x="2" y="4.5" width="12" height="6" rx="3"/><path d="M7.5 9.5 9 14l.9-1.6 1.7-.3z"/>' },
};
const kindIcon = (k) => { const v = KIND[k] || KIND.text; return `<span class="ki" title="${v.label}" aria-label="${v.label}" role="img"><svg viewBox="0 0 16 16" aria-hidden="true">${v.svg}</svg></span>`; };

// ---------- inspector ----------
function renderInspector() {
  const pf = curPF(), src = curSrc(), lay = curLay();
  $('duration').value = pf.duration;
  $('frameTransition').value = pf.transition || ''; $('frameTransition').disabled = S.frame === 0;
  $('framePhotoFx').value = pf.photoFx || '';
  renderEngine();
  const box = $('layers'); box.innerHTML = '';
  if (src.bg) {
    const d = document.createElement('div');
    d.className = 'layer' + (S.sel === 'bg' ? ' on' : ''); d.dataset.id = 'bg';
    d.innerHTML = `<div class="name">${kindIcon('bg')}<em>Fondo</em></div>`;
    d.onclick = () => selectLayer('bg');
    box.appendChild(d);
  }
  for (const e of src.elements) {
    const L = lay.el[e.id] || (lay.el[e.id] = { x: e.x, y: e.y, s: 1 });
    const a = pf.anims[e.id] || (pf.anims[e.id] = { anim: 'fade', delay: 0 });
    const d = document.createElement('div');
    d.className = 'layer' + (S.sel === e.id ? ' on' : '') + (L.hidden ? ' off' : ''); d.dataset.id = e.id;
    const nm = shortName(e.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    d.innerHTML = `<div class="name">${kindIcon(e.kind)}<em title="${nm}">${nm}</em><input type="checkbox" ${L.hidden ? '' : 'checked'} aria-label="Visible: ${nm}"></div>` +
      (S.sel === e.id ? `<select aria-label="Animación de entrada">${Object.entries(ANIMS).map(([k, v]) => `<option value="${k}" ${k === a.anim ? 'selected' : ''}>${v.label}</option>`).join('')}</select>` : '');
    d.onclick = (ev) => { if (ev.target.closest('select,input')) return; selectLayer(e.id); };
    const chk = d.querySelector('input[type=checkbox]'), sel = d.querySelector('select');
    chk.onchange = () => { pushHistory(); L.hidden = !chk.checked; renderStage(); renderInspector(); scheduleThumbs(); refreshPreviewSoon(); };
    if (sel) sel.onchange = () => { pushHistory(); a.anim = sel.value; delete a.dur; renderEngine(); refreshPreviewSoon(); };
    box.appendChild(d);
  }
  if (!src.elements.length) {
    const p = document.createElement('p'); p.className = 'none';
    p.textContent = 'Imagen aplanada, sin capas.';
    box.appendChild(p);
  }
  updateSelBox();
}

function setupInspector() {
  $('duration').onchange = () => { pushHistory(); curPF().duration = Math.max(0.5, parseFloat($('duration').value) || 2); renderTabs(); scheduleThumbs(); refreshPreviewSoon(); };
  $('selScale').oninput = () => scaleSel(parseFloat($('selScale').value));
  $('selScale').onpointerdown = () => pushHistory();
  $('selScale').onchange = () => refreshPreviewSoon();
  const num = (fn) => () => { pushHistory(); fn(); refreshPreviewSoon(); };
  $('selX').onchange = num(() => { const g = selGeom(); if (g) moveSel(parseInt($('selX').value, 10) - g.L.x, 0); });
  $('selY').onchange = num(() => { const g = selGeom(); if (g) moveSel(0, parseInt($('selY').value, 10) - g.L.y); });
  $('selS').onchange = num(() => scaleSel((parseFloat($('selS').value) || 100) / 100));
  $('btnCover').onclick = num(() => {
    const { w: W, h: H } = parseSize(S.cur);
    const src = curSrc(), L = curLay().bg; if (!src.bg || !L) return;
    const s = Math.max(W / src.bg.raster.w, H / src.bg.raster.h);
    L.s = Math.round(s * 1000) / 1000; L.x = Math.round((W - src.bg.raster.w * s) / 2); L.y = Math.round((H - src.bg.raster.h * s) / 2);
    renderStage(); scheduleThumbs();
  });
  $('btnResetFrame').onclick = () => {
    if (!S.project) return;
    pushHistory();
    const { w, h } = parseSize(S.cur);
    S.project.layouts[S.cur][curPF().id] = freshLayout(curPF(), S.cur, w, h);
    renderAll(); refreshPreviewSoon();
  };
  $('btnUndo').onclick = undo;
  $('zoomOut').onclick = () => stepZoom(-1);
  $('zoomIn').onclick = () => stepZoom(1);
  $('zoomLabel').onclick = () => setViewZoom(1);
  $('zoomFit').onclick = () => setViewZoom(null);
}

// ---------- vista previa ----------
let prevTimer = 0;
function refreshPreviewSoon() { clearTimeout(prevTimer); prevTimer = setTimeout(refreshPreview, 500); }
async function refreshPreview() {
  if (!S.project || !S.cur) return;
  const { html, urls, plan } = await previewHtml(S.project, S.cur, { title: $('campaign').value, clickTag: $('clickTag').value || 'https://' });
  S.previewUrls.forEach((u) => URL.revokeObjectURL(u)); S.previewUrls = urls;
  const f = $('preview');
  pvSize = { W: plan.W, H: plan.H };
  f.style.width = `${plan.W}px`; f.style.height = `${plan.H}px`;
  fitPreview();
  f.srcdoc = html;
}
// Vista previa a tamaño real; si el panel es más chico, se achica para que entre entera.
let pvSize = null;
function fitPreview() {
  if (!pvSize) return;
  const box = $('previewBox');
  const k = Math.min(1, (box.clientWidth - 56) / pvSize.W, (box.clientHeight - 56) / pvSize.H);
  $('preview').style.transform = `scale(${k})`;
  $('pv').style.width = `${pvSize.W * k}px`; $('pv').style.height = `${pvSize.H * k}px`;
}

// ---------- descargas ----------
// Dentro de un Artifact de claude.ai las descargas pasan por la capacidad "downloads"; afuera, links normales.
let dl = null;
if (window.claude && window.claude.use) window.claude.use('downloads').then((d) => { dl = d; }).catch(() => {});
function downloadLink(blob, filename, label) {
  const a = document.createElement('a');
  a.textContent = label;
  if (window.claude && window.claude.use) {
    a.href = '#';
    a.onclick = async (ev) => {
      ev.preventDefault();
      if (!dl) { status('Este visor no permite descargar archivos.'); return; }
      try { await dl.save({ filename, data: blob }); } catch (e) { status(`No se descargó: ${e.code || e.message || e}`); }
    };
  } else { a.href = URL.createObjectURL(blob); a.download = filename; }
  return a;
}

// ---------- exportación ----------
async function generateAll() {
  if (!S.project) return;
  busy(true, 'Generando…');
  const outBox = $('outputs'); outBox.innerHTML = '';
  $('btnOutputs').hidden = true;
  const title = $('campaign').value, base = slug(title);
  const clickTag = $('clickTag').value.trim() || 'https://';
  const maxKB = parseInt($('maxKB').value, 10) || 228;
  const results = [];
  try {
    for (const size of S.sizes) {
      ensureLayout(size);
      const r = await exportSize(S.project, size, { title: `${title} ${size}`, clickTag, maxKB, embedGsap: $('embedGsap').checked, onProgress: (t) => busy(true, t) });
      results.push(r);
      const zipName = `${base}_${size}_HTML5.zip`, gifName = `${base}_${size}_backup.gif`;
      const zu = URL.createObjectURL(r.zip), gu = URL.createObjectURL(r.gif);
      const d = document.createElement('div'); d.className = 'out';
      d.innerHTML = `<div class="head"><span>${size}</span><span class="${r.fits ? 'ok' : 'bad'}">${kb(r.zip.size)}${r.fits ? '' : ` · pasa de ${maxKB} KB`}</span></div>
        <div class="dl"></div>
        <div class="hint">${r.plan.gsap ? 'GSAP' : 'CSS'} · ${r.plan.frames.length} frames · ${r.plan.total.toFixed(1).replace('.', ',')} s</div>
        <img src="${gu}" alt="GIF ${size}">`;
      d.querySelector('.dl').append(downloadLink(r.zip, zipName, 'ZIP HTML5'), downloadLink(r.gif, gifName, `GIF (${kb(r.gif.size)})`));
      outBox.appendChild(d);
      void zu;
      r.zipName = zipName; r.gifName = gifName;
    }
    if (results.length > 1) {
      const all = new window.JSZip();
      for (const r of results) { all.file(r.zipName, r.zip); all.file(r.gifName, r.gif); }
      const blob = await all.generateAsync({ type: 'blob' });
      const a = downloadLink(blob, `${base}_entregables.zip`, `Descargar todo (${kb(blob.size)})`);
      const p = document.createElement('p'); p.appendChild(a); outBox.prepend(p);
    }
    status('');
    const bad = results.filter((r) => !r.fits).length;
    $('btnOutputs').hidden = false;
    $('btnOutputs').textContent = bad ? `Entregables · ${bad} pasado${bad > 1 ? 's' : ''} de peso` : `Entregables (${results.length})`;
    openPop('popOutputs', $('btnOutputs'));
  } catch (e) {
    console.error(e);
    outBox.innerHTML = `<p class="hint">Error al generar: ${e.message}</p>`;
  } finally { busy(false); }
  window.__lastResults = results; // para pruebas automáticas
}

// ---------- panel izquierdo ----------
function currentTransition() { return $('transition').value || 'wipe'; }
function fillSelect(sel, map, extra) {
  sel.innerHTML = (extra ? `<option value="">${extra}</option>` : '') + Object.entries(map).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
}
function renderEngine() {
  const g = S.project ? needsGsap(S.project) : false;
  $('engineInfo').innerHTML = g ? 'Usa <b>GSAP</b> por los efectos elegidos.' : 'Usa <b>CSS</b>: 0 KB extra.';
}
function setTransition(v) {
  $('transition').value = v;
  if (S.project) { S.project.transition = v; renderTabs(); renderEngine(); refreshPreviewSoon(); }
  renderPills();
}

function applyPrompt() {
  const { changes, notes } = interpretPrompt($('prompt').value);
  if (changes.clickTag) $('clickTag').value = changes.clickTag;
  if (changes.transition) setTransition(changes.transition);
  if (changes.maxKB) $('maxKB').value = changes.maxKB;
  if (changes.sizes) changes.sizes.forEach((s) => toggleSize(s, true));
  if (changes.totalSeconds && S.project) {
    pushHistory();
    const tot = S.project.frames.reduce((a, f) => a + f.duration, 0);
    const k = changes.totalSeconds / tot;
    S.project.frames.forEach((f) => { f.duration = Math.round(f.duration * k * 10) / 10; });
    renderAll();
  }
  $('promptInfo').textContent = notes.length ? `Hecho: ${notes.join(' · ')}.` : 'Por ahora entiendo URL, transición, segundos, peso y tamaños.';
  renderPills();
  refreshPreviewSoon();
}

// ---------- selección ----------
function selectLayer(id) {
  const changed = S.sel !== id;
  S.sel = id;
  if (changed) renderInspector(); else updateSelBox();
}

// "Texto largo · 2" → "2 · Texto largo", para que el número del renglón no quede cortado.
function shortName(n) { const m = n.match(/^(.*) · (\d+)$/); return m ? `${m[2]} · ${m[1]}` : n; }

// ---------- popovers de la barra ----------
function openPop(id, anchor) {
  const p = $(id);
  if (!p.matches(':popover-open')) p.showPopover();
  placePop(p, anchor);
}
function placePop(p, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = p.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  p.style.left = `${left}px`; p.style.top = `${r.bottom + 6}px`;
}
function setupPopovers() {
  for (const btn of document.querySelectorAll('[popovertarget]')) {
    const p = $(btn.getAttribute('popovertarget'));
    p.addEventListener('toggle', (e) => { if (e.newState === 'open') { placePop(p, btn); p.querySelector('button, input:not([type=checkbox]), select, textarea')?.focus(); } btn.classList.toggle('on', e.newState === 'open'); });
  }
}

// ---------- paneles redimensionables ----------
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }
function setupSplits() {
  const panes = $('panes'), root = document.documentElement;
  const applyV = (px) => { panes.style.setProperty('--edW', `${Math.round(px)}px`); };
  const v0 = parseFloat(store('bn.edW'));
  if (v0) applyV(v0);
  const after = () => { if (S.project) { renderStage(); fitPreview(); } };
  const limitsV = () => { const total = $('editorPane').offsetWidth + $('previewPane').offsetWidth; return [220, total - 220]; };
  const drag = (el, axis, get, apply, limits, key) => {
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); el.setPointerCapture(ev.pointerId); el.classList.add('on');
      const start = axis === 'x' ? ev.clientX : ev.clientY, s0 = get();
      const move = (e) => { const [lo, hi] = limits(); const d = (axis === 'x' ? e.clientX : e.clientY) - start; apply(Math.max(lo, Math.min(hi, axis === 'x' ? s0 + d : s0 - d))); after(); };
      const up = () => { el.classList.remove('on'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); store(key, String(get())); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    });
    el.addEventListener('keydown', (ev) => {
      const k = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[ev.key]; if (!k) return;
      ev.preventDefault(); const [lo, hi] = limits(); const step = ev.shiftKey ? 80 : 20;
      apply(Math.max(lo, Math.min(hi, get() + (axis === 'x' ? k : -k) * step))); after(); store(key, String(get()));
    });
    el.addEventListener('dblclick', () => { if (axis === 'x') panes.style.removeProperty('--edW'); else root.style.removeProperty('--dockH'); try { localStorage.removeItem(key); } catch (e) { /* sin almacenamiento */ } after(); });
  };
  // Divisor entre editor y vista previa: horizontal o vertical según la vista elegida.
  const stacked = () => panes.classList.contains('stacked');
  const sv = $('splitV');
  const axisNow = () => (stacked() ? 'y' : 'x');
  const getSize = () => (stacked() ? $('editorPane').offsetHeight : $('editorPane').offsetWidth);
  const applySize = (px) => panes.style.setProperty(stacked() ? '--edH' : '--edW', `${Math.round(px)}px`);
  const limitsSize = () => { const t = stacked() ? $('editorPane').offsetHeight + $('previewPane').offsetHeight : $('editorPane').offsetWidth + $('previewPane').offsetWidth; return [stacked() ? 140 : 220, t - (stacked() ? 140 : 220)]; };
  sv.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); sv.setPointerCapture(ev.pointerId); sv.classList.add('on');
    const ax = axisNow(), start = ax === 'x' ? ev.clientX : ev.clientY, s0 = getSize();
    const move = (e) => { const [lo, hi] = limitsSize(); applySize(Math.max(lo, Math.min(hi, s0 + (ax === 'x' ? e.clientX : e.clientY) - start))); after(); };
    const up = () => { sv.classList.remove('on'); sv.removeEventListener('pointermove', move); sv.removeEventListener('pointerup', up); store(stacked() ? 'bn.edH' : 'bn.edW', String(getSize())); };
    sv.addEventListener('pointermove', move); sv.addEventListener('pointerup', up);
  });
  sv.addEventListener('keydown', (ev) => {
    const k = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[ev.key]; if (!k) return;
    ev.preventDefault(); const [lo, hi] = limitsSize();
    applySize(Math.max(lo, Math.min(hi, getSize() + k * (ev.shiftKey ? 80 : 20)))); after(); store(stacked() ? 'bn.edH' : 'bn.edW', String(getSize()));
  });
  sv.addEventListener('dblclick', () => { panes.style.removeProperty(stacked() ? '--edH' : '--edW'); after(); });
  const h0 = parseFloat(store('bn.edH')); if (h0) panes.style.setProperty('--edH', `${h0}px`);
  // Vista: lado a lado o arriba y abajo (se recuerda).
  const setView = (v) => {
    panes.classList.toggle('stacked', v === 'stack');
    sv.setAttribute('aria-orientation', v === 'stack' ? 'horizontal' : 'vertical');
    $('viewSide').classList.toggle('on', v !== 'stack'); $('viewStack').classList.toggle('on', v === 'stack');
    $('viewSide').setAttribute('aria-pressed', String(v !== 'stack')); $('viewStack').setAttribute('aria-pressed', String(v === 'stack'));
    store('bn.view', v); requestAnimationFrame(after);
  };
  $('viewSide').onclick = () => setView('side');
  $('viewStack').onclick = () => setView('stack');
  if (store('bn.view') === 'stack') setView('stack');
}

function setup() {
  // Tema oscuro por defecto.
  document.documentElement.dataset.theme = 'dark';
  // Se suelta el archivo en cualquier lado de la pantalla (el editor vacío es la zona marcada).
  $('file').onchange = (e) => handleFiles([...e.target.files]);
  const work = $('work');
  let dragDepth = 0;
  document.body.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; work.classList.add('over'); });
  document.body.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; work.classList.remove('over'); } });
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; work.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
  fillSelect($('transition'), TRANSITIONS); fillSelect($('photoFx'), PHOTO_FX); fillSelect($('ctaFx'), CTA_FX);
  fillSelect($('frameTransition'), TRANSITIONS, 'Igual que el resto'); fillSelect($('framePhotoFx'), PHOTO_FX, 'Igual que el resto');
  $('transition').onchange = () => setTransition($('transition').value);
  $('photoFx').onchange = () => { if (S.project) { S.project.photoFx = $('photoFx').value; renderEngine(); refreshPreviewSoon(); } };
  $('ctaFx').onchange = () => { if (S.project) { S.project.ctaFx = $('ctaFx').value; renderEngine(); refreshPreviewSoon(); } };
  $('frameTransition').onchange = () => { if (!S.project) return; pushHistory(); curPF().transition = $('frameTransition').value || null; renderEngine(); refreshPreviewSoon(); };
  $('framePhotoFx').onchange = () => { if (!S.project) return; pushHistory(); curPF().photoFx = $('framePhotoFx').value || null; renderEngine(); refreshPreviewSoon(); };
  renderEngine();
  $('addSize').onclick = () => {
    const m = $('customSize').value.match(/(\d{2,4})\s*[x×]\s*(\d{2,4})/);
    if (m) { toggleSize(`${m[1]}x${m[2]}`, true); $('customSize').value = ''; }
  };
  $('btnPrompt').onclick = applyPrompt;
  $('btnGenerate').onclick = generateAll;
  $('btnReplay').onclick = refreshPreview;
  $('clickTag').oninput = renderPills;
  $('clickTag').onchange = refreshPreviewSoon;
  $('maxKB').oninput = renderPills;
  if (!S.project) document.body.classList.add('noproject');
  setupStage(); setupInspector(); setupPopovers(); setupSplits();
  renderSizes(); renderPills();
  // Ejemplo interno para pruebas: abrir con #demo
  if (location.hash === '#demo') { $('campaign').value = 'Demo'; $('clickTag').value ||= 'https://www.example.com/'; loadSources(demoSources()); }
}
setup();
window.__app = S; // para pruebas automáticas
