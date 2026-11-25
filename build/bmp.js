/**
 * Converte pixels BGRA (formato de nativeImage.toBitmap() no Windows) em um arquivo BMP 24-bit.
 * Linhas de baixo para cima (altura positiva) e padding para múltiplos de 4 bytes — o formato mais
 * compatível, aceito pelo splash do NSIS no executável portátil. Apenas Buffer nativo.
 */
function toBmp24(bgra, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('largura e altura devem ser inteiros positivos');
  }
  if (!bgra || bgra.length < width * height * 4) {
    throw new Error('buffer BGRA menor que largura x altura x 4');
  }
  const rowSize   = Math.ceil((width * 3) / 4) * 4;
  const imageSize = rowSize * height;
  const fileSize  = 54 + imageSize;
  const out = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(fileSize, 2);
  out.writeUInt32LE(54, 10);
  // BITMAPINFOHEADER
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);       // planos
  out.writeUInt16LE(24, 28);      // bits por pixel
  out.writeUInt32LE(0, 30);       // BI_RGB
  out.writeUInt32LE(imageSize, 34);
  out.writeInt32LE(2835, 38);     // 72 DPI
  out.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    const dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      out[dst + x * 3]     = bgra[src + x * 4];     // B
      out[dst + x * 3 + 1] = bgra[src + x * 4 + 1]; // G
      out[dst + x * 3 + 2] = bgra[src + x * 4 + 2]; // R
    }
  }
  return out;
}

module.exports = { toBmp24 };
