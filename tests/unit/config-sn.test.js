// Várias instâncias do Service Now no config: migração, espelho da principal em
// `servicenow`, gravação por instância e resolução da instância de cada projeto.
jest.mock('fs');

const fs = require('fs');
const { loadConfig, saveConfig, getCfg, saveSnConfig, getSnInstances, getSnInstance, getProjectSnContext, getAppMode } = require('../../config');

function load(obj) {
  fs.readFileSync.mockReturnValueOnce(JSON.stringify(obj));
  return loadConfig();
}
const written = () => JSON.parse(fs.writeFileSync.mock.calls[fs.writeFileSync.mock.calls.length - 1][1]);

const A = { id: 'a', instance: 'a.service-now.com', mode: 'api', user: 'ua', pass: 'pa', assignmentGroups: ['GA'] };
const B = { id: 'b', instance: 'b.service-now.com', mode: 'mcp', label: 'Cliente B', mcp: { username: 'me@b' } };

beforeEach(() => { fs.writeFileSync.mockImplementation(() => {}); });

describe('migração e leitura', () => {
  test('config antiga vira uma instância e o modo do app não muda', () => {
    load({ servicenow: { instance: 'a.service-now.com', user: 'u', pass: 'p' } });
    expect(getSnInstances()).toEqual([{ id: 'a', instance: 'a.service-now.com', user: 'u', pass: 'p' }]);
    expect(getAppMode()).toBe('sn-only');
  });

  test('getSnInstance: pelo id, ou a principal quando o id não existe', () => {
    load({ servicenow: { ...A }, snInstances: [A, B] });
    expect(getSnInstance('b').instance).toBe('b.service-now.com');
    expect(getSnInstance('zzz').id).toBe('a');
    expect(getSnInstance().id).toBe('a');
  });

  test('getProjectSnContext: projeto aponta para a sua instância; sem instanceId usa a principal', () => {
    load({
      servicenow: { ...A }, snInstances: [A, B],
      projects: [
        { name: 'P1', servicenow: { assignmentGroup: 'g1' } },
        { name: 'P2', servicenow: { instanceId: 'b', assignmentGroup: 'g2' } },
      ],
    });
    expect(getProjectSnContext('P1')).toMatchObject({ instanceId: 'a', isPrimary: true, group: { assignmentGroup: 'g1' } });
    expect(getProjectSnContext('P2')).toMatchObject({ instanceId: 'b', isPrimary: false, snCfg: { instance: 'b.service-now.com' } });
    expect(getProjectSnContext('Grupo do dashboard')).toMatchObject({ instanceId: 'a', group: null });
  });

  test('getProjectSnContext: card de grupo do dashboard usa a instância que lista o grupo', () => {
    load({
      servicenow: { ...A, assignmentGroups: ['Rede'] },
      snInstances: [{ ...A, assignmentGroups: ['Rede'] }, { ...B, assignmentGroups: ['Banco', 'Rede'] }],
      projects: [{ name: 'Banco', servicenow: { assignmentGroup: 'g1' } }],
    });
    expect(getProjectSnContext('Rede')).toMatchObject({ instanceId: 'a', isPrimary: true });   // nas duas: principal
    expect(getProjectSnContext('Infra')).toMatchObject({ instanceId: 'a' });                   // em nenhuma: principal
    // Projeto com o mesmo nome de um grupo continua sendo projeto
    expect(getProjectSnContext('Banco')).toMatchObject({ instanceId: 'a', group: { assignmentGroup: 'g1' } });
  });

  test('getProjectSnContext: grupo só da outra instância vai para ela', () => {
    load({
      servicenow: { ...A }, snInstances: [A, { ...B, assignmentGroups: ['Banco'] }],
      projects: [],
    });
    expect(getProjectSnContext('Banco')).toMatchObject({ instanceId: 'b', isPrimary: false });
  });

  test('sem nenhum Service Now: contexto vazio', () => {
    load({ projects: [{ name: 'P1' }] });
    expect(getProjectSnContext('P1')).toMatchObject({ snCfg: null, instanceId: null, isPrimary: false });
  });
});

describe('saveSnConfig', () => {
  test('sem instanceId altera a principal e o espelho em servicenow', () => {
    load({ servicenow: { ...A }, snInstances: [A, B] });
    const id = saveSnConfig({ user: 'novo' });
    expect(id).toBe('a');
    const c = written();
    expect(c.servicenow.user).toBe('novo');
    expect(c.snInstances[0].user).toBe('novo');
    expect(c.snInstances[1]).toEqual(B);
  });

  test('com instanceId altera só aquela instância', () => {
    load({ servicenow: { ...A }, snInstances: [A, B] });
    saveSnConfig({ instanceId: 'b', mcp: { loginUrl: 'https://sso' }, label: 'B novo' });
    const c = written();
    expect(c.snInstances[1]).toMatchObject({ id: 'b', label: 'B novo', mcp: { username: 'me@b', loginUrl: 'https://sso' } });
    expect(c.servicenow).toMatchObject({ instance: 'a.service-now.com', user: 'ua' });
  });

  test("instanceId 'new' adiciona uma instância com id único", () => {
    load({ servicenow: { ...A }, snInstances: [A] });
    const id = saveSnConfig({ instanceId: 'new', instance: 'a.service-now.com', mode: 'api', user: 'x', pass: 'y' });
    expect(id).toBe('a-2');
    expect(written().snInstances.map(s => s.id)).toEqual(['a', 'a-2']);
  });

  test('primeira instância (config vazia) vira a principal', () => {
    load({});
    const id = saveSnConfig({ instance: 'c.service-now.com', mode: 'mcp' });
    expect(id).toBe('c');
    expect(written()).toMatchObject({ servicenow: { instance: 'c.service-now.com', mode: 'mcp' }, snInstances: [{ id: 'c' }] });
  });

  test('label vazio remove o nome de exibição', () => {
    load({ servicenow: { ...A }, snInstances: [A, B] });
    saveSnConfig({ instanceId: 'b', label: '  ' });
    expect('label' in written().snInstances[1]).toBe(false);
  });

  test('grupo do projeto grava a instância; vazio volta para a principal', () => {
    load({ servicenow: { ...A }, snInstances: [A, B], projects: [{ name: 'P1', servicenow: { instanceId: 'b' } }] });
    saveSnConfig({}, { projectName: 'P1', instanceId: 'b', assignmentGroup: 'g', assignmentGroupName: 'G' });
    expect(written().projects[0].servicenow).toEqual({ instanceId: 'b', assignmentGroup: 'g', assignmentGroupName: 'G' });
    saveSnConfig({}, { projectName: 'P1', instanceId: '' });
    expect('instanceId' in written().projects[0].servicenow).toBe(false);
  });

  test('só o grupo do projeto: devolve null e não mexe nas instâncias', () => {
    load({ servicenow: { ...A }, snInstances: [A, B], projects: [{ name: 'P1' }] });
    expect(saveSnConfig({}, { projectName: 'P1', assignmentGroup: 'g' })).toBeNull();
    expect(written().snInstances).toEqual([A, B]);
  });
});

describe('saveConfig', () => {
  test('quem grava direto em servicenow continua valendo para a principal', () => {
    load({ servicenow: { ...A }, snInstances: [A, B] });
    const c = getCfg();
    c.servicenow.assignmentGroups = ['Outro'];
    saveConfig(c);
    expect(written().snInstances[0].assignmentGroups).toEqual(['Outro']);
  });

  test('sem snInstances grava como antes', () => {
    saveConfig({ servicenow: { instance: 'x.service-now.com' } });
    expect(written()).toEqual({ servicenow: { instance: 'x.service-now.com' } });
  });
});
