/**
 * Testes unitários para a lógica da factory _makeDraggable (report.js).
 *
 * Como report.js é um ES module do browser (sem require()), a factory é
 * replicada aqui como CommonJS para testar o algoritmo de forma isolada.
 * Os testes de interação real com o DOM são cobertos pelos testes e2e Playwright
 * em tests/e2e/report.spec.js.
 */

// ── Réplica CommonJS da factory para testes ────────────────────────────────────
// Mantida em sincronia com _makeDraggable em public/modules/report.js
function makeDraggable({ guardSelector, getList, setList, afterDrop }) {
  let srcIdx = -1;
  return {
    start(e, idx) {
      if (guardSelector && e.target.closest(guardSelector)) { e.preventDefault(); return; }
      srcIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
    },
    over(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      e.currentTarget.classList.add('report-drag-over');
    },
    leave(e) { e.currentTarget.classList.remove('report-drag-over'); },
    drop(e, targetIdx) {
      e.preventDefault();
      e.currentTarget.classList.remove('report-drag-over');
      if (srcIdx < 0 || srcIdx === targetIdx) { srcIdx = -1; return; }
      const list  = getList();
      const moved = list.splice(srcIdx, 1)[0];
      list.splice(targetIdx, 0, moved);
      setList(list);
      srcIdx = -1;
      afterDrop();
    },
    end(e) {
      e?.currentTarget?.classList.remove('report-dragging');
      global.document.querySelectorAll('.report-drag-over').forEach(el => el.classList.remove('report-drag-over'));
      srcIdx = -1;
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockEvent(opts = {}) {
  const classes = new Set();
  return {
    preventDefault: jest.fn(),
    target: {
      closest: opts.guardMatch
        ? jest.fn(() => ({}))
        : jest.fn(() => null),
    },
    currentTarget: {
      classList: {
        add:    jest.fn(c => classes.add(c)),
        remove: jest.fn(c => classes.delete(c)),
        has:    c => classes.has(c),
      },
    },
    dataTransfer: { effectAllowed: '', dropEffect: '' },
  };
}

function mockQuerSAll(count = 0) {
  const els = Array.from({ length: count }, () => ({
    classList: { remove: jest.fn() },
  }));
  global.document = { querySelectorAll: jest.fn(() => els) };
  return els;
}

// ── Testes ─────────────────────────────────────────────────────────────────────

describe('makeDraggable — start()', () => {
  test('registra o índice e define effectAllowed', () => {
    const afterDrop = jest.fn();
    const list = ['a', 'b', 'c'];
    const drag = makeDraggable({ getList: () => list, setList: () => {}, afterDrop });

    const e = mockEvent();
    drag.start(e, 1);

    expect(e.dataTransfer.effectAllowed).toBe('move');
    expect(afterDrop).not.toHaveBeenCalled();
  });

  test('bloqueia drag quando guardSelector corresponde ao target', () => {
    const afterDrop = jest.fn();
    const list = ['a', 'b'];
    const drag = makeDraggable({
      guardSelector: 'button',
      getList: () => list,
      setList: () => {},
      afterDrop,
    });

    const eGuarded = mockEvent({ guardMatch: true });
    drag.start(eGuarded, 0);

    expect(eGuarded.preventDefault).toHaveBeenCalled();
    // drop não deve reordenar (srcIdx nunca foi definido)
    const eDrop = mockEvent();
    drag.drop(eDrop, 1);
    expect(afterDrop).not.toHaveBeenCalled();
    expect(list).toEqual(['a', 'b']);
  });

  test('sem guardSelector, qualquer elemento pode iniciar o drag', () => {
    const drag = makeDraggable({
      getList: () => ['a'],
      setList: () => {},
      afterDrop: jest.fn(),
    });
    const e = mockEvent({ guardMatch: true }); // guardMatch irrelevante sem guardSelector
    drag.start(e, 0);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

describe('makeDraggable — over()', () => {
  test('previne default e adiciona classe report-drag-over', () => {
    const drag = makeDraggable({ getList: () => [], setList: () => {}, afterDrop: jest.fn() });
    const e = mockEvent();
    drag.over(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.dataTransfer.dropEffect).toBe('move');
    expect(e.currentTarget.classList.add).toHaveBeenCalledWith('report-drag-over');
  });
});

describe('makeDraggable — leave()', () => {
  test('remove classe report-drag-over', () => {
    const drag = makeDraggable({ getList: () => [], setList: () => {}, afterDrop: jest.fn() });
    const e = mockEvent();
    drag.leave(e);
    expect(e.currentTarget.classList.remove).toHaveBeenCalledWith('report-drag-over');
  });
});

describe('makeDraggable — drop()', () => {
  let list, setList, afterDrop, drag;

  beforeEach(() => {
    list     = ['a', 'b', 'c', 'd'];
    setList  = jest.fn(l => { list = l; });
    afterDrop = jest.fn();
    drag = makeDraggable({ getList: () => list, setList, afterDrop });
  });

  test('move item do índice 0 para índice 2', () => {
    const eStart = mockEvent();
    drag.start(eStart, 0);

    const eDrop = mockEvent();
    drag.drop(eDrop, 2);

    expect(list).toEqual(['b', 'c', 'a', 'd']);
    expect(afterDrop).toHaveBeenCalledTimes(1);
  });

  test('move item do índice 3 para índice 0', () => {
    const eStart = mockEvent();
    drag.start(eStart, 3);

    const eDrop = mockEvent();
    drag.drop(eDrop, 0);

    expect(list).toEqual(['d', 'a', 'b', 'c']);
    expect(afterDrop).toHaveBeenCalledTimes(1);
  });

  test('move item do índice 1 para índice 1 (mesmo índice — no-op)', () => {
    const original = [...list];
    const eStart = mockEvent();
    drag.start(eStart, 1);

    const eDrop = mockEvent();
    drag.drop(eDrop, 1);

    expect(list).toEqual(original);
    expect(afterDrop).not.toHaveBeenCalled();
  });

  test('drop sem start anterior é no-op (srcIdx = -1)', () => {
    const original = [...list];
    const eDrop = mockEvent();
    drag.drop(eDrop, 0);

    expect(list).toEqual(original);
    expect(afterDrop).not.toHaveBeenCalled();
  });

  test('chama setList com a lista reordenada', () => {
    const eStart = mockEvent();
    drag.start(eStart, 0);

    const eDrop = mockEvent();
    drag.drop(eDrop, 1);

    expect(setList).toHaveBeenCalledWith(['b', 'a', 'c', 'd']);
  });

  test('remove classe report-drag-over do target no drop', () => {
    const eStart = mockEvent();
    drag.start(eStart, 0);

    const eDrop = mockEvent();
    drag.drop(eDrop, 1);

    expect(eDrop.currentTarget.classList.remove).toHaveBeenCalledWith('report-drag-over');
  });

  test('múltiplos drags consecutivos mantêm estado consistente', () => {
    // Drag 1: move idx 0 → idx 1  →  ['b', 'a', 'c', 'd']
    drag.start(mockEvent(), 0);
    drag.drop(mockEvent(), 1);
    expect(list).toEqual(['b', 'a', 'c', 'd']);

    // Drag 2: move idx 3 → idx 0  →  ['d', 'b', 'a', 'c']
    drag.start(mockEvent(), 3);
    drag.drop(mockEvent(), 0);
    expect(list).toEqual(['d', 'b', 'a', 'c']);

    expect(afterDrop).toHaveBeenCalledTimes(2);
  });

  test('dois sistemas de drag independentes não interferem entre si', () => {
    const listA = ['x', 'y', 'z'];
    const listB = ['1', '2', '3'];
    const afterA = jest.fn();
    const afterB = jest.fn();

    const dragA = makeDraggable({ getList: () => listA, setList: l => { listA.splice(0, listA.length, ...l); }, afterDrop: afterA });
    const dragB = makeDraggable({ getList: () => listB, setList: l => { listB.splice(0, listB.length, ...l); }, afterDrop: afterB });

    dragA.start(mockEvent(), 0);
    dragB.start(mockEvent(), 2);

    // Completa só drag B
    dragB.drop(mockEvent(), 0);

    expect(listA).toEqual(['x', 'y', 'z']); // A não mudou
    expect(listB).toEqual(['3', '1', '2']);  // B reordenado
    expect(afterA).not.toHaveBeenCalled();
    expect(afterB).toHaveBeenCalledTimes(1);
  });
});

describe('makeDraggable — end()', () => {
  test('limpa classes report-drag-over do DOM', () => {
    const els = mockQuerSAll(2);
    const drag = makeDraggable({ getList: () => [], setList: () => {}, afterDrop: jest.fn() });

    const e = mockEvent();
    drag.end(e);

    expect(global.document.querySelectorAll).toHaveBeenCalledWith('.report-drag-over');
    els.forEach(el => expect(el.classList.remove).toHaveBeenCalledWith('report-drag-over'));
  });

  test('remove classe report-dragging do elemento arrastado', () => {
    mockQuerSAll(0);
    const drag = makeDraggable({ getList: () => [], setList: () => {}, afterDrop: jest.fn() });
    const e = mockEvent();
    drag.end(e);
    expect(e.currentTarget.classList.remove).toHaveBeenCalledWith('report-dragging');
  });

  test('funciona sem argumento de evento (chamada sem parâmetro)', () => {
    mockQuerSAll(0);
    const drag = makeDraggable({ getList: () => [], setList: () => {}, afterDrop: jest.fn() });
    expect(() => drag.end(undefined)).not.toThrow();
  });

  test('após end(), próximo drop sem start é no-op', () => {
    mockQuerSAll(0);
    const list = ['a', 'b'];
    const afterDrop = jest.fn();
    const drag = makeDraggable({ getList: () => list, setList: () => {}, afterDrop });

    drag.start(mockEvent(), 0);
    drag.end(mockEvent());

    drag.drop(mockEvent(), 1);
    expect(afterDrop).not.toHaveBeenCalled();
    expect(list).toEqual(['a', 'b']);
  });
});
