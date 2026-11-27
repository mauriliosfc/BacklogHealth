// Várias instâncias no modo SSO: cada uma tem gerenciador e fachada próprios.
const { EventEmitter } = require('events');
const { createSnMcpRegistry, keyOf } = require('../../../snMcp');

const A  = { mode: 'mcp', instance: 'https://a.service-now.com/', mcp: { username: 'Ana' } };
const A2 = { mode: 'mcp', instance: 'a.service-now.com', mcp: { username: 'ana' } };
const B  = { mode: 'mcp', instance: 'b.service-now.com', mcp: { username: 'bia', loginUrl: 'https://sso' } };

function fakeManager() {
  let state = 'stopped';
  const events = new EventEmitter();
  return {
    events,
    getStatus: () => ({ state, user: '', message: '', reason: '', instance: '' }),
    edgeAvailable: () => true,
    logout: jest.fn(() => { state = 'stopped'; }),
    stop: jest.fn(),
    _set(s) { state = s; events.emit('status', { state: s, instance: '' }); },
  };
}

function setup() {
  const managers = [];
  const facades = [];
  const reg = createSnMcpRegistry({
    createManager: () => { const m = fakeManager(); managers.push(m); return m; },
    createFacade: m => {
      const f = { manager: m, get: jest.fn(async () => ({ result: [] })), connect: jest.fn(), ensure: jest.fn(), warmup: jest.fn() };
      facades.push(f);
      return f;
    },
  });
  return { reg, managers, facades };
}

test('keyOf normaliza host e usuário', () => {
  expect(keyOf(A)).toBe(keyOf(A2));
  expect(keyOf(B)).toBe('b.service-now.com|bia|https://sso');
});

test('cada instância usa a sua fachada; a mesma instância reaproveita', async () => {
  const { reg, facades } = setup();
  await reg.get(A, 'table/incident');
  await reg.get(B, 'table/problem');
  await reg.get(A2, 'table/sc_task');
  expect(facades).toHaveLength(2);
  expect(facades[0].get.mock.calls.map(c => c[1])).toEqual(['table/incident', 'table/sc_task']);
  expect(facades[1].get.mock.calls.map(c => c[1])).toEqual(['table/problem']);
});

test('status e conexão são por instância', () => {
  const { reg, managers } = setup();
  reg.warmup(A); reg.warmup(B);
  managers[1]._set('connected');
  expect(reg.isConnected(B)).toBe(true);
  expect(reg.isConnected(A)).toBe(false);
  expect(reg.getStatus(B).state).toBe('connected');
  expect(reg.getStatus(A).state).toBe('stopped');
});

test('sem instância: usa a única em uso; com várias, nenhuma', () => {
  const { reg, managers } = setup();
  reg.warmup(A);
  managers[0]._set('connected');
  expect(reg.isConnected()).toBe(true);
  reg.warmup(B);
  expect(reg.isConnected()).toBe(false);
  expect(reg.getStatus().state).toBe('stopped');
});

test('logout de uma instância não mexe na outra', () => {
  const { reg, managers } = setup();
  reg.warmup(A); reg.warmup(B);
  reg.logout(B);
  expect(managers[1].logout).toHaveBeenCalledWith({ snCfg: B });
  expect(managers[0].logout).not.toHaveBeenCalled();
});

test('logout sem instância sai de todas (a primeira apaga a pasta inteira)', () => {
  const { reg, managers } = setup();
  reg.warmup(A); reg.warmup(B);
  reg.logout();
  expect(managers[0].logout).toHaveBeenCalledWith({});
  expect(managers[1].logout).toHaveBeenCalledWith({ snCfg: B });
});

test('eventos de status trazem a instância; listStatuses lista todas', () => {
  const { reg, managers } = setup();
  const seen = [];
  reg.events.on('status', s => seen.push(s));
  reg.warmup(A); reg.warmup(B);
  managers[0]._set('connected');
  expect(seen[0]).toMatchObject({ state: 'connected', instance: 'a.service-now.com', key: keyOf(A) });
  expect(reg.listStatuses().map(s => [s.instance, s.state])).toEqual([['a.service-now.com', 'connected'], ['b.service-now.com', 'stopped']]);
});

test('shutdown para todas as instâncias', () => {
  const { reg, managers } = setup();
  reg.warmup(A); reg.warmup(B);
  reg.shutdown();
  expect(managers.every(m => m.stop.mock.calls.some(c => c[0] && c[0].silent))).toBe(true);
});

test('sem nenhuma instância em uso, o status ainda procura o Edge (setup novo)', () => {
  const reg = createSnMcpRegistry({ createManager: fakeManager, createFacade: m => ({ manager: m }), findEdge: () => 'C:/edge.exe' });
  expect(reg.getStatus().edgeAvailable).toBe(true);
  const semEdge = createSnMcpRegistry({ createManager: fakeManager, createFacade: m => ({ manager: m }), findEdge: () => null });
  expect(semEdge.getStatus().edgeAvailable).toBe(false);
});
