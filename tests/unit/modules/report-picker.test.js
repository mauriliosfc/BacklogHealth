/**
 * Testes unitários para a factory _openPicker (report.js).
 *
 * Como report.js é um ES module do browser e o ambiente de testes é Node
 * (sem jsdom), a factory é replicada aqui como CommonJS e o DOM é simulado
 * com stubs mínimos. Interação real com o DOM é coberta pelos testes e2e
 * Playwright em tests/e2e/report.spec.js.
 */

// ── Stub de DOM mínimo ────────────────────────────────────────────────────────

function makeMinimalDOM() {
  const _body = [];

  // Cria um elemento stub com id/className, innerHTML com parser de ids, querySelector e remove
  function makeEl(tag) {
    const _idRegistry = {};
    let _html = '';
    const el = {
      tagName:   tag.toUpperCase(),
      id:        '',
      className: '',
      onclick:   null,
      get innerHTML() { return _html; },
      set innerHTML(html) {
        _html = html;
        // auto-registra todos os ids encontrados no HTML para querySelector
        const re = /id="([^"]+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
          const id = m[1];
          _idRegistry[id] = { id, onclick: null, click() { if (typeof this.onclick === 'function') this.onclick(); } };
        }
      },
      get isConnected() { return _body.includes(el); },
      remove() { const i = _body.indexOf(el); if (i >= 0) _body.splice(i, 1); },
      querySelector(sel) {
        const m = sel.match(/^#(.+)$/);
        return m ? (_idRegistry[m[1]] ?? null) : null;
      },
      click() { if (typeof el.onclick === 'function') el.onclick(); },
    };
    return el;
  }

  return {
    createElement: makeEl,
    body: {
      appendChild(el) { _body.push(el); return el; },
    },
    getElementById(id) { return _body.find(el => el.id === id) ?? null; },
    _body,
  };
}

// ── Réplica CommonJS da factory ────────────────────────────────────────────────
// Mantida em sincronia com _openPicker em public/modules/report.js

function makeOpenPicker(doc) {
  let _pickerEl   = null;
  let _backdropEl = null;

  function closeFieldPicker() {
    _pickerEl?.remove();
    _backdropEl?.remove();
    _pickerEl   = null;
    _backdropEl = null;
  }

  function openPicker({ title, bodyHtml = '', applyLabel = 'Aplicar', onApply }) {
    closeFieldPicker();

    _backdropEl            = doc.createElement('div');
    _backdropEl.id        = 'report-picker-backdrop';
    _backdropEl.className = 'report-field-backdrop';
    _backdropEl.onclick   = closeFieldPicker;
    doc.body.appendChild(_backdropEl);

    _pickerEl            = doc.createElement('div');
    _pickerEl.id        = 'report-field-picker';
    _pickerEl.className = 'report-field-picker';
    _pickerEl.innerHTML = `
      <div class="report-field-picker-title">${title}</div>
      ${bodyHtml}
      <div class="report-field-picker-actions">
        <button id="report-picker-cancel">Cancelar</button>
        <button id="report-picker-apply">${applyLabel}</button>
      </div>`;
    doc.body.appendChild(_pickerEl);

    const cancelBtn = _pickerEl.querySelector('#report-picker-cancel');
    const applyBtn  = _pickerEl.querySelector('#report-picker-apply');
    if (cancelBtn) cancelBtn.onclick = closeFieldPicker;
    if (applyBtn)  applyBtn.onclick  = onApply;

    return _pickerEl;
  }

  return { openPicker, closeFieldPicker };
}

// ── Testes ─────────────────────────────────────────────────────────────────────

describe('_openPicker — criação de elementos', () => {
  let doc, ctx;

  beforeEach(() => {
    doc = makeMinimalDOM();
    ctx = makeOpenPicker(doc);
  });

  test('retorna o elemento picker criado', () => {
    const picker = ctx.openPicker({ title: 'Teste', onApply: jest.fn() });
    expect(picker).toBeDefined();
    expect(picker.id).toBe('report-field-picker');
  });

  test('adiciona o picker ao body', () => {
    ctx.openPicker({ title: 'Teste', onApply: jest.fn() });
    expect(doc.getElementById('report-field-picker')).not.toBeNull();
  });

  test('adiciona o backdrop ao body', () => {
    ctx.openPicker({ title: 'Teste', onApply: jest.fn() });
    expect(doc.getElementById('report-picker-backdrop')).not.toBeNull();
  });

  test('picker tem classe report-field-picker', () => {
    const picker = ctx.openPicker({ title: 'X', onApply: jest.fn() });
    expect(picker.className).toBe('report-field-picker');
  });

  test('backdrop tem classe report-field-backdrop', () => {
    ctx.openPicker({ title: 'X', onApply: jest.fn() });
    expect(doc.getElementById('report-picker-backdrop')?.className).toBe('report-field-backdrop');
  });

  test('innerHTML do picker contém o título', () => {
    ctx.openPicker({ title: 'Meu Título', onApply: jest.fn() });
    expect(doc.getElementById('report-field-picker')?.innerHTML).toContain('Meu Título');
  });

  test('innerHTML do picker contém o bodyHtml', () => {
    ctx.openPicker({ title: 'X', bodyHtml: '<span id="custom-body">ok</span>', onApply: jest.fn() });
    expect(doc.getElementById('report-field-picker')?.innerHTML).toContain('custom-body');
  });

  test('usa applyLabel padrão "Aplicar" quando omitido', () => {
    ctx.openPicker({ title: 'X', onApply: jest.fn() });
    expect(doc.getElementById('report-field-picker')?.innerHTML).toContain('Aplicar');
  });

  test('usa applyLabel personalizado quando fornecido', () => {
    ctx.openPicker({ title: 'X', applyLabel: 'Adicionar', onApply: jest.fn() });
    expect(doc.getElementById('report-field-picker')?.innerHTML).toContain('Adicionar');
  });
});

describe('_openPicker — backdrop.onclick fecha o picker', () => {
  test('backdrop.onclick remove picker e backdrop do body', () => {
    const doc = makeMinimalDOM();
    const ctx = makeOpenPicker(doc);
    ctx.openPicker({ title: 'X', onApply: jest.fn() });

    const backdrop = doc.getElementById('report-picker-backdrop');
    backdrop?.onclick();

    expect(doc.getElementById('report-field-picker')).toBeNull();
    expect(doc.getElementById('report-picker-backdrop')).toBeNull();
  });
});

describe('_openPicker — botão Cancelar', () => {
  test('cancelBtn.onclick fecha o picker', () => {
    const doc    = makeMinimalDOM();
    const ctx    = makeOpenPicker(doc);
    const picker = ctx.openPicker({ title: 'X', onApply: jest.fn() });

    picker.querySelector('#report-picker-cancel')?.onclick?.();

    expect(doc.getElementById('report-field-picker')).toBeNull();
    expect(doc.getElementById('report-picker-backdrop')).toBeNull();
  });
});

describe('_openPicker — botão Aplicar', () => {
  test('applyBtn.onclick chama onApply', () => {
    const doc     = makeMinimalDOM();
    const ctx     = makeOpenPicker(doc);
    const onApply = jest.fn();
    const picker  = ctx.openPicker({ title: 'X', onApply });

    picker.querySelector('#report-picker-apply')?.onclick?.();

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  test('onApply diferente por chamada não fica cacheado', () => {
    const doc     = makeMinimalDOM();
    const ctx     = makeOpenPicker(doc);
    const first   = jest.fn();
    const second  = jest.fn();

    ctx.openPicker({ title: 'A', onApply: first });
    const picker2 = ctx.openPicker({ title: 'B', onApply: second });
    picker2.querySelector('#report-picker-apply')?.onclick?.();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('_openPicker — segunda chamada fecha o picker anterior', () => {
  test('nova chamada remove picker e backdrop anteriores', () => {
    const doc = makeMinimalDOM();
    const ctx = makeOpenPicker(doc);

    ctx.openPicker({ title: 'Primeiro', onApply: jest.fn() });
    const firstPicker   = doc.getElementById('report-field-picker');
    const firstBackdrop = doc.getElementById('report-picker-backdrop');

    ctx.openPicker({ title: 'Segundo', onApply: jest.fn() });

    expect(firstPicker?.isConnected).toBe(false);
    expect(firstBackdrop?.isConnected).toBe(false);
    expect(doc.getElementById('report-field-picker')?.innerHTML).toContain('Segundo');
  });

  test('apenas um picker e um backdrop ficam no body', () => {
    const doc = makeMinimalDOM();
    const ctx = makeOpenPicker(doc);

    ctx.openPicker({ title: 'A', onApply: jest.fn() });
    ctx.openPicker({ title: 'B', onApply: jest.fn() });

    expect(doc._body.filter(el => el.id === 'report-field-picker').length).toBe(1);
    expect(doc._body.filter(el => el.id === 'report-picker-backdrop').length).toBe(1);
  });
});

describe('_openPicker — closeFieldPicker', () => {
  test('remove picker e backdrop quando chamado diretamente', () => {
    const doc = makeMinimalDOM();
    const ctx = makeOpenPicker(doc);
    ctx.openPicker({ title: 'X', onApply: jest.fn() });

    ctx.closeFieldPicker();

    expect(doc.getElementById('report-field-picker')).toBeNull();
    expect(doc.getElementById('report-picker-backdrop')).toBeNull();
  });

  test('é idempotente — chamada dupla não lança erro', () => {
    const doc = makeMinimalDOM();
    const ctx = makeOpenPicker(doc);
    ctx.openPicker({ title: 'X', onApply: jest.fn() });

    ctx.closeFieldPicker();
    expect(() => ctx.closeFieldPicker()).not.toThrow();
  });
});
