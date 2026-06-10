const { HttpError, httpError, readBody } = require('../../../handlers/utils');
const { EventEmitter } = require('events');

// helper: cria um stream fake que emite chunks e depois 'end'
function makeReq(chunks = []) {
  const emitter = new EventEmitter();
  setImmediate(() => {
    chunks.forEach(c => emitter.emit('data', c));
    emitter.emit('end');
  });
  return emitter;
}

// ── HttpError ─────────────────────────────────────────────────────────────────

describe('HttpError', () => {
  test('é uma instância de Error', () => {
    expect(new HttpError(400, 'Bad Request') instanceof Error).toBe(true);
  });

  test('preserva status e message', () => {
    const e = new HttpError(404, 'Not found');
    expect(e.status).toBe(404);
    expect(e.message).toBe('Not found');
  });

  test('status 500 é preservado', () => {
    expect(new HttpError(500, 'Oops').status).toBe(500);
  });

  test('status 401 é preservado', () => {
    expect(new HttpError(401, 'Unauthorized').status).toBe(401);
  });
});

// ── httpError ─────────────────────────────────────────────────────────────────

describe('httpError', () => {
  test('lança HttpError (instanceof HttpError)', () => {
    expect(() => httpError(400, 'Bad input')).toThrow(HttpError);
  });

  test('erro lançado contém o status correto', () => {
    expect(() => httpError(403, 'Forbidden'))
      .toThrow(expect.objectContaining({ status: 403 }));
  });

  test('erro lançado contém a mensagem correta', () => {
    expect(() => httpError(422, 'Unprocessable'))
      .toThrow(expect.objectContaining({ message: 'Unprocessable' }));
  });

  test('é também uma instância de Error', () => {
    expect(() => httpError(500, 'err')).toThrow(Error);
  });
});

// ── readBody ──────────────────────────────────────────────────────────────────

describe('readBody', () => {
  test('resolve com string vazia quando não há chunks', async () => {
    await expect(readBody(makeReq([]))).resolves.toBe('');
  });

  test('resolve com um único chunk', async () => {
    await expect(readBody(makeReq(['hello']))).resolves.toBe('hello');
  });

  test('concatena múltiplos chunks na ordem correta', async () => {
    await expect(readBody(makeReq(['foo', 'bar', 'baz']))).resolves.toBe('foobarbaz');
  });

  test('preserva JSON como string crua (parse fica a cargo do chamador)', async () => {
    const body = await readBody(makeReq(['{"key":"value"}']));
    expect(JSON.parse(body)).toEqual({ key: 'value' });
  });

  test('chunks com caracteres especiais são concatenados corretamente', async () => {
    await expect(readBody(makeReq(['áé', 'íóú']))).resolves.toBe('áéíóú');
  });
});
