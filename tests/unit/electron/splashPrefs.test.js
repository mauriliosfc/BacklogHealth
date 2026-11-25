const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { resolveLang, resolveTheme, splashText, readPrefs, writePrefs } = require('../../../electron/splashPrefs');

describe('resolveLang', () => {
  test('usa o idioma salvo quando é suportado', () => {
    expect(resolveLang('pt', 'en-US')).toBe('pt');
    expect(resolveLang('es', 'pt-BR')).toBe('es');
  });

  test('ignora idioma salvo inválido e cai no do Windows', () => {
    expect(resolveLang('fr', 'pt-BR')).toBe('pt');
    expect(resolveLang(undefined, 'es-ES')).toBe('es');
    expect(resolveLang(null, 'PT_br')).toBe('pt');
  });

  test('idioma do Windows não suportado ou vazio vira inglês', () => {
    expect(resolveLang(undefined, 'fr-FR')).toBe('en');
    expect(resolveLang(undefined, '')).toBe('en');
    expect(resolveLang(undefined, undefined)).toBe('en');
  });
});

describe('resolveTheme', () => {
  test('usa o tema salvo do app', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  test('sem tema salvo segue o Windows', () => {
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme('azul', false)).toBe('light');
  });
});

describe('splashText', () => {
  test('lê o texto dos arquivos de idioma reais nos 3 idiomas', () => {
    expect(splashText('pt')).toBe('Carregando projetos do Azure DevOps…');
    expect(splashText('en')).toBe('Loading Azure DevOps projects…');
    expect(splashText('es')).toBe('Cargando proyectos de Azure DevOps…');
  });

  test('idioma desconhecido usa inglês', () => {
    expect(splashText('fr')).toBe('Loading Azure DevOps projects…');
  });

  describe('com diretório de idiomas incompleto', () => {
    let dir;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'splash-i18n-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('chave ausente no idioma cai no inglês', () => {
      fs.writeFileSync(path.join(dir, 'pt.json'), '{}');
      fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify({ splash_loading: 'Loading' }));
      expect(splashText('pt', dir)).toBe('Loading');
    });

    test('sem arquivos usa o texto fixo de reserva', () => {
      expect(splashText('pt', dir)).toBe('Loading Azure DevOps projects…');
    });
  });
});

describe('readPrefs / writePrefs', () => {
  let dir, file;
  beforeEach(() => {
    dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'splash-prefs-'));
    file = path.join(dir, 'sub', 'splash.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('arquivo ausente retorna objeto vazio', () => {
    expect(readPrefs(file)).toEqual({});
  });

  test('arquivo corrompido ou que não é objeto retorna objeto vazio', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{nao json');
    expect(readPrefs(file)).toEqual({});
    fs.writeFileSync(file, '[1,2]');
    expect(readPrefs(file)).toEqual({});
  });

  test('grava e mescla idioma e tema sem perder o anterior', () => {
    writePrefs(file, { lang: 'pt' });
    writePrefs(file, { theme: 'light' });
    expect(readPrefs(file)).toEqual({ lang: 'pt', theme: 'light' });
  });

  test('ignora valores desconhecidos', () => {
    writePrefs(file, { lang: 'es', theme: 'dark' });
    const out = writePrefs(file, { lang: 'fr', theme: 'azul', outro: 1 });
    expect(out).toEqual({ lang: 'es', theme: 'dark' });
    expect(readPrefs(file)).toEqual({ lang: 'es', theme: 'dark' });
  });

  test('falha ao gravar não lança erro', () => {
    jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error('EACCES'); });
    expect(() => writePrefs(file, { lang: 'pt' })).not.toThrow();
  });
});
