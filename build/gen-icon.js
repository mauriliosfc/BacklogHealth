/**
 * Gera build/icon.ico — ícone Pulse (ECG) 256x256 com PNG embutido.
 * Usa apenas módulos nativos do Node.js (zlib).
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 256, H = 256;

// ── Paleta ────────────────────────────────────────────────────────────────────
const BG   = [15,  23,  42 ]; // #0f172a
const LINE = [129, 140, 248]; // #818cf8
const DOT  = [199, 210, 254]; // #c7d2fe

// ── Segmentos ECG (viewBox 0 0 140 140 → 256×256) ────────────────────────────
// Path original: M 12,90 L 36,90 L 46,108 L 70,36 L 90,90 L 128,90
const S = W / 140;
const SEGS = [
  [12,90,  36,90 ],
  [36,90,  46,108],
  [46,108, 70,36 ],
  [70,36,  90,90 ],
  [90,90,  128,90],
].map(([x0,y0,x1,y1]) => [x0*S, y0*S, x1*S, y1*S]);

const PEAK_X  = 70  * S;  // ~128
const PEAK_Y  = 36  * S;  // ~66
const PEAK_R  = 5.5 * S;  // ~10px
const HALF_TH = 2.3 * S;  // metade da espessura do traço (~4.2px)

// ── Helpers ───────────────────────────────────────────────────────────────────
function distToSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.hypot(px-x0, py-y0);
  const t = Math.max(0, Math.min(1, ((px-x0)*dx + (py-y0)*dy) / lenSq));
  return Math.hypot(px - x0 - t*dx, py - y0 - t*dy);
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function blend(bg, fg, a) {
  return [
    Math.round(bg[0] * (1-a) + fg[0] * a),
    Math.round(bg[1] * (1-a) + fg[1] * a),
    Math.round(bg[2] * (1-a) + fg[2] * a),
  ];
}

// ── Renderiza pixels ──────────────────────────────────────────────────────────
const pixels = Buffer.alloc(W * H * 4);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;
    let [r, g, b] = BG;

    // Linha ECG — menor distância a qualquer segmento
    let minDist = Infinity;
    for (const [x0,y0,x1,y1] of SEGS) {
      const d = distToSeg(x, y, x0, y0, x1, y1);
      if (d < minDist) minDist = d;
    }
    const lineAlpha = 1 - smoothstep(HALF_TH - 0.5, HALF_TH + 0.5, minDist);
    if (lineAlpha > 0) [r, g, b] = blend([r,g,b], LINE, lineAlpha);

    // Ponto de pico
    const dotDist = Math.hypot(x - PEAK_X, y - PEAK_Y);
    const dotAlpha = 1 - smoothstep(PEAK_R - 0.5, PEAK_R + 0.5, dotDist);
    if (dotAlpha > 0) [r, g, b] = blend([r,g,b], DOT, dotAlpha);

    pixels[idx]   = r;
    pixels[idx+1] = g;
    pixels[idx+2] = b;
    pixels[idx+3] = 255;
  }
}

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// ── Constrói PNG ──────────────────────────────────────────────────────────────
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  pixels.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(W, 0); ihdrData.writeUInt32BE(H, 4);
ihdrData[8]=8; ihdrData[9]=6; // RGBA

const pngData = Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  pngChunk('IHDR', ihdrData),
  pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);

// ── Monta ICO ─────────────────────────────────────────────────────────────────
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0,0); icoHeader.writeUInt16LE(1,2); icoHeader.writeUInt16LE(1,4);

const dirEntry = Buffer.alloc(16);
dirEntry.writeUInt8(0,0); dirEntry.writeUInt8(0,1); // 0 = 256
dirEntry.writeUInt16LE(1,4); dirEntry.writeUInt16LE(32,6);
dirEntry.writeUInt32LE(pngData.length,8); dirEntry.writeUInt32LE(22,12);

const ico = Buffer.concat([icoHeader, dirEntry, pngData]);
const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, ico);
console.log('icon.ico gerado:', ico.length, 'bytes ->', out);
