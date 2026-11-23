const {
  compareVersions, pickWheel, parseArgs, normalizeDiffPath, splitDiffByFile, affectedCases, buildReport,
} = require('../../../scripts/check-sn-upstream');
const upstream = require('../../../snMcp/upstream.json');

describe('compareVersions', () => {
  test('compara numericamente, parte a parte', () => {
    expect(compareVersions('1.25.48', '1.25.48')).toBe(0);
    expect(compareVersions('1.25.10', '1.25.9')).toBe(1);
    expect(compareVersions('1.9', '1.10')).toBe(-1);
    expect(compareVersions('2.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.25', '1.25.0')).toBe(0);
  });
});

describe('pickWheel', () => {
  test('prefere a wheel py3-none-any e ignora sdist e versões retiradas', () => {
    const files = [
      { packagetype: 'sdist', filename: 'x-1.0.tar.gz', url: 'u0' },
      { packagetype: 'bdist_wheel', filename: 'x-1.0-cp312-win_amd64.whl', url: 'u1', digests: { sha256: 'a' } },
      { packagetype: 'bdist_wheel', filename: 'x-1.0-py3-none-any.whl', url: 'u2', digests: { sha256: 'b' } },
      { packagetype: 'bdist_wheel', filename: 'x-1.0-py3-none-any.whl', url: 'u3', yanked: true },
    ];
    expect(pickWheel(files)).toEqual({ filename: 'x-1.0-py3-none-any.whl', url: 'u2', sha256: 'b' });
  });

  test('sem wheel → null', () => {
    expect(pickWheel([{ packagetype: 'sdist', filename: 'x.tar.gz' }])).toBeNull();
    expect(pickWheel(undefined)).toBeNull();
  });
});

test('parseArgs lê --from e --to', () => {
  expect(parseArgs(['--from', '1.24.0', '--to', '1.25.48'])).toEqual({ from: '1.24.0', to: '1.25.48' });
  expect(parseArgs([])).toEqual({ from: '', to: '' });
});

test('normalizeDiffPath corta até servicenow_mcp/', () => {
  expect(normalizeDiffPath('build/sn-upstream/src/1.25.48/servicenow_mcp/auth/_keepalive.py')).toBe('servicenow_mcp/auth/_keepalive.py');
  expect(normalizeDiffPath('a\\b\\servicenow_mcp\\x.py')).toBe('servicenow_mcp/x.py');
});

const DIFF = [
  'diff --git a/build/sn-upstream/src/1.24.0/servicenow_mcp/auth/_url_predicates.py b/build/sn-upstream/src/1.25.48/servicenow_mcp/auth/_url_predicates.py',
  'index 1..2 100644',
  '--- a/build/sn-upstream/src/1.24.0/servicenow_mcp/auth/_url_predicates.py',
  '+++ b/build/sn-upstream/src/1.25.48/servicenow_mcp/auth/_url_predicates.py',
  '@@ -120,7 +120,8 @@ def _is_login_page_url(url: str) -> bool:',
  '     login_markers = [',
  '+        "/new_login.do",',
  '     ]',
  'diff --git a/build/sn-upstream/src/1.24.0/servicenow_mcp/auth/auth_manager.py b/build/sn-upstream/src/1.25.48/servicenow_mcp/auth/auth_manager.py',
  '--- a/x/servicenow_mcp/auth/auth_manager.py',
  '+++ b/y/servicenow_mcp/auth/auth_manager.py',
  '@@ -10,3 +10,3 @@ import os',
  '-# comentário antigo',
  '+# comentário novo',
].join('\n');

describe('splitDiffByFile', () => {
  test('agrupa os trechos por arquivo, com o cabeçalho da função e só as linhas alteradas', () => {
    const d = splitDiffByFile(DIFF);
    expect(Object.keys(d)).toEqual(['servicenow_mcp/auth/_url_predicates.py', 'servicenow_mcp/auth/auth_manager.py']);
    expect(d['servicenow_mcp/auth/_url_predicates.py'][0]).toEqual({ header: 'def _is_login_page_url(url: str) -> bool:', text: '        "/new_login.do",\n' });
    expect(d['servicenow_mcp/auth/auth_manager.py'][0].text).toBe(' comentário antigo\n comentário novo\n'.replace(/^ /gm, '# '));
  });

  test('diff vazio → nenhum arquivo', () => {
    expect(splitDiffByFile('')).toEqual({});
  });
});

describe('affectedCases', () => {
  test('símbolo no cabeçalho da função = caso afetado; arquivo mudado sem símbolo = revisar', () => {
    const a = affectedCases(splitDiffByFile(DIFF), upstream.cases);
    const c1 = a.find(x => x.id === 'C1');
    expect(c1).toMatchObject({ level: 'symbol', hits: ['servicenow_mcp/auth/_url_predicates.py#_is_login_page_url'] });
    expect(c1.node).toContain('snMcp/loginRules.js#isLoginPageUrl');
    expect(a.find(x => x.id === 'C11')).toMatchObject({ level: 'file' });   // auth_manager mudou fora dos símbolos
    expect(a.find(x => x.id === 'C9')).toBeUndefined();                     // _keepalive.py não mudou
  });

  test('sem diff → nenhum caso', () => {
    expect(affectedCases({}, upstream.cases)).toEqual([]);
  });
});

test('buildReport lista arquivos, casos e próximo passo', () => {
  const diffByFile = splitDiffByFile(DIFF);
  const md = buildReport({
    pkg: 'mfa-servicenow-mcp', repository: 'https://github.com/x/y', from: '1.24.0', to: '1.25.48',
    diffByFile, affected: affectedCases(diffByFile, upstream.cases), untouched: ['servicenow_mcp/auth/_keepalive.py'],
  });
  expect(md).toContain('# mfa-servicenow-mcp: 1.24.0 → 1.25.48');
  expect(md).toContain('`servicenow_mcp/auth/_url_predicates.py`: 1 trecho(s)');
  expect(md).toContain('**C1**');
  expect(md).toContain('Sem mudança: servicenow_mcp/auth/_keepalive.py');
  expect(md).toContain('docs/sn-sso-upstream.md');
});

describe('upstream.json', () => {
  test('todo caso aponta para arquivos acompanhados e para o nosso código', () => {
    const fs = require('fs');
    const nodePath = require('path');
    for (const c of upstream.cases) {
      expect(c.upstream.length).toBeGreaterThan(0);
      c.upstream.forEach(u => expect(upstream.trackedFiles).toContain(u.file));
      c.node.forEach(n => expect(fs.existsSync(nodePath.join(__dirname, '../../..', n.split('#')[0]))).toBe(true));
    }
  });
});
