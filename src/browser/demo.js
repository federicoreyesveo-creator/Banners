// Proyecto de ejemplo generado en el momento (sin archivos de clientes), para que cualquiera pueda probar la app.
import { canvasToRaster, newCanvas } from './canvas.js';
import { alphaBounds, crop } from '../core/raster.js';

const SHADOW = { size: 27, spread: 14, distance: 0, angle: 90, opacity: 0.63, color: { r: 0, g: 0, b: 0 } };
let n = 0;
const id = (p) => `${p}demo${++n}`;

function photo(w, h, hue, seed) {
  const c = newCanvas(w, h), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue},55%,62%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360},50%,28%)`);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 14; i++) {
    x.fillStyle = `hsla(${(hue + rnd() * 80) % 360},60%,${40 + rnd() * 40}%,.35)`;
    x.beginPath(); x.arc(rnd() * w, rnd() * h, 20 + rnd() * 90, 0, Math.PI * 2); x.fill();
  }
  // "horizonte" para que se note el recorte
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, h * 0.68, w, h * 0.32);
  return canvasToRaster(c);
}

function textRaster(str, size, opts = {}) {
  const c = newCanvas(400, size * 2), x = c.getContext('2d');
  x.font = `800 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  x.fillStyle = opts.color || '#fff'; x.textBaseline = 'middle';
  if (opts.box) {
    const w = x.measureText(str).width + 36;
    x.strokeStyle = '#fff'; x.lineWidth = 2.5; x.beginPath(); x.roundRect(2, 4, w, size * 2 - 8, 6); x.stroke();
    x.fillText(str, 20, size);
  } else x.fillText(str, 0, size);
  const r = canvasToRaster(c), bb = alphaBounds(r, 2);
  return crop(r, bb.x, bb.y, bb.w, bb.h);
}

function frame(name, hue, seed, lines, extra = []) {
  const bg = photo(380, 310, hue, seed);
  const elements = [];
  lines.forEach(([str, size, y]) => {
    const r = textRaster(str, size);
    elements.push({ id: id('t'), name: str, kind: 'text', raster: r, x: Math.round((300 - r.w) / 2), y, shadow: SHADOW, group: name });
  });
  elements.push(...extra);
  return { id: id('f'), name, w: 300, h: 250, bg: { raster: bg, x: -40, y: -30 }, elements };
}

export function demoSources() {
  const logo = textRaster('MARCA', 46);
  const cta = textRaster('LEARN MORE', 15, { box: true });
  const frames = [
    frame('Demo 1', 200, 3, [['YOUR NEXT', 26, 158], ['GETAWAY.', 26, 192]]),
    frame('Demo 2', 330, 7, [['WHERE', 24, 140], ['STORIES', 24, 172], ['BEGIN', 24, 204]]),
    frame('Demo 3', 30, 11, [['WARM.', 26, 28]]),
    frame('Demo 4', 260, 19, [], [
      { id: id('logo'), name: 'logo', kind: 'logo', raster: logo, x: Math.round((300 - logo.w) / 2), y: 92, shadow: { ...SHADOW, opacity: 0.55 } },
      { id: id('cta'), name: 'LEARN MORE', kind: 'cta', raster: cta, x: Math.round((300 - cta.w) / 2), y: 170, shadow: null },
    ]),
  ];
  return { sizes: { '300x250': frames }, kind: 'psd', notes: [] };
}
