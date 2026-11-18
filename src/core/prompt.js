// Cuadro de prompt. Por ahora interpreta algunas indicaciones simples de forma local.
// Más adelante este módulo va a llamar a una ruta del servidor (/api/prompt) que habla con Claude
// usando una API key guardada en el servidor (nunca en el navegador).

export const AI_ENABLED = false;

/**
 * Devuelve { changes: {...}, notes: [] } con lo que se pudo entender del texto.
 * changes puede incluir: clickTag, transition, totalSeconds, maxKB, sizes.
 */
export function interpretPrompt(text) {
  const changes = {}, notes = [];
  const t = (text || '').toLowerCase();
  const url = (text || '').match(/https?:\/\/[^\s"'<>]+/i);
  if (url) { changes.clickTag = url[0]; notes.push(`URL de clic: ${url[0]}`); }
  if (/(fundido|crossfade|cross-fade|fade)/.test(t)) { changes.transition = 'fade'; notes.push('Transición: fundido'); }
  else if (/(barrido|wipe)/.test(t)) { changes.transition = 'wipe'; notes.push('Transición: barrido'); }
  const secs = t.match(/(\d+(?:[.,]\d+)?)\s*(s\b|seg|segundos)/);
  if (secs) { changes.totalSeconds = parseFloat(secs[1].replace(',', '.')); notes.push(`Duración total: ${changes.totalSeconds} s`); }
  const kb = t.match(/(\d{2,4})\s*kb/);
  if (kb) { changes.maxKB = parseInt(kb[1], 10); notes.push(`Peso máximo: ${changes.maxKB} KB`); }
  const sizes = [...(text || '').matchAll(/\b(\d{2,4})\s*[x×]\s*(\d{2,4})\b/g)].map((m) => `${m[1]}x${m[2]}`);
  if (sizes.length) { changes.sizes = sizes; notes.push(`Tamaños: ${sizes.join(', ')}`); }
  return { changes, notes };
}
