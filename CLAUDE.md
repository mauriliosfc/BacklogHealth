# Backlog Health Dashboard — Guia de Código

> Dashboard Node.js local para monitoramento de saúde de backlogs no Azure DevOps.
> Zero dependências externas em runtime — apenas módulos nativos do Node.js.
> Histórico completo de decisões: [`docs/decisions.md`](docs/decisions.md)
> **Nota:** `docs/decisions.md` não é carregado automaticamente. Consulte-o explicitamente quando precisar entender o contexto histórico de uma decisão antes de alterá-la (ex: "por que o filtro de sprint funciona assim?", "por que esse campo não usa `_links`?").

---

## Arquitetura

### Estrutura de arquivos

```
dash_azure_gestao_pessoal/
├── server.js              ← thin router ~190 linhas + helpers json()/page()
├── config.js              ← loadConfig, saveConfig, getCfg, parseOrgInput, getDisplayName, getProjectConfig
├── azureClient.js         ← azureGet, azurePost, rawAzureGet (usa cfg.baseUrl)
├── projectService.js      ← fetchProject, fetchProjectDetail, buildCardHTML, fetchUATPlans
├── teamCapacityService.js ← fetchTeamCapacity
├── reportService.js       ← buildReport, fetchAzureReport, fetchSnReport, cacheInvalidate (cache JSON 6h)
├── servicenowClient.js    ← snGet (HTTPS Basic auth, mesma estrutura do azureClient)
├── aiClient.js            ← chatCompletion, testConnection (Foundry / Azure OpenAI / genérico)
├── electron/
│   ├── main.js            ← BrowserWindow, Menu.setApplicationMenu(null), nativeTheme, ipcMain, update check
│   ├── preload.js         ← contextBridge — expõe electronAPI ao renderer (themeChanged, updater events)
│   └── updater.js         ← checkForUpdates, downloadUpdate, launchAndQuit (native https, GitHub Releases API)
├── handlers/              ← funções puras async — sem req/res, reutilizáveis por HTTP ou Electron IPC
│   ├── utils.js           ← HttpError, httpError(), readBody()
│   ├── state.js           ← singleton cachedHTML (getter/setter)
│   ├── dashboard.js       ← renderDashboard, renderSetup, buildAndCache
│   ├── projects.js        ← listProjects, setup, removeProject
│   ├── azure.js           ← getDetail, getTeamCapacity, getUAT, getReportFields, getUSStates, getContext
│   ├── ai.js              ← getAiConfig, saveAiCfg, testAiConnection, chat
│   ├── report.js          ← getReportConfig, saveReportConfig, getReport, getIncidents
│   ├── sn.js              ← getSnCfg, saveSnCfg, testSn
│   └── feedback.js        ← submitFeedback
├── utils/
│   ├── paths.js           ← DATA_DIR, CONFIG_PATH, CACHE_DIR (prioridade: ELECTRON_DATA_DIR → pkg → __dirname)
│   ├── health.js          ← calcHealth (compartilhado com frontend via mesma lógica)
│   ├── paginate.js        ← paginatedItems (lotes de 200)
│   └── iterMap.js         ← fetchIterMap (classificationnodes + fallback team)
├── public/
│   ├── style.css          ← todo o CSS (dark/light, Electron, scrollbar, zero duplicatas)
│   ├── app.js             ← entry point ES Module: importa módulos, expõe window globals
│   ├── i18n/              ← pt.json, en.json (padrão), es.json
│   └── modules/
│       ├── constants.js   ← US_TYPES, getItemTypes(), getEstimateField()
│       ├── health.js      ← calcHealth (browser)
│       ├── utils.js       ← fmtD, buildSprintData
│       ├── filters.js     ← applyFilter, initFilters, openCardStat
│       ├── detail.js      ← loadDetailData, buildDetailHTML, openDetailStat
│       ├── daily.js       ← openDaily, openDailyForProject, refreshDaily
│       ├── burndown.js    ← openBurndown, openBurndownFromDaily
│       ├── teamCapacity.js← openTeamCapacity, showDashboardView
│       ├── copilot.js     ← openCopilot, sendCopilotMessage, _loadRichContext
│       ├── report.js      ← openReport, renderReport, reportChangeMonth, reportRefresh
│       ├── snConfig.js    ← modal de configuração SN acessível pelo Report Modal
│       ├── itemsModal.js  ← openItemsModal({ title, items, showPts, defaultFilters })
│       ├── alias.js       ← getAlias, setAlias, applyAliases
│       ├── deliveryPlan.js← openDeliveryPlan (view, não modal — mesmo padrão do teamCapacity)
│       ├── updater.js     ← initUpdater, updDownload, updInstall, updDismiss (banner de update)
│       ├── theme.js       ← setTheme, toggleTheme (notifica Electron via electronAPI.themeChanged)
│       ├── timer.js       ← startTimer, doRefresh
│       └── i18n.js        ← initI18n, t(), setLocale, applyTranslations
├── views/
│   ├── dashboard.html     ← template com tokens {{ORG}}, {{CARDS}}, etc. + #dp-view + #update-banner
│   ├── setup.html         ← template da tela de configuração
│   └── report.html        ← template do Review Mensal
├── tests/
│   ├── unit/
│   │   ├── config.test.js
│   │   ├── handlers/      ← ai, azure, projects, report, sn, utils (259 testes)
│   │   └── utils/         ← health, paginate
│   └── integration/       ← planejado: supertest + nock
├── dist/electron/         ← Backlog Health Setup x.x.x.exe + Backlog Health x.x.x.exe (não versionado)
└── config.json            ← credenciais (gerado automaticamente, não versionado)
```

### Camadas

```
Requisição HTTP → server.js (parse params) → handler puro → helpers json()/page()
                                                  ↓
                               config.js · azureClient · projectService
                               reportService · servicenowClient · aiClient
                                                  ↓
                                   utils/ (health · paginate · iterMap · paths)
```

---

## Padrões e Convenções

### handlers/ — camada de domínio

Funções puras `async` sem `req`/`res`. Erros HTTP lançam `HttpError(status, msg)` de `handlers/utils.js`.
Os mesmos handlers serão chamados pelo Electron via IPC sem alteração.

```js
const { httpError } = require('./utils');
if (!project) httpError(400, 'project required');
```

### server.js — thin router

Dois helpers eliminam try/catch por rota:

```js
async function json(res, fn) { /* await fn(), HttpError → status HTTP */ }
async function page(res, fn) { /* idem para HTML */ }
```

**Atenção:** `/api/report-config` deve ser testado **antes** de `/api/report` (ambiguidade de `startsWith`).

### state.js — cachedHTML compartilhado

`handlers/state.js` — getter/setter para `cachedHTML`. Compartilhado entre `dashboard.js`, `projects.js` e futuro IPC sem prop drilling.

### utils/paths.js — caminhos graváveis

Fonte única de verdade. Prioridade: `ELECTRON_DATA_DIR` env var → `process.pkg` dir → `__dirname`.
**Nunca** computar caminhos inline — sempre importar:
```js
const { CONFIG_PATH, CACHE_DIR } = require('./utils/paths');
```

### Frontend — ES Modules nativos

`public/modules/*.js` usam `import/export` nativos (sem bundler, sem build step).
`public/app.js` importa tudo e expõe ao `window.*` para handlers inline (`onclick="fn()"`).

### Templates HTML

`views/*.html` com tokens `{{TOKEN}}`. Lidos uma vez no startup via `fs.readFileSync`.
`renderTemplate(html, vars)` faz substituição simples — sem engine de template, sem nova dependência.

### Salvar config — preservar campos existentes

`POST /setup` e qualquer função de save **sempre** faz spread do config existente:
```js
saveConfig({ ...getCfg(), org, baseUrl, pat, projects });
```
Garante que `ai`, `github`, `servicenow` não sejam perdidos ao reconfigurar projetos.

### itemsModal — componente genérico

```js
openItemsModal({ title, items, showPts?, defaultFilters? })
// items: [{ id, title, url, state, assignedTo, pts }]
// defaultFilters: estados pré-selecionados (ex: ACTIVE_BUG_STATES)
```

O listener global de `filters.js` exclui `.items-filter-select` do fechamento automático — não remover essa verificação.

### work item types por projeto

`workItemType`: `'User Story'` (padrão) ou `'Task'`.
- Frontend: `getItemTypes(wt)` e `getEstimateField(wt)` em `constants.js`
- Backend: `getProjectConfig(identifier)` em `config.js`
- Métricas calculadas apenas dos `mainItems` — **nunca** incluir Bugs nos indicadores

### URLs de work items

Construir como `${baseUrl}/_workitems/edit/${id}`.
**Nunca** usar `_links.html` da API — quando `&fields=` é usado, `_links` é omitido da resposta.

### Service Now — normalização de campos

Com `sysparm_display_value=all`, campos relacionais retornam `{value, display_value}`:
- `_snVal(v)` → extrai `display_value || value` (para labels visuais e agrupamento)
- `_snRaw(v)` → extrai `value` (para filtros de query e IDs)

Usar `_snRaw` em `number` e `sys_id` para evitar `[object Object]` nos links.

### config.json — estrutura

```json
{
  "org": "myorg", "pat": "...", "baseUrl": "https://dev.azure.com/myorg",
  "projects": [{ "name": "Alpha", "workItemType": "User Story", "team": "opcional",
                 "servicenow": { "assignmentGroup": "sys_id", "assignmentGroupName": "..." } }],
  "ai": { "endpoint": "...", "apiKey": "...", "model": "...", "apiVersion": "..." },
  "servicenow": { "instance": "empresa.service-now.com", "user": "...", "pass": "..." }
}
```

---

## Testes

### Regra obrigatória

Todo código novo sem necessidade de integração deve ter testes unitários.
Ao implementar: **criar testes, rodar `npm test`, avisar o usuário**.

### Scripts

```bash
npm test                # roda tudo uma vez
npm run test:watch      # modo watch (re-executa ao salvar)
npm run test:coverage   # exibe cobertura por arquivo
```

### Onde colocar

| Tipo | Pasta |
|---|---|
| Handlers (`handlers/`) | `tests/unit/handlers/` |
| Utilitários (`utils/`) | `tests/unit/utils/` |
| Funções puras de `config.js` | `tests/unit/config.test.js` |
| Integração HTTP (futuro) | `tests/integration/` |

### Convenções

- `jest.mock()` no topo do arquivo, `beforeEach` para setup de estado
- Mensagens de teste em português
- Framework: Jest (`jest.config.js` na raiz, `clearMocks: true`)

### Estado atual: 259 testes, 12 suites, todos passando

| Arquivo | Cobertura |
|---|---|
| `utils/health.js`, `utils/paginate.js`, `handlers/utils.js` | 100% |
| `handlers/ai.js`, `handlers/sn.js` | 100% linhas |
| `handlers/azure.js`, `handlers/projects.js` | ~97–99% |
| `config.js` (funções puras) | 50% |
| `handlers/` total | ~89% |

---

## Decisões arquiteturais chave

> Histórico completo: [`docs/decisions.md`](docs/decisions.md)

| # | Decisão | Por quê importa hoje |
|---|---|---|
| 13 | Métricas baseadas **apenas em User Stories** (não Tasks/Bugs) | Toda nova métrica deve seguir essa regra |
| 17 | Separação em módulos com responsabilidade única | Define onde cada novo código vai |
| 18 | CSS/JS em `public/` como arquivos estáticos | Padrão para qualquer novo módulo frontend |
| 19 | `views/` com tokens `{{TOKEN}}` + `renderTemplate` | Padrão para qualquer novo template HTML |
| 31 | ES Modules nativos no browser | Zero bundler — importar via `import`, expor via `window.*` no `app.js` |
| 32 | `app.js` expõe `window.X` | Necessário para `onclick` inline nos templates — sempre adicionar exports aqui |
| 33 | `utils/` backend compartilhado | Lógica reutilizável vai em `utils/`, não duplicada nos services |
| 37 | `server.js` serve `public/` dinamicamente | Novos arquivos em `public/` ficam disponíveis automaticamente |
| 94 | `POST /setup` preserva campos via spread | Crítico: reconfigurar projetos não pode apagar credenciais de IA/SN |
| 98 | `itemsModal` como componente genérico | Reutilizar para qualquer lista de work items — não criar modais paralelos |
| 102 | `.items-filter-select` excluído do listener global | Fix que não deve ser revertido — fecha o dropdown imediatamente sem isso |
| 109 | URL via `baseUrl/_workitems/edit/${id}` | `_links` é omitido quando `&fields=` é usado na API |
| 131 | Cache key com sufixo `groupFields` | Configs diferentes coexistem — não simplificar a chave |
| 157 | `utils/paths.js` fonte única de caminhos | Electron injetará `ELECTRON_DATA_DIR` — mudar em um só lugar |
| 158 | `handlers/` como domínio puro | Preparação Electron: handlers chamáveis por IPC sem alteração |
| 159 | `state.js` singleton para `cachedHTML` | Compartilhado entre handlers — não converter em variável local |
| 160 | `json(res, fn)` e `page(res, fn)` | Padrão para toda nova rota em `server.js` |
| 161 | `server.js` ~190 linhas de roteamento puro | Manter thin — lógica de negócio fica nos `handlers/` |
| 162 | `electron/preload.js` com `contextBridge` | `contextIsolation: true` — nunca usar `nodeIntegration: true`; toda comunicação renderer→main via `ipcRenderer` exposto pelo preload |
| 163 | `titleBarStyle: 'hidden'` + `titleBarOverlay` + `body.electron-app::before` | `titleBarOverlay` estiliza apenas os 3 botões nativos; o pseudo-elemento CSS cobre o restante da largura com `background: var(--bg-card)` e `-webkit-app-region: drag` |
| 164 | `nativeTheme.on('updated')` + `ipcMain.on('theme-changed')` | OS-level usa `nativeTheme`; toggle interno envia `theme-changed` via IPC — ambos chamam `win.setTitleBarOverlay(colors)` |
| 165 | Modais com `top: 36px; left: var(--sidebar-w)` no Electron | Botões nativos do Windows são renderizados acima de qualquer CSS z-index — modal começa abaixo da barra; sidebar-collapsed usa `left: var(--sidebar-w-col)` |
| 166 | Padrão de view: cada `open*` esconde todos os siblings | `openDeliveryPlan` esconde `#tc-view`; `openTeamCapacity` esconde `#dp-view`; `showDashboardView` esconde ambos — manter consistente ao adicionar novas views |
| 167 | `electron/updater.js` com native `https` | Sem `electron-updater` (exige code signing); GitHub API retorna nomes de asset com pontos (`Backlog.Health.Setup.x.x.x.exe`) — filtro `/setup/i.test(a.name)` continua funcionando |

---

## Backlog pendente

**Testes**
- [ ] Testes de integração — `server.js` com supertest + nock
- [ ] `utils/iterMap.js` — testes unitários com azureClient mockado

**Electron**
- [x] Electron wrapper com IPC e `ELECTRON_DATA_DIR`
- [x] Título bar tematico + scrollbar customizada
- [x] Modais restritos à área de conteúdo
- [x] Delivery Plan como view (não modal)
- [x] Sistema de atualização no app (GitHub Releases)
- [ ] IPC completo — substituir chamadas HTTP por `ipcMain.handle` para rodar sem servidor local

**Features**
- [ ] Histórico de saúde do backlog (comparar com semanas anteriores)
- [ ] Filtro por responsável além do filtro por sprint
- [ ] Burndown baseado em datas reais de conclusão (histórico de estado)
- [ ] Streaming de respostas da IA (SSE)
- [ ] Troca de idioma sem reload (templates reativos ao locale)
- [ ] Meta contratual de incidentes configurável por projeto
- [ ] Adicionar anexo de imagem ao feedback (GitHub `Contents API`)
- [ ] Migrar para Azure Function + Static Web App para acesso remoto

---

*Stack: Node.js v18+ · Zero dependências runtime · Jest · Electron 33 · electron-builder 25*
