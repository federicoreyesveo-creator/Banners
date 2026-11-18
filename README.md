# Banners HTML5

App web (100 % en el navegador, sin servidor ni API) que convierte un PSD o un ZIP de PNG en banners HTML5 listos para la agencia, con su GIF de respaldo.

## Cómo se usa
1. Subí el ZIP con los PNG y/o el PSD (o el PSD suelto). Con PSD se separan fondo, textos (renglón por renglón), logo y botón. Con PNG aplanados cada imagen es un frame.
2. Elegí los tamaños. Si el PSD trae mesas de trabajo de ese tamaño se usan tal cual; si no, se adapta desde el tamaño maestro y lo ajustás a mano.
3. Elegí barrido o fundido, la URL de clic y el peso máximo.
4. En el editor: clic en una capa, arrastrá para mover, rueda o esquina para escalar, flechas para ajustar. Elegí **Foto** para mover o hacer zoom del recorte. Ctrl+Z deshace.
5. **Generar ZIP + GIF**: un ZIP y un GIF por tamaño.

## Reglas que aplica por defecto
- No toca el diseño: los textos y logos salen con los pixeles del PSD.
- Sombra paralela reconstruida desde los efectos del PSD (tamaño, extensión, opacidad), como un único PNG suave con alfa completo por frame (calibrada contra los PNG exportados de Photoshop).
- Textos, logo y botón entran por separado: fade + 16 px, 0,375 s, quadOut, sin motion blur. El logo entra con escala y el botón un segundo después.
- Sin loop, termina en el CTA, ~12-14 s. `var clickTag = "..."` + `window.open(window.clickTag)`.
- El ZIP se mantiene bajo el peso máximo bajando la calidad de los JPG solo lo necesario.
- GIF con paleta propia por cuadro para evitar banding en las sombras.

## Correr local
Cualquier servidor estático: `python3 -m http.server` y abrir http://localhost:8000.

Prueba de punta a punta (Playwright): `node tests/e2e.mjs <archivo.psd|zip> <carpeta-salida>` con el servidor en el puerto 8765.

## Indicaciones (prompt)
`src/core/prompt.js` hoy entiende URL, transición, duración total, peso y tamaños de forma local. Está preparado para reemplazarse por una llamada a una ruta de servidor que use Claude con una API key guardada en el servidor (nunca en el navegador).

## Estructura
- `src/core/` lógica pura (PSD → frames, sombras, layout, línea de tiempo, HTML). Corre también en Node.
- `src/browser/` canvas, lectura de archivos (el PSD se lee en un Worker), exportación ZIP/GIF, ejemplo.
- `vendor/` ag-psd, JSZip y gifenc.
