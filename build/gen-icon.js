/**
 * Gera build/icon.ico com imagem 256x256 (PNG embutida — formato padrão ICO moderno).
 * Usa apenas módulos nativos do Node.js (zlib para comprimir o PNG).
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 256, H = 256;

// ── CRC32 (necessário para chunks PNG) ────────────────────────────────────────
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
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf    = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

// ── Gera pixels: circulo indigo (#6366f1) sobre fundo escuro (#0f172a) ────────
function makePixels(w, h) {
  const px  = Buffer.alloc(w * h * 4);
  const cx  = w / 2, cy = h / 2;
  const r   = w / 2 - 8;     // circulo com margem de 8px
  const ri  = r - 12;         // raio interior para letra "B"

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const dx  = x - cx, dy = y - cy;
      const d2  = dx * dx + dy * dy;

      if (d2 <= r * r) {
        // dentro do circulo — indigo
        px[idx]   = 0x63; // R
        px[idx+1] = 0x66; // G
        px[idx+2] = 0xf1; // B
        px[idx+3] = 0xff; // A
      } else {
        // fora — fundo escuro (transparente nas bordas)
        px[idx]   = 0x0f;
        px[idx+1] = 0x17;
        px[idx+2] = 0x2a;
        px[idx+3] = 0xff;
      }
    }
  }
  return px;
}

// ── Constrói PNG ──────────────────────────────────────────────────────────────
function buildPNG(w, h) {
  const pixels = makePixels(w, h);

  // Scanlines com filtro 0 (None) prefixado por byte 0x00 em cada linha
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter None
    pixels.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0);
  ihdrData.writeUInt32BE(h, 4);
  ihdrData[8]  = 8; // bit depth
  ihdrData[9]  = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Monta ICO com PNG embutido (256x256 usa PNG dentro do ICO) ───────────────
const pngData = buildPNG(W, H);

// ICO header
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type = 1 (ICO)
icoHeader.writeUInt16LE(1, 4); // count = 1

// ICONDIRENTRY — width=0 e height=0 significam 256
const dirEntry = Buffer.alloc(16);
dirEntry.writeUInt8(0, 0);  // width  (0 = 256)
dirEntry.writeUInt8(0, 1);  // height (0 = 256)
dirEntry.writeUInt8(0, 2);  // colors
dirEntry.writeUInt8(0, 3);  // reserved
dirEntry.writeUInt16LE(1, 4);  // planes
dirEntry.writeUInt16LE(32, 6); // bit count
dirEntry.writeUInt32LE(pngData.length, 8);  // size of PNG
dirEntry.writeUInt32LE(22, 12); // offset = 6 (header) + 16 (entry)

const ico = Buffer.concat([icoHeader, dirEntry, pngData]);
const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, ico);
console.log('icon.ico gerado:', ico.length, 'bytes ->', out);
