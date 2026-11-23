const { parseArgs } = require('../../../scripts/sn-sso-debug');

describe('sn-sso-debug parseArgs', () => {
  test('instância, usuário e opções', () => {
    expect(parseArgs(['cnhi.service-now.com', 'user@x.com', '--window', '--profile', 'C:/p', '--keep']))
      .toEqual({ instance: 'cnhi.service-now.com', username: 'user@x.com', window: true, profile: 'C:/p', keep: true });
  });

  test('padrões: sem janela, perfil temporário', () => {
    expect(parseArgs(['vale.service-now.com'])).toEqual({ instance: 'vale.service-now.com', username: '', window: false, profile: '', keep: false });
  });
});
