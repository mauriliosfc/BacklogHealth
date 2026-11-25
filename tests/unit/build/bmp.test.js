const { toBmp24 } = require('../../../build/bmp');

// Imagem w x h em BGRA com a cor de cada pixel definida por fn(x, y) → [b, g, r]
function bgraOf(w, h, fn) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [b, g, r] = fn(x, y);
    buf.set([b, g, r, 255], (y * w + x) * 4);
  }
  return buf;
}

describe('toBmp24', () => {
  test('cabeçalho BMP 24-bit com tamanho, offset e dimensões corretos', () => {
    const bmp = toBmp24(bgraOf(4, 2, () => [0, 0, 0]), 4, 2);
    expect(bmp.toString('ascii', 0, 2)).toBe('BM');
    expect(bmp.readUInt32LE(2)).toBe(54 + 4 * 3 * 2);
    expect(bmp.length).toBe(54 + 24);
    expect(bmp.readUInt32LE(10)).toBe(54);
    expect(bmp.readUInt32LE(14)).toBe(40);
    expect(bmp.readInt32LE(18)).toBe(4);
    expect(bmp.readInt32LE(22)).toBe(2);
    expect(bmp.readUInt16LE(26)).toBe(1);
    expect(bmp.readUInt16LE(28)).toBe(24);
    expect(bmp.readUInt32LE(30)).toBe(0);
  });

  test('largura não múltipla de 4 recebe padding em cada linha', () => {
    // 3 px * 3 bytes = 9 → linha de 12 bytes
    const bmp = toBmp24(bgraOf(3, 2, () => [1, 2, 3]), 3, 2);
    expect(bmp.readUInt32LE(34)).toBe(24);
    expect(bmp.length).toBe(54 + 24);
    expect([...bmp.subarray(54 + 9, 54 + 12)]).toEqual([0, 0, 0]);
  });

  test('mantém a ordem BGR e grava as linhas de baixo para cima', () => {
    // linha de cima vermelha, linha de baixo azul
    const src = bgraOf(1, 2, (_x, y) => (y === 0 ? [0, 0, 255] : [255, 0, 0]));
    const bmp = toBmp24(src, 1, 2);
    const row = 4; // 3 bytes + 1 de padding
    expect([...bmp.subarray(54, 57)]).toEqual([255, 0, 0]);             // 1ª linha do arquivo = de baixo
    expect([...bmp.subarray(54 + row, 54 + row + 3)]).toEqual([0, 0, 255]); // 2ª = de cima
  });

  test('rejeita dimensões inválidas ou buffer pequeno', () => {
    expect(() => toBmp24(Buffer.alloc(16), 0, 4)).toThrow();
    expect(() => toBmp24(Buffer.alloc(16), 2.5, 2)).toThrow();
    expect(() => toBmp24(Buffer.alloc(8), 2, 2)).toThrow();
    expect(() => toBmp24(null, 1, 1)).toThrow();
  });
});
