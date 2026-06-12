/**
 * Gera build/icon.ico — ícone Pulse (ECG) multi-tamanho (16/32/48/256px).
 * Usa apenas módulos nativos do Node.js (zlib).
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Paleta ────────────────────────────────────────────────────────────────────
const BG   = [15,  23,  42 ]; // #0f172a
const LINE = [129, 140, 248]; // #818cf8
const DOT  = [199, 210, 254]; // #c7d2fe

// ── Helpers ───────────────────────────────────────────────────────────────────
function distToSeg(px, py, x0, y0, x1, y1) {
  const dx = x1-x0, dy = y1-y0, lenSq = dx*dx+dy*dy;
  if (lenSq === 0) return Math.hypot(px-x0, py-y0);
  const t = Math.max(0, Math.min(1, ((px-x0)*dx+(py-y0)*dy)/lenSq));
  return Math.hypot(px-x0-t*dx, py-y0-t*dy);
}
function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x-e0)/(e1-e0)));
  return t*t*(3-2*t);
}
function blend(bg, fg, a) {
  return [Math.round(bg[0]*(1-a)+fg[0]*a), Math.round(bg[1]*(1-a)+fg[1]*a), Math.round(bg[2]*(1-a)+fg[2]*a)];
}

// ── Renderiza pixels RGBA para um dado tamanho ────────────────────────────────
function renderPixels(size) {
  const S    = size / 140;
  const segs = [[12,90,36,90],[36,90,46,108],[46,108,70,36],[70,36,90,90],[90,90,128,90]]
               .map(([x0,y0,x1,y1]) => [x0*S, y0*S, x1*S, y1*S]);
  const peakX = 70 * S, peakY = 36 * S;
  const peakR = Math.max(5.5 * S, 1.5);
  const halfTh = Math.max(2.3 * S, 1.6);

  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let [r, g, b] = BG;
      let minDist = Infinity;
      for (const [x0,y0,x1,y1] of segs) {
        const d = distToSeg(x, y, x0, y0, x1, y1);
        if (d < minDist) minDist = d;
      }
      const la = 1 - smoothstep(halfTh-0.5, halfTh+0.5, minDist);
      if (la > 0) [r,g,b] = blend([r,g,b], LINE, la);
      const da = 1 - smoothstep(peakR-0.5, peakR+0.5, Math.hypot(x-peakX, y-peakY));
      if (da > 0) [r,g,b] = blend([r,g,b], DOT, da);
      px[idx]=r; px[idx+1]=g; px[idx+2]=b; px[idx+3]=255;
    }
  }
  return px;
}

// ── Formata como BMP dentro do ICO (32-bit BGRA, bottom-up) ──────────────────
function buildBMP(size, pixels) {
  const hdr = Buffer.alloc(40);
  hdr.writeUInt32LE(40, 0);
  hdr.writeInt32LE(size, 4);
  hdr.writeInt32LE(size * 2, 8); // altura dupla: XOR mask + AND mask
  hdr.writeUInt16LE(1, 12);      // planes
  hdr.writeUInt16LE(32, 14);     // bit count (RGBA)

  // Pixels BGRA, bottom-to-top
  const bgraPx = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const s = (row * size + col) * 4;
      const d = ((size-1-row) * size + col) * 4;
      bgraPx[d]=pixels[s+2]; bgraPx[d+1]=pixels[s+1]; bgraPx[d+2]=pixels[s]; bgraPx[d+3]=pixels[s+3];
    }
  }

  // AND mask: 1 bit/pixel, linhas alinhadas em 32 bits (todos 0 = opaco)
  const rowBytes = Math.ceil(size / 32) * 4;
  const andMask  = Buffer.alloc(size * rowBytes, 0);

  return Buffer.concat([hdr, bgraPx, andMask]);
}

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c&1) ? (0xEDB88320^(c>>>1)) : (c>>>1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c^buf[i])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type,'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length,0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,data])),0);
  return Buffer.concat([len,t,data,crc]);
}

// ── Constrói PNG 256×256 ──────────────────────────────────────────────────────
function buildPNG(pixels) {
  const W = 256, H = 256;
  const raw = Buffer.alloc(H*(1+W*4));
  for (let y = 0; y < H; y++) {
    raw[y*(1+W*4)] = 0;
    pixels.copy(raw, y*(1+W*4)+1, y*W*4, (y+1)*W*4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4);
  ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, {level:6})),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Monta ICO multi-tamanho ───────────────────────────────────────────────────
const BMP_SIZES = [16, 32, 48];
const PNG_SIZE  = 256;

const images = [];
for (const sz of BMP_SIZES) images.push({ size: sz, data: buildBMP(sz, renderPixels(sz)), isPNG: false });
const pngPx = renderPixels(PNG_SIZE);
images.push({ size: 256, data: buildPNG(pngPx), isPNG: true });

const count = images.length;
const headerSize  = 6;
const entrySize   = 16;
const dataOffset  = headerSize + entrySize * count;

// ICO header
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0,0); icoHeader.writeUInt16LE(1,2); icoHeader.writeUInt16LE(count,4);

// Calcula offsets
let offset = dataOffset;
const entries = images.map(img => {
  const sz = img.isPNG ? 0 : img.size; // 0 = 256 em ICO spec
  const entry = Buffer.alloc(16);
  entry.writeUInt8(sz,0); entry.writeUInt8(sz,1);
  entry.writeUInt8(0,2); entry.writeUInt8(0,3);
  entry.writeUInt16LE(1,4); entry.writeUInt16LE(32,6);
  entry.writeUInt32LE(img.data.length,8);
  entry.writeUInt32LE(offset,12);
  offset += img.data.length;
  return entry;
});

const ico = Buffer.concat([icoHeader, ...entries, ...images.map(i => i.data)]);
const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, ico);
console.log(`icon.ico gerado: ${ico.length} bytes (${BMP_SIZES.join('/')}/${PNG_SIZE}px) -> ${out}`);
