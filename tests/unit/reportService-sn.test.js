// Review Mensal com várias instâncias do Service Now: cada projeto consulta a sua
// instância, os links apontam para ela e o cache não colide entre instâncias.
jest.mock('fs');
jest.mock('../../config');
jest.mock('../../azureClient');
jest.mock('../../utils/paginate');
jest.mock('../../servicenowClient');

const fs = require('fs');
const { getProjectSnContext } = require('../../config');
const { snGet } = require('../../servicenowClient');
const { fetchSnIncidentBacklog, fetchSnPrbBacklog, fetchSnVolumeIncidents, cacheInvalidate } = require('../../reportService');

const SN_A = { id: 'a', instance: 'a.service-now.com', mode: 'api', user: 'u', pass: 'p', assignmentGroups: ['Grupo Dashboard'] };
const SN_B = { id: 'b', instance: 'b.service-now.com', mode: 'api', user: 'u2', pass: 'p2' };

beforeEach(() => {
  fs.readFileSync.mockImplementation(() => { throw new Error('sem cache'); });
  fs.writeFileSync.mockImplementation(() => {});
  fs.unlinkSync.mockImplementation(() => {});
  getProjectSnContext.mockImplementation(name => {
    if (name === 'Projeto B') return { snCfg: SN_B, group: { instanceId: 'b', assignmentGroup: 'Grupo B' }, instanceId: 'b', isPrimary: false };
    if (name === 'Projeto A') return { snCfg: SN_A, group: { assignmentGroup: '0123456789abcdef0123456789abcdef' }, instanceId: 'a', isPrimary: true };
    return { snCfg: SN_A, group: null, instanceId: 'a', isPrimary: true };
  });
  snGet.mockResolvedValue({ result: [{ sys_id: 'abc', number: 'INC1' }] });
});

test('projeto da instância B consulta B, com o grupo dele, e o link aponta para B', async () => {
  const list = await fetchSnIncidentBacklog('Projeto B', '2026-10');
  expect(snGet.mock.calls[0][0]).toBe(SN_B);
  expect(snGet.mock.calls[0][1]).toContain('assignment_group.name%3DGrupo%20B');
  expect(list[0].url).toBe('https://b.service-now.com/incident.do?sys_id=abc');
});

test('projeto da principal com sys_id usa assignment_group=', async () => {
  await fetchSnPrbBacklog('Projeto A');
  expect(snGet.mock.calls[0][0]).toBe(SN_A);
  expect(decodeURIComponent(snGet.mock.calls[0][1])).toContain('assignment_group=0123456789abcdef0123456789abcdef');
});

test('grupo do drill-down tem prioridade e usa a instância do projeto', async () => {
  await fetchSnIncidentBacklog('Projeto B', '2026-10', { group: 'Outro Grupo' });
  expect(snGet.mock.calls[0][0]).toBe(SN_B);
  expect(decodeURIComponent(snGet.mock.calls[0][1])).toContain('assignment_group.name=Outro Grupo');
});

test('"Ver todos os incidentes" do card (só o grupo, sem projeto) consulta a instância do grupo', async () => {
  getProjectSnContext.mockImplementation(name => name === 'Grupo VALE'
    ? { snCfg: SN_B, group: null, instanceId: 'b', isPrimary: false }
    : { snCfg: SN_A, group: null, instanceId: 'a', isPrimary: true });
  const list = await fetchSnIncidentBacklog('', '2026-10', { group: 'Grupo VALE' });
  expect(getProjectSnContext).toHaveBeenCalledWith('Grupo VALE');
  expect(snGet.mock.calls[0][0]).toBe(SN_B);
  expect(snGet.mock.calls[0][1]).toContain('assignment_group.name%3DGrupo%20VALE');
  expect(list[0].url).toBe('https://b.service-now.com/incident.do?sys_id=abc');
});

test('grupo do dashboard do SN fora da lista permitida não consulta nada', async () => {
  expect(await fetchSnVolumeIncidents('Grupo Estranho', '2026-10')).toBeNull();
  expect(snGet).not.toHaveBeenCalled();
});

test('sem Service Now configurado devolve null', async () => {
  getProjectSnContext.mockReturnValue({ snCfg: null, group: null, instanceId: null, isPrimary: false });
  expect(await fetchSnIncidentBacklog('Projeto A', '2026-10')).toBeNull();
});

test('cacheInvalidate: instância não principal ganha o id no nome do arquivo; principal mantém o nome', () => {
  cacheInvalidate('Projeto B', '2026-10', '', '13');
  cacheInvalidate('Projeto A', '2026-10', '', '13');
  const files = fs.unlinkSync.mock.calls.map(c => String(c[0]).replace(/\\/g, '/').split('/').pop());
  expect(files).toContain('sn_Projeto_B_b_2026-10_13.json');
  expect(files).toContain('sn_Projeto_A_2026-10_13.json');
  expect(files.some(f => f === 'sn_Projeto_B_2026-10_13.json')).toBe(false);
});

// Relatório do Service Now inteiro (incidentes, PRBs, requests): pega variáveis que sumiram na
// troca do bloco de grupo, como o snGrp usado no SLA
describe('fetchSnReport de ponta a ponta', () => {
  const { fetchSnReport, buildPeriod } = require('../../reportService');

  test('projeto da instância B monta o relatório consultando só B, com o SLA do projeto', async () => {
    getProjectSnContext.mockImplementation(() => ({
      snCfg: SN_B, group: { instanceId: 'b', assignmentGroup: 'Grupo B', slaEnabled: true },
      instanceId: 'b', isPrimary: false,
    }));
    snGet.mockResolvedValue({ result: [] });
    const data = await fetchSnReport('Projeto B', buildPeriod('2026-10'));
    expect(data).toBeTruthy();
    expect(data.incidents.slaEnabled).toBe(true);
    expect(snGet.mock.calls.length).toBeGreaterThan(0);
    expect(snGet.mock.calls.every(c => c[0] === SN_B)).toBe(true);
    // Cache do projeto da instância B leva o id no nome
    expect(fs.writeFileSync.mock.calls.some(c => String(c[0]).includes('sn_Projeto_B_b_'))).toBe(true);
  });

  test('projeto da principal sem SLA', async () => {
    snGet.mockResolvedValue({ result: [] });
    const data = await fetchSnReport('Projeto A', buildPeriod('2026-10'));
    expect(data.incidents.slaEnabled).toBe(false);
    expect(snGet.mock.calls.every(c => c[0] === SN_A)).toBe(true);
  });
});

// P4 nos indicadores de incidentes do Review Mensal
describe('P4 no relatório do Service Now', () => {
  const { fetchSnReport, buildPeriod } = require('../../reportService');

  test('conta P4 por prioridade, por sistema e no histórico mensal', async () => {
    const inc = (p, ci) => ({ sys_id: `${p}${ci}${Math.random()}`, number: 'INC', priority: { value: p, display_value: p },
      'cmdb_ci.name': { value: ci, display_value: ci }, opened_at: '2026-10-05 10:00:00' });
    snGet.mockImplementation(async (sn, path) => {
      if (path.includes('table/incident') && path.includes('opened_at')) return { result: [inc('4', 'ERP'), inc('4', 'ERP'), inc('3', 'ERP'), inc('1', 'CRM')] };
      return { result: [] };
    });
    const data = await fetchSnReport('Projeto A', buildPeriod('2026-10'));
    expect(data.incidents.byPriority).toMatchObject({ p1: 1, p3: 1, p4: 2 });
    expect(data.incidents.bySystem.find(s => s.name === 'ERP')).toMatchObject({ p3: 1, p4: 2 });
    expect(data.incidents.slaByPriority).toHaveProperty('p4');
    expect(data.incidents.monthly.some(m => m.p4 === 2)).toBe(true);
  });

  test('cache do Service Now mudou de versão (cache antigo não tem P4)', async () => {
    snGet.mockResolvedValue({ result: [] });
    await fetchSnReport('Projeto A', buildPeriod('2026-10'));
    const names = fs.writeFileSync.mock.calls.map(c => String(c[0]));
    expect(names.some(n => n.includes('_v7'))).toBe(true);
    expect(names.some(n => n.includes('_v6'))).toBe(false);
  });
});
