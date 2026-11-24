// Funções puras de organizações do Azure DevOps e identificação de projetos.
// Reexportadas por config.js; ficam aqui para serem usadas (e testadas) sem o estado do config.

// Id estável da organização: nome em minúsculas ou, sem nome, o primeiro trecho do host
function orgIdFor(org, baseUrl) {
  const base = String(org || '').trim() || (() => {
    try { return new URL(baseUrl).hostname.split('.')[0]; } catch (_) { return ''; }
  })();
  return base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'org';
}

// Id único entre as organizações existentes (mesmo nome em hosts diferentes → sufixo)
function uniqueOrgId(org, baseUrl, organizations = []) {
  const base = orgIdFor(org, baseUrl);
  const taken = new Set(organizations.map(o => o.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function orgLabel(org) {
  return (org && (org.label || org.org)) || '';
}

function sameBaseUrl(a, b) {
  const norm = u => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
  return !!a && norm(a) === norm(b);
}

// Nome base: "ProjectName - TeamName" quando há time, senão "ProjectName"
function getBaseDisplayName(p) {
  if (typeof p === 'string') return p;
  return p.team ? `${p.name} - ${p.team}` : p.name;
}

// Identificador do projeto em toda a stack (URLs, cache, localStorage, data-project).
// `key` só existe quando o nome colidiu com um projeto de outra organização.
function getDisplayName(p) {
  if (typeof p === 'string') return p;
  return p.key || getBaseDisplayName(p);
}

// Define `key` para projetos de uma organização cujo nome já existe em outra.
// Projetos que já têm key (ou não colidem) ficam como estão — nada muda em cache/localStorage.
function assignProjectKeys(newProjects, otherProjects, org) {
  const taken = new Set((otherProjects || []).map(getDisplayName));
  const prefix = orgLabel(org) || (org && org.id) || 'org';
  return newProjects.map(p => {
    if (p.key) return p;
    const base = getBaseDisplayName(p);
    if (!taken.has(base)) return p;
    let key = `${prefix} / ${base}`;
    for (let i = 2; taken.has(key); i++) key = `${prefix} / ${base} (${i})`;
    taken.add(key);
    return { ...p, key };
  });
}

module.exports = { orgIdFor, uniqueOrgId, orgLabel, sameBaseUrl, getBaseDisplayName, getDisplayName, assignProjectKeys };
