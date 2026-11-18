// Interfaz: carga, editor visual, vista previa y exportación.
import { ANIMS, TRANSITIONS, PRESET_SIZES, parseSize, defaultDurations, defaultAnims, identityLayout, autoLayout, buildPlan } from './core/plan.js';
import { buildShadow } from './core/raster.js';
import { interpretPrompt } from './core/prompt.js';
import { ingest } from './browser/ingest.js';
import { rasterToCanvas, newCanvas } from './browser/canvas.js';
import { exportSize, previewHtml, renderFrameParts, composeFinal } from './browser/export.js';
import { demoSources } from './browser/demo.js';

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
  return { master, frames, transition: currentTransition(), layouts: {} };
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
    const n = S.project.frames.length;
    const sizes = Object.keys(res.sizes).join(', ');
    $('ingestInfo').textContent = `${res.kind === 'psd' ? 'PSD' : 'PNG'}: ${n} frame${n === 1 ? '' : 's'} · ${sizes}. ${res.notes.join(' ')}`;
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
  renderTabs(); renderStage(); renderInspector(); scheduleThumbs();
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
  $('frameLabel').textContent = `Frame ${S.frame + 1} de ${S.project.frames.length} · ${S.cur}`;
  $('totalInfo').textContent = `Total: ${total.toFixed(1)} s · ${TRANSITIONS[S.project.transition].label.toLowerCase()} · sin loop`;
}

let thumbTimer = 0;
function scheduleThumbs() { clearTimeout(thumbTimer); thumbTimer = setTimeout(renderThumbs, 250); }
function renderThumbs() {
  if (!S.project || !S.cur) return;
  const plan = buildPlan(S.project, S.cur);
  const parts = renderFrameParts(plan);
  const box = $('strip'); box.innerHTML = '';
  plan.frames.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'thumb' + (i === S.frame ? ' on' : '');
    const c = composeFinal(plan, parts, i);
    const k = Math.min(160 / plan.W, 64 / plan.H);
    const t = newCanvas(plan.W * k, plan.H * k);
    const ctx = t.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, 0, 0, t.width, t.height);
    d.appendChild(t);
    d.append(`${i + 1} · ${f.dur.toFixed(1)} s`);
    d.onclick = () => { S.frame = i; S.sel = null; renderAll(); };
    box.appendChild(d);
  });
}

// ---------- editor ----------
let zoom = 1;
function renderStage() {
  const { w: W, h: H } = parseSize(S.cur);
  const wrap = $('stageWrap');
  const availW = wrap.clientWidth - 80, availH = wrap.clientHeight - 80;
  zoom = Math.max(0.3, Math.min(3, availW / W, availH / H));
  const stage = $('stage');
  stage.style.width = `${W * zoom}px`; stage.style.height = `${H * zoom}px`;
  const world = $('world');
  world.style.width = `${W}px`; world.style.height = `${H}px`;
  world.style.transform = `scale(${zoom})`;
  world.innerHTML = '';
  const src = curSrc(), lay = curLay();
  if (src.bg && lay.bg) {
    const c = cloneCanvas(rasterToCanvas(src.bg.raster));
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
      else if (id) { S.sel = id; renderInspector(); }
      else { S.sel = null; updateSelBox(); return; }
      pushHistory();
      drag = { mode: 'move', x: ev.clientX, y: ev.clientY, fx: 0, fy: 0 };
    }
    stage.setPointerCapture(ev.pointerId);
    updateSelBox();
    ev.preventDefault();
  });
  stage.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (drag.mode === 'move') {
      drag.fx += (ev.clientX - drag.x) / zoom; drag.fy += (ev.clientY - drag.y) / zoom;
      drag.x = ev.clientX; drag.y = ev.clientY;
      const dx = Math.trunc(drag.fx), dy = Math.trunc(drag.fy);
      if (dx || dy) { drag.fx -= dx; drag.fy -= dy; moveSel(dx, dy); }
    } else {
      const dw = (ev.clientX - drag.x0) / zoom;
      scaleSel(drag.s0 * (drag.w0 + dw) / drag.w0, drag.anchor);
    }
  });
  const end = () => { if (drag) { drag = null; refreshPreviewSoon(); } };
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
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
    if (!S.sel) return;
    const step = ev.shiftKey ? 10 : 1;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[ev.key]) { ev.preventDefault(); pushHistory(); moveSel(...map[ev.key]); refreshPreviewSoon(); }
    if (ev.key === 'Escape') { S.sel = null; updateSelBox(); }
  });
  window.addEventListener('resize', () => S.project && renderStage());
}
let wheelTimer = 0;

// ---------- inspector ----------
function renderInspector() {
  const pf = curPF(), src = curSrc(), lay = curLay();
  $('duration').value = pf.duration;
  const box = $('layers'); box.innerHTML = '';
  if (src.bg) {
    const d = document.createElement('div');
    d.className = 'layer' + (S.sel === 'bg' ? ' on' : ''); d.dataset.id = 'bg';
    d.innerHTML = `<div class="name"><span class="k">foto</span><em>Fondo / recorte</em></div>`;
    d.onclick = () => { S.sel = 'bg'; updateSelBox(); };
    box.appendChild(d);
  }
  const kindLabel = { text: 'texto', logo: 'logo', cta: 'botón' };
  for (const e of src.elements) {
    const L = lay.el[e.id] || (lay.el[e.id] = { x: e.x, y: e.y, s: 1 });
    const a = pf.anims[e.id] || (pf.anims[e.id] = { anim: 'fade', delay: 0 });
    const d = document.createElement('div');
    d.className = 'layer' + (S.sel === e.id ? ' on' : '') + (L.hidden ? ' off' : ''); d.dataset.id = e.id;
    d.innerHTML = `<div class="name"><span class="k">${kindLabel[e.kind] || e.kind}</span><em title="${e.name.replace(/"/g, '&quot;')}">${e.name.replace(/</g, '&lt;')}</em><input type="checkbox" ${L.hidden ? '' : 'checked'} title="Visible"></div>
      <div class="ctrl"><select title="Animación de entrada">${Object.entries(ANIMS).map(([k, v]) => `<option value="${k}" ${k === a.anim ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <input type="number" step="0.05" min="0" value="${a.delay || 0}" title="Retraso (s) desde que entra el frame"></div>`;
    d.onclick = (ev) => { if (ev.target.closest('select,input')) return; S.sel = e.id; updateSelBox(); };
    const [chk, sel, del] = d.querySelectorAll('input[type=checkbox], select, input[type=number]');
    chk.onchange = () => { pushHistory(); L.hidden = !chk.checked; renderStage(); renderInspector(); scheduleThumbs(); refreshPreviewSoon(); };
    sel.onchange = () => { pushHistory(); a.anim = sel.value; refreshPreviewSoon(); };
    del.onchange = () => { pushHistory(); a.delay = Math.max(0, parseFloat(del.value) || 0); refreshPreviewSoon(); };
    box.appendChild(d);
  }
  if (!src.elements.length) {
    const p = document.createElement('p'); p.className = 'hint';
    p.textContent = 'Este frame no tiene capas separadas (PNG aplanado).';
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
}

// ---------- vista previa ----------
let prevTimer = 0;
function refreshPreviewSoon() { clearTimeout(prevTimer); prevTimer = setTimeout(refreshPreview, 500); }
async function refreshPreview() {
  if (!S.project || !S.cur) return;
  const { html, urls, plan } = await previewHtml(S.project, S.cur, { title: $('campaign').value, clickTag: $('clickTag').value || 'https://' });
  S.previewUrls.forEach((u) => URL.revokeObjectURL(u)); S.previewUrls = urls;
  const f = $('preview');
  const box = $('previewBox');
  const k = Math.min(1, (box.clientWidth - 16) / plan.W);
  f.style.width = `${plan.W}px`; f.style.height = `${plan.H}px`;
  f.style.transform = `scale(${k})`;
  $('pv').style.width = `${plan.W * k}px`; $('pv').style.height = `${plan.H * k}px`;
  f.srcdoc = html;
}

// ---------- exportación ----------
async function generateAll() {
  if (!S.project) return;
  busy(true, 'Generando…');
  const outBox = $('outputs'); outBox.innerHTML = '';
  const title = $('campaign').value, base = slug(title);
  const clickTag = $('clickTag').value.trim() || 'https://';
  const maxKB = parseInt($('maxKB').value, 10) || 228;
  const results = [];
  try {
    for (const size of S.sizes) {
      ensureLayout(size);
      const r = await exportSize(S.project, size, { title: `${title} ${size}`, clickTag, maxKB, onProgress: (t) => busy(true, t) });
      results.push(r);
      const zipName = `${base}_${size}_HTML5.zip`, gifName = `${base}_${size}_backup.gif`;
      const zu = URL.createObjectURL(r.zip), gu = URL.createObjectURL(r.gif);
      const d = document.createElement('div'); d.className = 'out';
      d.innerHTML = `<div class="head"><span>${size}</span><span class="${r.fits ? 'ok' : 'bad'}">${kb(r.zip.size)}${r.fits ? '' : ` · pasa de ${maxKB} KB`}</span></div>
        <div><a href="${zu}" download="${zipName}">ZIP HTML5</a><a href="${gu}" download="${gifName}">GIF (${kb(r.gif.size)})</a></div>
        <div class="hint">JPG calidad ${Math.round(r.quality * 100)} · ${r.plan.frames.length} frames · ${r.plan.total.toFixed(1)} s</div>
        <img src="${gu}" alt="GIF ${size}">`;
      outBox.appendChild(d);
      r.zipName = zipName; r.gifName = gifName;
    }
    if (results.length > 1) {
      const all = new window.JSZip();
      for (const r of results) { all.file(r.zipName, r.zip); all.file(r.gifName, r.gif); }
      const blob = await all.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${base}_entregables.zip`; a.textContent = `Descargar todo (${kb(blob.size)})`;
      a.className = 'primary';
      const p = document.createElement('p'); p.appendChild(a); outBox.prepend(p);
    }
    status(`Listo: ${results.length} tamaño${results.length === 1 ? '' : 's'}`);
  } catch (e) {
    console.error(e);
    outBox.innerHTML = `<p class="hint">Error al generar: ${e.message}</p>`;
  } finally { busy(false); }
  window.__lastResults = results; // para pruebas automáticas
}

// ---------- panel izquierdo ----------
function currentTransition() { return document.querySelector('#transition .on')?.dataset.v || 'wipe'; }
function setTransition(v) {
  for (const b of document.querySelectorAll('#transition button')) b.classList.toggle('on', b.dataset.v === v);
  if (S.project) { S.project.transition = v; renderTabs(); refreshPreviewSoon(); }
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
  $('promptInfo').textContent = notes.length ? `Entendí: ${notes.join(' · ')}.` : 'No encontré nada que pueda aplicar todavía. Cuando conectemos Claude vas a poder pedir cualquier cambio.';
  refreshPreviewSoon();
}

function setup() {
  const drop = $('drop');
  $('file').onchange = (e) => handleFiles([...e.target.files]);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFiles([...e.dataTransfer.files]));
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', (e) => { e.preventDefault(); if (e.target.closest('#drop')) return; handleFiles([...e.dataTransfer.files]); });
  $('btnDemo').onclick = () => {
    const res = demoSources();
    $('campaign').value = 'Demo';
    $('clickTag').value ||= 'https://www.example.com/';
    loadSources(res);
    $('ingestInfo').textContent = `Ejemplo: ${S.project.frames.length} frames · 300x250 con capas separadas.`;
  };
  for (const b of document.querySelectorAll('#transition button')) b.onclick = () => setTransition(b.dataset.v);
  $('addSize').onclick = () => {
    const m = $('customSize').value.match(/(\d{2,4})\s*[x×]\s*(\d{2,4})/);
    if (m) { toggleSize(`${m[1]}x${m[2]}`, true); $('customSize').value = ''; }
  };
  $('btnPrompt').onclick = applyPrompt;
  $('btnGenerate').onclick = generateAll;
  $('btnPreview').onclick = refreshPreview;
  $('btnReplay').onclick = refreshPreview;
  $('clickTag').onchange = refreshPreviewSoon;
  setupStage(); setupInspector();
  renderSizes();
}
setup();
window.__app = S; // para pruebas automáticas
