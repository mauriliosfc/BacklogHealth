let _snLoaded = false;

export function toggleSource(src) {
  const content  = document.getElementById('content');
  const snView   = document.getElementById('sn-view');
  const toolbar  = document.querySelector('.cards-toolbar');
  const tcView   = document.getElementById('tc-view');
  const dpView   = document.getElementById('dp-view');
  const isAz     = src === 'az';

  if (isAz) {
    snView?.style.setProperty('display', 'none');
    content?.style.removeProperty('display');
    toolbar?.style.removeProperty('display');
  } else {
    tcView?.style.setProperty('display', 'none');
    dpView?.style.setProperty('display', 'none');
    content?.style.setProperty('display', 'none');
    toolbar?.style.setProperty('display', 'none');
    if (snView) {
      snView.style.display = '';
      if (!_snLoaded) {
        _snLoaded = true;
        snView.innerHTML = '<div class="sn-view-loading">Carregando incidentes...</div>';
        fetch('/api/sn-view')
          .then(r => r.json())
          .then(d => { snView.innerHTML = d.html; })
          .catch(e => {
            snView.innerHTML = `<div class="sn-view-error">Erro ao carregar: ${e.message}</div>`;
            _snLoaded = false;
          });
      }
    }
  }

  document.querySelectorAll('.btn-source').forEach(b =>
    b.classList.toggle('active', b.dataset.source === src)
  );
  localStorage.setItem('dashSource', src);
}

export async function refreshSnView() {
  const snView = document.getElementById('sn-view');
  if (!snView) return;
  const isVisible = snView.style.display !== 'none';
  if (!isVisible) {
    _snLoaded = false;
    return;
  }
  _snLoaded = true;
  snView.innerHTML = '<div class="sn-view-loading">Carregando incidentes...</div>';
  try {
    const r = await fetch('/api/sn-view');
    const d = await r.json();
    snView.innerHTML = d.html;
  } catch (e) {
    snView.innerHTML = `<div class="sn-view-error">Erro ao carregar: ${e.message}</div>`;
    _snLoaded = false;
  }
}
