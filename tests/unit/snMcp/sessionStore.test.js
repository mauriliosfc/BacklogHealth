const fs       = require('fs');
const os       = require('os');
const nodePath = require('path');
const { createSessionStore } = require('../../../snMcp/sessionStore');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'bh-sess-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function writeSession(name, data, mtime) {
  const file = nodePath.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data));
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return file;
}

const BASE = { cookie_header: 'JSESSIONID=abc; glide_user_route=x', user_agent: 'Mozilla/5.0 Edg/157', session_token: 'tok1', instance_url: 'https://empresa.service-now.com' };

describe('findSessionFile', () => {
  test('escolhe o arquivo da instância pedida', () => {
    writeSession('session_outra.json', { ...BASE, instance_url: 'https://outra.service-now.com' });
    const f = writeSession('session_empresa.json', BASE);
    const store = createSessionStore();
    expect(store.findSessionFile(dir, 'empresa.service-now.com')).toBe(f);
    expect(store.findSessionFile(dir, 'https://EMPRESA.service-now.com/')).toBe(f);
  });

  test('entre vários da mesma instância, pega o mais recente', () => {
    writeSession('session_a.json', BASE, new Date('2026-01-01'));
    const novo = writeSession('session_b.json', BASE, new Date('2026-06-01'));
    expect(createSessionStore().findSessionFile(dir, 'empresa.service-now.com')).toBe(novo);
  });

  test('ignora arquivos sem cookie, inválidos ou de outro tipo', () => {
    writeSession('session_vazio.json', { ...BASE, cookie_header: '' });
    fs.writeFileSync(nodePath.join(dir, 'session_quebrado.json'), '{nao json');
    writeSession('profile_x.json', BASE);
    expect(createSessionStore().findSessionFile(dir, 'empresa.service-now.com')).toBeNull();
  });

  test('pasta inexistente devolve null', () => {
    expect(createSessionStore().findSessionFile(nodePath.join(dir, 'nao-existe'), 'x')).toBeNull();
  });
});

describe('readSessionHeaders', () => {
  test('monta Cookie, User-Agent e X-UserToken como o MCP', () => {
    const f = writeSession('session_e.json', BASE);
    expect(createSessionStore().readSessionHeaders(f)).toEqual({
      Cookie: BASE.cookie_header, 'User-Agent': BASE.user_agent, 'X-UserToken': 'tok1',
    });
  });

  test('relê quando o MCP regrava o arquivo (novo login)', () => {
    const f = writeSession('session_e.json', BASE, new Date('2026-01-01'));
    const store = createSessionStore();
    expect(store.readSessionHeaders(f).Cookie).toBe(BASE.cookie_header);
    writeSession('session_e.json', { ...BASE, cookie_header: 'JSESSIONID=novo' }, new Date('2026-01-02'));
    expect(store.readSessionHeaders(f).Cookie).toBe('JSESSIONID=novo');
  });

  test('sem cookie lança erro', () => {
    const f = writeSession('session_e.json', { ...BASE, cookie_header: '' });
    expect(() => createSessionStore().readSessionHeaders(f)).toThrow(/no cookies/);
  });
});

describe('persistRotatedToken', () => {
  test('grava o novo token preservando as demais chaves', () => {
    const f = writeSession('session_e.json', { ...BASE, expires_at: 123 });
    const store = createSessionStore();
    expect(store.persistRotatedToken(f, 'tok2')).toBe(true);
    const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
    expect(saved).toEqual({ ...BASE, expires_at: 123, session_token: 'tok2' });
    expect(store.readSessionHeaders(f)['X-UserToken']).toBe('tok2');
    expect(fs.readdirSync(dir).filter(n => n.endsWith('.tmp'))).toHaveLength(0);
  });

  test('token igual ou vazio não regrava', () => {
    const f = writeSession('session_e.json', BASE);
    const store = createSessionStore();
    expect(store.persistRotatedToken(f, 'tok1')).toBe(false);
    expect(store.persistRotatedToken(f, '')).toBe(false);
  });

  test('rotatedTokenFrom lê X-UserToken ou X-CSRF-Token', () => {
    const store = createSessionStore();
    expect(store.rotatedTokenFrom({ 'x-usertoken': ' t1 ' })).toBe('t1');
    expect(store.rotatedTokenFrom({ 'x-csrf-token': 't2' })).toBe('t2');
    expect(store.rotatedTokenFrom({})).toBe('');
  });
});
