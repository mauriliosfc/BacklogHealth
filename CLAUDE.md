# 📋 Backlog Health Dashboard — Documentação

> Criado com auxílio do Claude (Anthropic) | Março/2026 — Atualizado Junho/2026 (Team Capacity, redesign, Copilot melhorias, UX, itemsModal reutilizável, stats clicáveis dashboard/detail/daily, filtro de status, refresh na Daily, **Review Mensal — Service Delivery Report integrado ao sistema**)

---

## 🎯 Objetivo

Automatizar a rotina de validação de backlog de projetos no **Azure DevOps**, eliminando a necessidade de acessar cada projeto manualmente. O resultado é um dashboard local que exibe o status de saúde de todos os projetos de forma visual e consolidada, com filtros por sprint, atualização automática, painel de detalhes, gráfico de burndown por sprint e apresentação de Daily Standup.

---

## 🏗️ Arquitetura

### Estrutura de arquivos

```
dash_azure_gestao_pessoal/
├── server.js           ← entry point: HTTP server, rotas, serve public/ dinamicamente
├── config.js           ← loadConfig, saveConfig, getCfg, getAuth, parseOrgInput, getProjectConfig
├── azureClient.js      ← azureGet, azurePost, rawAzureGet (usa cfg.baseUrl)
├── projectService.js   ← fetchProject, fetchProjectDetail, buildCardHTML
├── teamCapacityService.js ← fetchTeamCapacity (tasks por dev/sprint, CompletedWork/RemainingWork)
├── utils/
│   ├── health.js       ← calcHealth (fonte única, importado por projectService)
│   ├── paginate.js     ← paginatedItems (lotes de 200)
│   └── iterMap.js      ← fetchIterMap (busca sprints/iterations)
├── public/
│   ├── style.css       ← todo o CSS (setup + dashboard, sem duplicatas)
│   ├── app.js          ← entry point ES Module: importa módulos, expõe window globals
│   ├── i18n/
│   │   ├── pt.json     ← traduções em Português
│   │   ├── en.json     ← traduções em Inglês (padrão)
│   │   └── es.json     ← traduções em Espanhol
│   └── modules/
│       ├── constants.js  ← US_TYPES, TASK_TYPES, CLOSED_STATES, ACTIVE_BUG_STATES, getItemTypes(), getEstimateField()
│       ├── health.js     ← calcHealth (browser, mesma lógica do backend)
│       ├── utils.js      ← fmtD, buildSprintData
│       ├── theme.js      ← setTheme, toggleTheme
│       ├── timer.js      ← startTimer, doRefresh
│       ├── filters.js    ← applyFilter, initFilters, toggleDropdown, toggleUS, initHealthBadges
│       ├── i18n.js       ← initI18n, t, setLocale, getLocale, getDateLocale, applyTranslations
│       ├── detail.js     ← loadDetailData, buildDetailHTML, buildTimeline
│       ├── daily.js      ← openDaily, buildDailySlide
│       ├── burndown.js   ← openBurndown, buildBurndownChart, openBurndownFromDaily
│       ├── deliveryPlan.js ← openDeliveryPlan, buildDeliveryPlan, filtros de projeto
│       ├── alias.js      ← getAlias, setAlias, applyAliases, startRename (apelidos de projeto)
│       ├── teamCapacity.js ← openTeamCapacity, showDashboardView, tcRefresh, tcChangeProject
│       ├── copilot.js    ← openCopilot, sendCopilotMessage, _loadRichContext, _buildContext (fallback DOM)
│       └── report.js     ← renderReport, changeProject, changeMonth, refreshReport, getLast6Months (Review Mensal)
├── aiClient.js         ← chatCompletion, testConnection (Azure AI Foundry / Azure OpenAI / OpenAI-compat)
├── servicenowClient.js ← snGet (cliente HTTPS para a Table API do Service Now, padrão idêntico ao azureClient.js)
├── reportService.js    ← buildReport, buildPeriod, cacheInvalidate (coleta Azure + SN, KPIs, cache por projeto/mês)
├── cache/              ← pasta criada automaticamente; arquivos JSON com TTL de 6h (sn_{proj}_{month}.json, azure_{proj}_{month}.json)
├── views/
│   ├── dashboard.html  ← template HTML do dashboard com tokens {{ORG}}, {{CARDS}}, etc.
│   ├── setup.html      ← template HTML do setup com tokens de configuração
│   └── report.html     ← template HTML do Review Mensal com tokens {{PAYLOAD}}, {{PROJECTS}}, {{PROJECT}}, {{MONTH}}, {{PERIOD}}
├── wrapper/
│   ├── BacklogHealth.csproj  ← projeto C# WPF (.NET Framework 4.8)
│   └── MainWindow.xaml.cs    ← inicia server.exe, aguarda porta 3030, abre WebView2
├── dist/app/           ← pasta de distribuição (não versionada)
│   ├── BacklogHealth.exe     ← wrapper nativo Windows (~14KB)
│   ├── server.exe            ← Node.js + app empacotados (~36MB)
│   └── *.dll / runtimes/     ← DLLs do WebView2
└── config.json         ← credenciais (gerado automaticamente, não versionado)
```

### Fluxo de dados

```
server.js (entry point)
        │
        ├── config.js          → gerencia config.json (org, baseUrl, pat, projects) + parseOrgInput
        │                         + getSnConfig, saveSnConfig, getProjectSnGroup (credenciais Service Now)
        │
        ├── azureClient.js     → chamadas HTTPS para a API REST do Azure DevOps
        │       ├── Projects API    → lista todos os projetos acessíveis pelo PAT
        │       ├── WIQL Query      → busca IDs de work items (state NOT IN Done/Removed)
        │       ├── Work Items API  → detalhes em lotes de 200 (até 500 itens)
        │       └── Iterations API  → sprints com datas (tenta "{projeto} Team" → "{projeto}")
        │
        ├── utils/             → utilitários compartilhados
        │       ├── health.js  → calcHealth (thresholds de saúde)
        │       ├── paginate.js→ paginatedItems (abstrai loop de lotes)
        │       └── iterMap.js → fetchIterMap (abstrai fallback de team name)
        │
        ├── projectService.js  → lógica de negócio + renderização dos cards HTML
        │       ├── fetchProject       → dashboard principal (WIQL + paginação + iterMap em paralelo)
        │       └── fetchProjectDetail → detail modal (3 WIQLs + iterMap em paralelo, 3 paginações em paralelo)
        │
        ├── aiClient.js        → cliente HTTP para provedores de IA
        │       ├── buildUrl     → detecta Foundry / Azure OpenAI / genérico e constrói URL correta
        │       ├── buildHeaders → header api-key (Azure) ou Authorization Bearer (genérico)
        │       ├── buildBody    → injeta system prompt como prefixo no Foundry; max_tokens para outros
        │       └── extractContent → parseia Responses API (Foundry) ou Chat Completions
        │
        ├── servicenowClient.js → chamadas HTTPS para a Table API do Service Now
        │       └── snGet        → GET autenticado (Basic auth), retorna result ou lança erro tipado
        │
        ├── reportService.js   → coleta dados Azure + Service Now, calcula KPIs do Review Mensal
        │       ├── buildReport        → entrada principal: busca cache ou coleta dados em paralelo
        │       ├── buildPeriod        → gera período { month, label, start, end, history[5] }
        │       ├── fetchAzureReport   → work items Done + Bugs via WIQL (usa paginatedItems existente)
        │       ├── fetchSnReport      → incidents + history + PRBs via snGet (só se assignmentGroup configurado)
        │       ├── buildPayload       → monta objeto final { metadata, delivery, quality, incidents, prbs }
        │       └── cacheInvalidate    → remove cache azure_ e sn_ do projeto/mês (usado pelo botão Atualizar)
        │
        └── Servidor HTTP local (porta 3030)
                ├── GET /                    → dashboard principal (HTML cacheado)
                ├── GET /refresh             → rebusca dados e retorna HTML atualizado
                ├── GET /settings            → tela de configurações (pré-preenchida)
                ├── GET /api/projects        → lista projetos disponíveis para o PAT informado
                ├── POST /setup              → salva config.json e retorna JSON {ok:true} (preserva ai, github, servicenow)
                ├── GET /detail?project=NAME → JSON com items, taskItems, bugItems, iterMap
                ├── GET /api/team-capacity?project=NAME → JSON com developers, sprints, CompletedWork/RemainingWork
                ├── GET /ai/config           → retorna config completa da IA (endpoint, apiKey, model, apiVersion)
                ├── POST /ai/config          → salva credenciais da IA em config.json
                ├── POST /ai/test            → testa conexão com o provedor de IA
                ├── POST /ai/context         → retorna contexto rico dos projetos (respeita filtros de sprint)
                ├── POST /ai/chat            → envia mensagem para a IA e retorna resposta
                ├── GET /report?project=NAME&month=YYYY-MM → Review Mensal (HTML com payload injetado)
                ├── GET /report?project=NAME&month=YYYY-MM&refresh=1 → força recoleta (invalida cache)
                ├── GET /api/sn-config?project=NAME → retorna config SN global + assignmentGroup do projeto (senha nunca exposta)
                ├── POST /api/sn-config      → salva credenciais SN globais e/ou assignmentGroup por projeto
                ├── POST /api/sn-test        → testa conexão com o Service Now
                ├── GET /modules/*.js        → ES modules servidos dinamicamente de public/
                └── GET /i18n/*.json         → arquivos de tradução servidos de public/i18n/
```

---

## ⚙️ Configuração

| Parâmetro | Valor |
|-----------|-------|
| Porta local | `3030` |
| Arquivo de configuração | `config.json` (gerado automaticamente na primeira execução) |
| Autenticação | PAT (Personal Access Token) |
| Hot reload | `nodemon server.js` |

As credenciais são configuradas pela **tela de setup** na primeira execução e salvas em `config.json`. Não há valores hardcoded no código.

> ℹ️ **Permissões do PAT necessárias:**
> - `Work Items (Read)` — obrigatório para leitura de work items e backlogs
> - `Project and Team (Read)` — recomendado para listagem de projetos e dados de sprint

---

## 📦 Dependências

- **Node.js v18+** — instalado via `winget install OpenJS.NodeJS.LTS`
- **nodemon** — instalado via `npm install -g nodemon` (hot reload ao salvar)
- Sem pacotes externos no runtime — usa apenas módulos nativos (`http`, `https`, `dns`, `child_process`)

> **Nota:** `dns.setDefaultResultOrder("ipv4first")` é aplicado no início do script para evitar timeout em redes sem conectividade IPv6 (o DNS do Azure DevOps retorna endereços IPv6 primeiro).

---

## 🚀 Como executar

```bash
# Com hot reload (recomendado para desenvolvimento — não reabre o navegador a cada reinício):
nodemon server.js

# Sem hot reload (abre o navegador automaticamente):
node server.js

# O servidor sobe em:
# http://localhost:3030
```

## 📦 Como gerar o executável de distribuição

```bash
# Gera dist/app/server.exe (Node.js + app empacotados, ~37MB)
npm run build
```

A pasta `dist/app/` deve conter:
- `server.exe` — gerado pelo PKG (`npm run build`)
- `BacklogHealth.exe` — wrapper C# WPF, compilado via MSBuild do projeto `wrapper/BacklogHealth.csproj`
- `*.dll` / `runtimes/` — DLLs do WebView2 (não são regeneradas, já estão na pasta)

> **Importante:** o script `build` no `package.json` usa `--output dist/app/server.exe`. O wrapper C# lê `server.exe` do mesmo diretório em que está (`exeDir`), então ambos devem estar em `dist/app/`.
> Para distribuir, zipar toda a pasta `dist/app/` — o usuário executa `BacklogHealth.exe`.

---

## 📊 Dashboard Principal — O que é exibido

Todos os indicadores do dashboard principal são calculados considerando apenas **User Stories** (tipos: `User Story`, `Product Backlog Item`, `Requirement`).

| Métrica | Descrição |
|---------|-----------|
| **User Stories** | Total de US incluindo fechadas (Closed/Done/Resolved) |
| **Sem Estimativa** | US abertas sem Story Points |
| **Sem Responsável** | US abertas sem Assigned To |
| **Bugs Abertos** | Bugs com estado Active, In Progress ou New |

| Métrica | Alerta | Crítico |
|--------|--------|---------|
| US sem estimativa (Story Points) | > 30% do total de US abertas | > 50% do total de US abertas |
| US sem responsável | > 20% do total de US abertas | — |
| Bugs ativos | > 5 | > 10 |

### Status de saúde
- 🟢 **Saudável** — backlog bem estruturado
- 🟡 **Atenção** — pontos de melhoria identificados
- 🔴 **Crítico** — ação imediata necessária

> Passe o mouse sobre o badge de saúde para ver o motivo detalhado do alerta.

### Seção "Visualizar User Stories"
Cada card possui um botão toggle expansível que exibe apenas User Stories agrupadas por sprint, ordenadas cronologicamente (mais antiga primeiro). A tabela contém: Título, Status, Estimativa e Responsável. O contador de US é atualizado em tempo real ao filtrar por sprint.

---

## 🎨 Sistema de Temas

- **Botão ☀️/🌙** no header alterna entre tema escuro e claro
- **Persistência no `localStorage`** — tema sobrevive a F5, auto-refresh e reabertura do browser
- **Sem flash (FOUC)** — script inline no `<head>` aplica o tema antes da página renderizar
- **Tema escuro** é o padrão (`:root`)
- **Tema claro** sobrescreve via `[data-theme="light"]`

---

## 🔄 Atualização de dados

- **Botão ↻ Atualizar** — rebusca os dados sem recarregar a página
- **Auto-refresh** — timer regressivo de 5 minutos visível no header
- **Durante atualização** — conteúdo fica com opacidade reduzida
- **Após refresh** — filtros ativos são restaurados automaticamente

---

## 🔍 Filtro por Sprint / Iteration

Cada card de projeto possui um dropdown customizado com:

- **Checkbox por sprint** — seleção múltipla
- **Datas de início e fim** exibidas abaixo de cada opção
- **Sprint atual destacada em verde** com sufixo "📅 atual"
- **Sem seleção = todas as sprints**
- **Botão "✕ Limpar seleção"** dentro do painel
- **Filtros persistidos no `localStorage`** — sobrevivem a F5 e ao auto-refresh

### Como o filtro funciona
Ao selecionar sprints, o dashboard recalcula em tempo real:
- Linhas da tabela (mostra/oculta por `data-iteration`)
- Cabeçalhos de grupo
- Stats: User Stories, Sem Estimativa, Sem Responsável, Bugs
- Badge de saúde (🟢 🟡 🔴)

---

## 📅 Apresentação de Daily Standup

Acessado pelo botão **📅 Apresentar daily** no header, ou pelo botão **☰** na coluna Ações da tabela Distribuição por Sprint no modal de detalhes.

- Modal em carrossel — um slide por projeto monitorado
- Cada slide exibe dados **filtrados pela sprint atual** do projeto (ou pela sprint selecionada quando aberto via botão ☰)
- **Conteúdo por slide:**
  - Nome do projeto + badge de saúde (com tooltip)
  - Nome da sprint atual + período (data início – data fim)
  - Botão **📊 Burndown** para abrir o gráfico da sprint atual
  - Stats: User Stories, Sem Estimativa, Sem Responsável, Bugs Abertos
  - Stat **Bugs Abertos é clicável** — abre modal com lista de bugs da sprint (ver seção abaixo)
  - Tabela de User Stories da sprint atual (Título, Status, Estimativa, Responsável)
- Navegação por botões (← Anterior / Próximo →) ou teclas `←` `→`
- Fecha com ✕ ou tecla `Escape`
- **Abre maximizado por padrão** — botão ⤡ Restaurar disponível para reduzir

### Modal de Itens da Daily (componente reutilizável)

Todos os 4 stats do slide da Daily Standup são clicáveis e abrem o **Items Modal** (`#items-modal`), um componente genérico definido em `public/modules/itemsModal.js`.

| Stat clicado | Itens exibidos | Coluna Pts? |
|---|---|---|
| **User Stories** | Todos os `mainItems` da sprint | Sim |
| **No Estimate** | US abertas sem Story Points | Sim |
| **No Assignee** | US abertas sem responsável | Sim |
| **Open Bugs** | Todos os bugs (filtro inicial: Active/In Progress/New) | Não |

- Modal sobreposto ao daily (z-index: 700), fecha com ✕, clique fora ou `Escape`
- **Filtro de status** — dropdown com checkboxes por estado; pre-selecionado via `defaultFilters`; para bugs os estados ativos são pré-selecionados mas o usuário pode remover o filtro para ver todos
- **Tabela:** ID (link clicável), Título, Status (badge colorido), Pts (opcional), Responsável
- **Cores dos badges** — azul (Active/In Progress), verde (Closed/Done/Resolved), vermelho (Blocked), cinza (demais)
- Dados provêm do `data-items` do card (`id`, `title`, `url`, `state`, `assignedTo` adicionados ao itemsJson no `projectService.js`)

#### API do `itemsModal.js`

```js
openItemsModal({ title, items, showPts?, defaultFilters? })
// defaultFilters: string[] — estados pré-selecionados no filtro de status (ex: ACTIVE_BUG_STATES)

closeItemsModal()
closeItemsModalOverlay(event)
toggleItemsFilterDropdown()   // abre/fecha o dropdown de filtro de status
toggleItemsFilter(state)      // marca/desmarca um estado no filtro
clearItemsFilter()            // limpa todos os filtros de status
```

Para usar em qualquer outro contexto, basta importar `openItemsModal` e passar os itens desejados.

---

## 📊 Dashboard de Detalhes do Projeto

Acessado pelo botão **📊 Detalhes do projeto** em cada card.

- Busca dados via `/detail?project=NAME` com múltiplas queries ao Azure DevOps
- **Respeita os filtros de sprint ativos** na tela principal — todos os indicadores são filtrados por sprint no cliente antes de agregar
- Modal com botão **↻** para atualizar os dados sem fechar o modal
- Modal com botão **⤢ Maximizar / ⤡ Restaurar**
- Fecha com ✕, clique fora do modal ou tecla `Escape`

### Seções do painel de detalhes

| Seção | Conteúdo |
|-------|----------|
| **Resumo Geral** | Total itens, User Stories, Story Points, Pts Entregues, Em Andamento, Novos, Sem Estimativa, Hrs Tasks, Hrs Bugs |
| **Indicadores de Saúde** | Taxa de Conclusão (US), Em UAT (US), Taxa de Bugs (hrs bugs/total hrs), Cobertura de Estimativas (US), Esforço Economizado (tasks) |
| **US por Status** | Barras horizontais com todos os estados — filtrado apenas por User Stories |
| **US por Responsável** | Barras horizontais com membros da equipe — filtrado apenas por User Stories |
| **Distribuição por Sprint** | Tabela: Sprint, Período, User Stories, Story Points, Concluídos (%), Em UAT (%), Ações (botão burndown 📊 + botão ver sprint ☰) — ordenada por data crescente; seletor de colunas visíveis via dropdown com ícone ⊞ no cabeçalho da seção |
| **Cronograma de Sprints** | Gantt visual com blocos posicionados por data, barra proporcional à qtd de US, marcador "hoje" |

### Cálculo dos indicadores de saúde

| Indicador | Fórmula |
|-----------|---------|
| Taxa de Conclusão | US com estado Closed/Done/Resolved ÷ total de US |
| Em UAT | US com estado UAT ÷ total de US |
| Taxa de Bugs | Hrs Bugs ÷ (Hrs Tasks + Hrs Bugs) |
| Cobertura de Estimativas | US com Story Points ÷ total de US |
| Esforço Economizado | (OriginalEstimate − CompletedWork) ÷ OriginalEstimate × 100 — positivo = economizou horas; negativo = estourou; `—` quando sem dados |

### Queries ao Azure DevOps no `/detail`

As 3 queries WIQL + fetchIterMap rodam em paralelo. Em seguida, as 3 paginações também rodam em paralelo.

| Query | Filtro | Finalidade |
|-------|--------|------------|
| WIQL principal | State NOT IN (Done, Removed) | Items incluindo Closed para indicadores e distribuição |
| WIQL tasks | Sem filtro de estado | CompletedWork + IterationPath para Hrs Tasks |
| WIQL bugs | Sem filtro de estado | CompletedWork + IterationPath + contagem total |

---

## 📈 Gráfico de Burndown por Sprint

Acessado via botão **📊** na coluna "Ações" da tabela de Distribuição por Sprint, ou via botão **📊 Burndown** no slide da Daily Standup.

- **Modal expandível** com as mesmas opções dos outros modais (maximizar, fechar, Escape)
- **Gráfico SVG** sem dependências externas
- **Linha ideal** (tracejada cinza): decaimento linear do total de US até zero ao longo do período
- **Linha real** (verde): progresso de US concluídas até a data atual
- **Marcador "hoje"** (vermelho): visível apenas quando hoje está dentro do período da sprint
- **Cards de resumo:** Total US, Concluídas, Restantes, Progresso %

### Como o burndown é calculado

| Dado | Fonte |
|------|-------|
| Total de US | `data-sprints` serializado na tabela de distribuição |
| US concluídas | US com estado Closed/Done/Resolved na sprint |
| Datas da sprint | `iterMap` retornado pelo endpoint `/detail` |
| Progresso real | Distribuição linear das US concluídas até hoje |

> **Nota:** O gráfico representa o progresso de User Stories (não Story Points). A linha real é uma estimativa linear — não reflete a ordem exata em que os itens foram concluídos.

---

## 🔌 APIs do Azure DevOps utilizadas

| API | Endpoint | Finalidade |
|-----|----------|------------|
| Projects | `/_apis/projects` | Lista todos os projetos acessíveis pelo PAT |
| Teams | `/_apis/projects/{project}/teams` | Lista times por projeto (detecta multi-time no setup) |
| WIQL | `/{project}/_apis/wit/wiql` | Consulta work items por critérios |
| Work Items | `/{project}/_apis/wit/workitems?ids=...` | Detalhes dos items em lotes de 200 (até 500) |
| Classification Nodes | `/{project}/_apis/wit/classificationnodes/iterations?$depth=10` | Árvore completa de sprints com datas (independe de time) |
| Team Iterations | `/{project}/{team}/_apis/work/teamsettings/iterations` | Sprints do time com `timeFrame:"current"` (usado quando time está configurado) |

> **Nota:** O `fetchIterMap` usa a seguinte precedência: (1) endpoint de time específico se `team` estiver configurado; (2) `classificationnodes/iterations` para cobertura total; (3) fallback por convenção de nome (`{projeto} Team`).

---

## 🔧 Modo de item por projeto (User Story vs Task)

Cada projeto pode ser configurado na tela de setup com um **tipo de item principal**:

| Modo | Tipos monitorados | Campo de estimativa | Label no card |
|------|------------------|---------------------|---------------|
| **User Story** (padrão) | User Story, Product Backlog Item, Requirement | Story Points | "User Stories" |
| **Task** | Task | RemainingWork (fallback: OriginalEstimate) | "Tasks" |

- O `workItemType` é salvo em `config.json` por projeto e lido via `getProjectConfig()` em `config.js`
- `projectService.js` adapta a query WIQL e os campos buscados conforme o modo
- O card HTML recebe `data-workitemtype` para que `filters.js` e `detail.js` adaptem métricas no cliente
- O modal de detalhes, o Daily Standup e os labels do dashboard principal exibem "Tasks" / "Horas" em vez de "User Stories" / "Story Points" quando em modo Task
- `getItemTypes(workItemType)` e `getEstimateField(workItemType)` em `constants.js` são a fonte única dessa lógica no frontend

---

## 🗓️ Delivery Plan

Acessado pelo botão **🗓️ Delivery Plan** no header, ao lado do botão de Daily Standup.

- **Abre maximizado por padrão** — botão ⤡ Restaurar disponível para reduzir
- **Timeline compartilhada** — todos os projetos exibidos em linhas sobrepostas no mesmo eixo de tempo
- Cada linha exibe o nome do projeto (coluna fixa à esquerda, `position: sticky`) e os blocos de sprint posicionados proporcionalmente por data
- **Dentro de cada bloco:** nome da sprint + datas de início/fim no formato `dd/mm` (sem ano) em segunda linha; tooltip com data completa
- **Cores por estado** — passada (cinza), atual (verde), futura (azul); adaptadas ao tema claro/escuro via classes CSS
- **Marcador "hoje"** como linha vertical em cada linha de projeto
- **Filtro de projetos** — painel com checkboxes para mostrar/ocultar projetos individualmente, com "Selecionar todos" e "Limpar"
- **Herda filtros de sprint** do dashboard principal — se um projeto tiver sprints filtradas, apenas essas sprints aparecem no Delivery Plan
- Dados lidos do atributo `data-itermap` dos cards (sem nova chamada à API)

---

## ➕ Como adicionar/remover projetos monitorados

Clique no botão **⚙️** no header do dashboard para acessar a tela de configurações. Lá você pode:
- Alterar a organização ou o PAT
- Recarregar a lista de projetos disponíveis
- Marcar/desmarcar os projetos a monitorar (busca com autocomplete)

As alterações são salvas em `config.json` e o dashboard é atualizado automaticamente.

> **Remoção rápida:** cada card do dashboard tem um botão 🗑️ que remove o projeto do monitoramento diretamente, sem precisar entrar na tela de configurações.

---

## 👥 Monitoramento por Time (Multi-time)

Projetos do Azure DevOps com **mais de um time** são expandidos automaticamente na tela de configuração: cada time aparece como uma entrada separada no formato `Projeto — Nome do Time`.

- A seleção é feita por time, não por projeto — cada entrada monitora apenas as sprints e work items daquele time
- O **display name** do projeto no dashboard é `"Projeto - Nome do Time"` (com hífen)
- O campo `team` é salvo em `config.json` por entrada: `{ name: "AMS", team: "AMS Backend", workItemType: "User Story" }`
- O `fetchIterMap` usa o endpoint específico do time (`teamsettings/iterations`) quando `team` está definido, garantindo `timeFrame:"current"` preciso
- Os work items são filtrados no servidor para exibir apenas os que pertencem às sprints do time configurado
- A identificação única usada em `data-project`, `/detail?project=` e filtros é o **display name** (`"AMS - AMS Backend"`)

### Estrutura da chave no setup

| Contexto | Formato da chave |
|---|---|
| Checkbox no DOM | `"AMS\|AMS Backend"` (pipe como separador) |
| Enviado ao servidor (`POST /setup`) | `"AMS:User Story:AMS Backend"` |
| Salvo em `config.json` | `{ name, workItemType, team }` |
| Display name no dashboard | `"AMS - AMS Backend"` |

---

## ✏️ Apelidos de Projeto (Alias)

O usuário pode customizar o nome exibido de qualquer projeto diretamente no dashboard, sem alterar a configuração do servidor.

- Botão **✏️** aparece ao passar o mouse no cabeçalho do card
- Clique abre um campo de edição inline; **Enter** salva, **Escape** cancela
- O apelido é salvo em `localStorage['projectAliases']` como `{ "displayName": "AliasCustomizado" }`
- Apagando o campo (texto vazio) restaura o nome original
- O nome original é sempre preservado internamente — usado em chamadas de API, filtros, `data-project` e identificação no servidor
- O apelido é aplicado em: **dashboard principal**, **modal de detalhes**, **Daily Standup** e **Delivery Plan**
- `applyAliases()` é chamado na inicialização e após cada refresh automático (já que o `#content` é reconstruído)

---

## 🗑️ Remoção Rápida de Projeto

O botão **🗑️** no cabeçalho de cada card permite remover o projeto do monitoramento sem abrir a tela de configurações.

- Exibe confirmação antes de executar
- Chama `POST /api/remove-project` com o display name do projeto
- O servidor remove a entrada de `config.json`, reconstrói o HTML cacheado e retorna `{ ok: true }`
- O card é removido do DOM imediatamente após confirmação do servidor

---

## 💬 Histórico de decisões

| # | Decisão | Motivo |
|---|---------|--------|
| 1 | Artifact React → script local | CORS bloqueava chamadas diretas ao Azure DevOps |
| 2 | Sem pacotes externos | Zero dependências, roda em qualquer Node.js |
| 3 | `/refresh` retorna HTML completo | Atualiza conteúdo sem recarregar a página |
| 4 | `localStorage` para filtros | Persistência sem backend, zero custo |
| 5 | `/detail` endpoint separado | Busca todos os estados sem impactar performance do dashboard principal |
| 6 | `{projeto} Team` sem usar `_apis/teams` | PAT não tem permissão de leitura de times |
| 7 | `nodemon` com `NO_OPEN_BROWSER=1` | Evita abrir nova aba do navegador a cada hot reload |
| 8 | CSS Custom Properties para temas | Permite trocar todo o visual com um único atributo `data-theme` |
| 9 | Script inline no `<head>` para tema | Evita FOUC (flash do tema errado antes do JS carregar) |
| 10 | Credenciais em `config.json` | Segurança e portabilidade — cada usuário configura suas próprias credenciais |
| 11 | Tela de setup com autocomplete | Valida PAT antes de salvar e lista projetos reais disponíveis |
| 12 | `dns.setDefaultResultOrder("ipv4first")` | Azure DevOps retorna IPv6 primeiro; sem IPv6 na rede causava ETIMEDOUT |
| 13 | Métricas baseadas apenas em User Stories | Alinhamento com a realidade do backlog — Tasks e Bugs distorcem os indicadores |
| 14 | Queries separadas para Tasks/Bugs (sem filtro de estado) | CompletedWork e contagem total precisam incluir itens já fechados |
| 15 | Filtragem por sprint no cliente (detail) | Evita passar parâmetros de sprint para o servidor — dados brutos com IterationPath são filtrados no JS |
| 16 | `SELECTED_SET` para seleção de projetos no setup | Seleções persistiam ao filtrar a lista — DOM era reconstruído e perdia o estado dos checkboxes ocultos |
| 17 | Separação em módulos (config, azureClient, projectService, server) | Arquivo único de 1500+ linhas dificultava manutenção — cada módulo tem responsabilidade clara |
| 18 | CSS e JS do browser em `public/` servidos como arquivos estáticos | Permite syntax highlighting no editor; navegador faz cache automaticamente |
| 19 | HTML em `views/` com tokens `{{TOKEN}}` e `renderTemplate` simples | Separa estrutura de apresentação da lógica sem adicionar dependência de template engine |
| 20 | Templates lidos uma vez no startup (`fs.readFileSync`) | Evita I/O a cada request em ambiente de desenvolvimento local |
| 21 | Incluir US Closed no total do dashboard principal | Total de US deve refletir o escopo completo do projeto, não apenas os itens abertos |
| 22 | Paginação em lotes de 200 (até 500 itens) no `fetchProject` | Limite de 100 itens fazia US Closed excluírem US abertas do resultado quando o projeto tinha muitos itens |
| 23 | Bugs contados apenas com estado Active/In Progress/New | Bugs fechados não representam risco ativo — incluí-los distorcia o indicador de saúde |
| 24 | Tooltip no badge de saúde com motivo do alerta | Usuário precisava entender o motivo sem abrir os detalhes — título HTML com a lista de razões resolve sem adicionar complexidade |
| 25 | Daily Standup como carrossel de slides | Facilita a apresentação em reuniões — um projeto por vez, navegável por teclado |
| 26 | Daily filtra dados pela sprint atual | A daily é focada no que está acontecendo agora — mostrar todas as sprints misturaria contextos |
| 27 | Burndown em SVG puro sem bibliotecas | Zero dependências — gerado diretamente no browser com `viewBox` e `polyline` |
| 28 | `data-sprints` serializado na tabela de distribuição | Permite abrir o burndown de qualquer sprint sem nova chamada ao servidor quando os dados já estão carregados no modal de detalhes |
| 29 | `openBurndownFromDaily` faz fetch ao abrir | Daily não tem `iterMap` com datas — buscar os dados sob demanda é mais simples que pré-carregar para todos os projetos |
| 30 | `_showBurndownModal` como helper compartilhado | `openBurndown` (tabela) e `openBurndownFromDaily` (daily) precisam da mesma lógica de exibição — centralizar evita duplicação |
| 31 | ES Modules nativos no browser (`type="module"`) | Elimina escopo global monolítico de 866 linhas — cada módulo tem escopo próprio, zero bundler, zero dependências |
| 32 | `app.js` como entry point que expõe `window.X` | HTML usa inline handlers (`onclick="fn()"`); ES modules têm escopo local — expor ao window mantém compatibilidade sem alterar templates |
| 33 | `utils/` no backend (health, paginate, iterMap) | Lógica de paginação e iterMap estava duplicada em `fetchProject` e `fetchProjectDetail`; `calcHealth` estava duplicado entre servidor e cliente |
| 34 | `buildSprintData` em `utils.js` (frontend) | Computação de `bySprint` estava duplicada em `buildDetailHTML` e `openBurndownFromDaily` — fonte única garante consistência |
| 35 | Remoção de `allWiql`/`allItems` | Query era usada para "Itens por Tipo" que foi removido — eliminar reduz uma chamada à API por abertura do modal de detalhes |
| 36 | Paralelização das queries no `fetchProjectDetail` | 3 WIQLs + iterMap agora rodam em paralelo; em seguida 3 paginações em paralelo — reduz tempo de carregamento proporcional ao número de queries |
| 37 | `server.js` serve `public/` dinamicamente | Lista estática de arquivos precisaria de atualização manual a cada novo módulo — handler dinâmico resolve qualquer arquivo de `public/` sem manutenção |
| 38 | Wrapper WebView2 (C# WPF .NET Framework 4.8) | Usuário final precisa de um `.exe` para clicar e rodar — WebView2 abre janela nativa sem instalar Node.js, .NET ou browser; .NET Framework 4.8 já vem no Windows 10/11 |
| 39 | `server.exe` gerado via PKG | Empacota Node.js runtime + toda a aplicação em um único executável — zero instalação para o usuário final |
| 40 | i18n com JSON por idioma + `data-i18n` + `t()` | Suporte a PT/EN/ES sem bibliotecas externas — arquivos JSON em `public/i18n/`, atributos `data-i18n` no HTML, função `t(key, vars)` em `i18n.js` compartilhado |
| 41 | Idioma padrão: inglês (`en`) | Aplicação usada por times com usuários internacionais — inglês como padrão garante melhor acessibilidade; preferência persiste no `localStorage('lang')` |
| 42 | `parseOrgInput` em `config.js` | Organizações com URL `xxx.visualstudio.com` (legado VSTS) têm estrutura de URL diferente de `dev.azure.com/org` — detectar e normalizar automaticamente elimina fricção na configuração |
| 43 | `baseUrl` salvo no `config.json` | Permite que `azureClient.js` use a URL base correta sem precisar redetectar o formato a cada chamada — compatibilidade retroativa: configs sem `baseUrl` recebem `dev.azure.com/{org}` |
| 44 | `noEst` no detalhe filtrado por `usItems` | Tasks não têm Story Points por design — contá-las em "Sem Estimativa" distorcia o indicador de cobertura de estimativas |
| 45 | Delivery Plan como modal com timeline compartilhada | Necessidade de visualizar o cronograma de todos os projetos em uma única tela — `data-itermap` nos cards evita nova chamada à API; filtros de sprint do dashboard são herdados via `localStorage` |
| 46 | Classes CSS para estados de sprint (`.tl-block--past/future/current`, `.dp-block--past/future/current`) | Cores hardcoded no JS não respondem ao tema — classes CSS com overrides `[data-theme="light"]` garantem contraste adequado em ambos os temas |
| 47 | Datas de início/fim em formato curto (`dd/mm`) dentro dos blocos de sprint | Exibir dia e mês dentro do bloco ocupa pouco espaço e dispensa hover; `fmtD` mantém o ano no tooltip para referência completa |
| 48 | Botão Refresh com ícone apenas (`↻`) | Reduz espaço no header; `title` traduzido via `data-i18n-title` mantém acessibilidade; `timer.js` atualiza o `title` durante o refresh em vez do `textContent` |
| 49 | `workItemType` por projeto (`User Story` ou `Task`) | Times que trabalham com Tasks em vez de User Stories precisam de estimativas em horas (RemainingWork/OriginalEstimate) em vez de Story Points — modo configurável na tela de setup; `getItemTypes()` e `getEstimateField()` em `constants.js` centralizam a lógica |
| 50 | `getProjectConfig()` em `config.js` | `fetchProjectDetail` precisa saber o `workItemType` do projeto ao ser chamado — buscar da config evita passar o tipo como parâmetro pela cadeia de chamadas |
| 51 | `data-workitemtype` no card HTML | `filters.js` e `detail.js` precisam saber o modo do projeto no cliente sem nova chamada ao servidor — atributo no DOM resolve sem estado global |
| 52 | `aiClient.js` separado do `server.js` | Lógica de detecção de provedor (Foundry vs Azure OpenAI vs genérico), construção de URL/headers/body e parsing de resposta ficaria grande demais inline — módulo próprio mantém `server.js` focado em roteamento |
| 53 | Sistema prompt injetado como prefixo da mensagem do usuário (Foundry) | Azure AI Foundry agents rejeitam `instructions`, `temperature`, `model` e role `system` na Responses API — única forma de passar contexto é prefixar a última mensagem do usuário |
| 54 | Contexto reenviado a cada mensagem (não apenas na primeira) | Foundry agents não persistem system context entre turnos de uma mesma sessão — sem reenviar, a IA perde acesso aos dados dos projetos a partir da segunda mensagem |
| 55 | `/ai/context` computa a mesma estrutura do modal de detalhes | Usuário precisava que a IA respondesse com a mesma riqueza de dados do "Detalhes do Projeto" — reusar `fetchProjectDetail` e agregar no servidor garante consistência sem duplicar lógica |
| 56 | Filtros de sprint normalizados no servidor (`f.split('\\').pop()`) | `localStorage` armazena o caminho completo da iteration (`Projeto\\Sprint 108`); API do Azure DevOps usa o mesmo formato — comparar apenas o último segmento resolve a divergência sem alterar o formato salvo |
| 57 | `_loadRichContext` em `copilot.js` exibe indicador de carregamento | Buscar detalhes de todos os projetos pode levar vários segundos — feedback visual imediato evita que o usuário envie mensagem antes dos dados estarem disponíveis e receba resposta genérica |
| 58 | `_buildContext()` como fallback DOM-based | Se `/ai/context` falhar, o chat ainda funciona com dados já presentes nos `data-*` dos cards do dashboard — degradação graciosa sem bloquear o usuário |
| 59 | Botão ☰ "Ver sprint" na tabela de Distribuição por Sprint | Permite abrir o Daily Standup de qualquer sprint diretamente do modal de detalhes, sem precisar usar o carrossel do header — abre o modal focado no projeto e sprint selecionados |
| 60 | `buildDailySlide(card, forcedSprintKey)` com parâmetro opcional | Reutiliza toda a lógica do slide da daily com override de sprint — sem `forcedSprintKey` o comportamento original é preservado; com ele, nome/datas são lidos do `data-itermap` do card |
| 61 | `Microsoft.VSTS.Common.StackRank` no Daily Standup | US na daily eram exibidas sem ordem definida — buscar o campo `Order` da API e adicionar `data-order` nos `<tr>` permite ordenação crescente por backlog order sem custo adicional |
| 62 | `classificationnodes/iterations` como fonte primária do `fetchIterMap` | Projetos com múltiplos times retornavam sprints sem data pois o endpoint `teamsettings/iterations` é específico por time — `classificationnodes` retorna toda a árvore de iterations independente de time com permissão apenas de `Work Items (Read)` |
| 63 | Monitoramento por time com campo `team` em `config.json` | Projetos com N times precisam de visibilidade isolada por time — expandir no setup como `Projeto — Time` e filtrar items por `iterMap` do time no servidor resolve sem nova API |
| 64 | Display name como identificador único em ambiente multi-time | `name` sozinho é ambíguo quando há duas entradas do mesmo projeto — usar `"Projeto - Time"` como `data-project` e chave em `/detail?project=` garante unicidade sem alterar nomes no Azure DevOps |
| 65 | `getDisplayName(p)` exportado de `config.js` | Cálculo do display name estava sendo duplicado em `server.js`, `projectService.js` e `config.js` — fonte única evita divergência |
| 66 | Alias de projeto em `localStorage` via `alias.js` | Nome técnico do projeto (ex: `"AMS - AMS Backend"`) pode ser difícil de comunicar — alias no cliente preserva a chave interna e substitui apenas a camada visual sem alterar server, filtros ou API |
| 67 | `applyAliases()` chamado após refresh | O refresh reconstrói `#content` do zero, perdendo os `textContent` alterados — chamar `applyAliases()` em `timer.js` após `initFilters()` garante que aliases persistam entre atualizações |
| 68 | `POST /api/remove-project` como endpoint de remoção rápida | Remover projeto exige editar `config.json` e reconstruir cache — endpoint dedicado encapsula essa lógica e permite remoção direta do card sem abrir o setup |
| 69 | `data-i18n-title` em todos os tooltips do dashboard | Tooltips hardcoded em português não respondem à troca de idioma — `applyTranslations()` já processa `data-i18n-title`, bastava adicionar o atributo e as keys nos JSONs |
| 70 | Toggle grid/lista na `.cards-toolbar` acima dos cards | Botão de alternância de layout estava na topbar misturado com controles globais — movê-lo para uma barra dedicada acima dos cards torna a ação mais próxima do conteúdo que afeta |
| 71 | Team Capacity como view alternativa no `main-content` | Tela independente sem modal evita sobrepor o dashboard — show/hide de `#tc-view` vs `#content` + `.cards-toolbar` mantém o layout da sidebar sem nova rota ou reload |
| 72 | `style.display = 'block'` explícito no `#tc-view` | `style.display = ''` remove o inline style mas o CSS `#tc-view { display: none }` ainda vence — atribuir `'block'` garante que o elemento apareça independente da folha de estilo |
| 73 | `localStorage['activeView']` salvo antes do `location.reload()` no `setLocale()` | Troca de idioma recarrega a página e perdia a view TC ativa — salvar antes do reload e restaurar em `app.js` após inicialização preserva o contexto do usuário |
| 74 | `GET /ai/config` retorna credenciais completas | Endpoint retornava apenas `{ configured: bool }` — formulário de configuração abria sempre vazio, obrigando re-digitação após restart; retornar endpoint/apiKey/model/apiVersion permite pré-preenchimento |
| 75 | Daily Standup e Delivery Plan abrem maximizados por padrão | Modais eram abertos em tamanho reduzido exigindo clique manual em "Maximizar" a cada uso — `classList.add('maximized')` no `open` e ícone já iniciado como ⤡ eliminam esse passo repetitivo |
| 76 | Título "Health Intelligence" removido da topbar; meta info movida para sidebar | Topbar com título duplicava a identidade visual já presente na sidebar logo — remover libera espaço e concentra branding no sidebar; `{{SUBTITLE}}` (N projects · Org) fica visível sem ocupar área de ação |
| 77 | `.sidebar-logo-row` como wrapper interno + `.sidebar-logo` como coluna | Sidebar logo usava `flex-row` direto — para posicionar o meta abaixo do ícone+texto precisava de nível extra sem quebrar o alinhamento horizontal do ícone com o nome |
| 78 | `min-width: 0` em `.cards-grid > *` | CSS Grid com `1fr` não restringe o tamanho mínimo dos filhos por padrão — sem `min-width: 0` os cards transbordavam à direita no modo grid |
| 79 | Remoção de `overflow: hidden` do `.cards-grid .card` | Adicionado para conter overflow dos cards, mas cortava o dropdown de seleção de sprint (`position: absolute`) — `min-width: 0` resolve o overflow sem afetar elementos posicionados |
| 80 | `.select-panel` com `z-index: 400` + `.drop-up` variant | Dropdown de sprint ficava cortado pelo card vizinho e inacessível quando havia muitas sprints — z-index alto garante sobreposição; `drop-up` abre para cima quando o espaço abaixo é insuficiente |
| 81 | Nomes de sprint exibidos com `.split("\\").pop()` | Iteration paths no Azure DevOps seguem o formato `Projeto\Time\Sprint` — exibir o caminho completo misturava o nome do time no label; `.pop()` extrai apenas o segmento final |
| 82 | `npm run build` com `--output dist/app/server.exe` | Script anterior gerava `dist/BacklogHealth.exe` (raiz errada) — wrapper C# espera `server.exe` no mesmo diretório que ele (`dist/app/`); corrigir o output path garante que o build seja diretamente utilizável |
| 83 | Stats do card em grade 2×3: Scope row (US · SP · Progress) + Problems row (Bugs · Sem Estimativa · Sem Responsável) | Quatro stats em linha única ficavam apertados no modo grid; separar em duas linhas temáticas melhora leitura e permite adicionar Story Points e Project Progress sem sobrecarga visual |
| 84 | Story Points somados de todos os `mainItems` (independente de sprint) | SP representa o escopo total do projeto, não apenas da sprint filtrada — coerente com o Project Progress que também usa o total do backlog |
| 85 | Project Progress = US fechadas ÷ total de US do backlog | Diferente do burndown (por sprint), o Progress mostra o avanço geral do projeto — inclui US Closed para refletir o histórico completo |
| 86 | Token GitHub hardcoded em `config.json`, sem UI de configuração para o usuário | Feedback vai para um repo centralizado do desenvolvedor — expor configuração ao usuário criaria risco de substituição indevida do token e complexidade desnecessária na UI |
| 87 | Endpoint `POST /api/feedback` cria GitHub Issue com label baseado no tipo | Mapear tipo do form (bug/suggestion/help/other) para label do GitHub permite filtrar issues por categoria no repositório sem pós-processamento manual |
| 88 | Modal de sucesso separado após criar a issue | Fechar o form e abrir um segundo modal com link clicável para o GitHub é mais limpo do que exibir uma mensagem inline e fechar automaticamente após 3s — o usuário pode navegar até a issue no próprio tempo |
| 89 | Coluna "Em UAT %" na tabela de Distribuição por Sprint | Visibilidade do % de US em UAT por sprint sem abrir o modal de detalhes completo — `usUAT` acumulado em `buildSprintData` junto com `usClosed`, mantendo fonte única de dados |
| 90 | Seletor de colunas como dropdown com ícone ⊞ no cabeçalho da seção | Checkboxes inline ocupavam espaço permanente e eram visualmente poluídos — dropdown posicionado à direita do título da seção mantém a área limpa; estado persistido em `localStorage['sprintColVisibility']` |
| 91 | `AbortController` para listeners do seletor de colunas | Cada abertura do modal de detalhes recria o HTML e registrava novos listeners no `document` para fechar o dropdown — `AbortController` descarta os listeners anteriores sem acúmulo |
| 92 | Indicador "Esforço Economizado" em `buildDetailHTML` | `(OriginalEstimate − CompletedWork) / OriginalEstimate × 100` mede eficiência das tasks: positivo = economizou, negativo = estourou; `OriginalEstimate` adicionado ao `workFields` do `fetchProjectDetail` e mapeado em `taskItems` |
| 93 | Override manual de `OriginalEstimate` com edição inline no anel | Azure DevOps nem sempre tem `OriginalEstimate` preenchido — campo inline no sub-texto do anel "Esforço Economizado" (clique no ícone ✏) salva override em `localStorage['origEstOverride::NomeProjeto']`; limpar volta ao valor calculado da API; ícone azul indica override ativo |
| 94 | `POST /setup` preserva campos existentes do `config.json` via spread | `saveConfig({ org, baseUrl, pat, projects })` criava objeto do zero, descartando `ai`, `github` e qualquer outro campo já salvo — toda reconfiguração de projetos apagava as credenciais da IA; corrigido com `{ ...existing, org, baseUrl, pat, projects }` |
| 95 | `id`, `title`, `url`, `assignedTo` adicionados ao `itemsJson` em `projectService.js` | Modal de bugs da Daily precisava exibir nome, link e responsável de cada bug — campos inexistentes no payload mínimo original (que só tinha `type`, `state`, `iteration`, `pts`, `assigned` booleano) |
| 96 | `itemsJson` escapa `'` com `&#39;` além de `<` | `data-items='...'` usa aspas simples como delimitador de atributo — títulos de work items com apóstrofo quebravam o JSON silenciosamente; `itermap` já fazia o mesmo escape |
| 97 | `_slidesData[]` acumulado em `buildDailySlide` e resetado em `openDaily`/`openDailyForSprint` | Items Modal precisa saber os dados de cada slide sem nova chamada à API — array paralelo a `_dailySlides` preenchido em ordem durante o `.map()` garante índice correto sem prop drilling |
| 98 | `itemsModal.js` como componente genérico em vez de modal acoplado ao daily | Bugs modal foi o primeiro uso; User Stories, No Estimate e No Assignee precisavam do mesmo padrão — componente isolado com API `openItemsModal({ title, items, showPts, defaultFilters })` permite reuso em qualquer contexto futuro sem duplicar HTML/CSS/lógica |
| 99 | `defaultFilters` em vez de `toggleBtn` no `itemsModal` | O toggle "Active only / Show all" foi substituído por um filtro de status genérico com checkboxes — mais flexível e consistente com o padrão de outros dropdowns da aplicação; `defaultFilters: string[]` pré-seleciona estados sem acoplar lógica de negócio ao modal |
| 100 | `openDailyStat(stat)` como ponto de entrada único para todos os stats clicáveis | Quatro `onclick` diferentes no HTML gerado apontariam para quatro funções no `window` — um único dispatcher com string (`'us'`, `'noEst'`, `'noResp'`, `'bugs'`) reduz a superfície da API global e facilita adicionar novos stats futuros |
| 101 | Filtro de status com dropdown de checkboxes no `itemsModal.js` | Substituiu o toggle binário "Active only / Show all" — dropdown com todos os estados presentes nos itens permite qualquer combinação de filtros sem novo código por chamador; `defaultFilters` pré-seleciona os estados relevantes (ex: bugs ativos) |
| 102 | Fix: listener global do `filters.js` fechava o dropdown do `itemsModal` imediatamente | `filters.js` tem `document.addEventListener('click', ...)` que fecha todos `.select-panel.open` quando o clique não está dentro de `.custom-select`; o container do items modal usa `.items-filter-select` (sem `.custom-select`) — adicionada verificação `!e.target.closest('.items-filter-select')` para excluí-lo do fechamento automático |
| 103 | `openCardStat(statEl, stat)` em `filters.js` para stats clicáveis no dashboard principal | Todos os 4 stats do card (User Stories, Bugs, No Estimate, No Assignee) agora abrem o `itemsModal`; a função lê `data-items` do card, aplica o filtro de sprint ativo do `localStorage` e computa o subconjunto correto — centralizado em `filters.js` pois já tem acesso a `getItemTypes`, `CLOSED_STATES` e `ACTIVE_BUG_STATES` |
| 104 | `openDetailStat(stat)` e `_ctx` em `detail.js` para stats clicáveis no modal de detalhes | Cards do Resumo Geral (User Stories, Novos, Sem Estimativa) no modal de detalhes agora abrem o `itemsModal`; `_ctx` armazena `{ filtered, workItemType }` após `loadDetailData` para que `openDetailStat` acesse os itens já filtrados por sprint sem nova chamada à API |
| 105 | `refreshDaily()` em `daily.js` — recarrega dados do Azure sem fechar a Daily | Botão `↻` no header do daily chama `doRefresh()` (que já busca dados frescos e reconstrói `#content`), depois reconstrói os slides com os novos cards preservando o índice atual; botão fica desabilitado durante o refresh |
| 106 | `_buildDailyTrack()` + estado `_dailyMode/_dailyForcedProject/_dailyForcedSprint` em `daily.js` | `openDaily` e `openDailyForSprint` tinham lógica de construção de slides duplicada; `_buildDailyTrack()` centraliza a construção respeitando o modo atual — necessário para `refreshDaily()` reconstruir corretamente independente de como a daily foi aberta |
| 107 | Stats Progress (closedCount/total) e Story Points removidos do card do dashboard | Informações redundantes com a barra de percentual e o modal de detalhes — simplifica o card e melhora legibilidade; `card-pts` e `card-progress` removidos do HTML gerado e dos cálculos em `applyFilter` |
| 108 | Filtro de sprint do dashboard redesenhado para match com o `itemsModal` | Trigger usa underline (`border-bottom`) em vez de caixa com borda completa; label uppercase/bold; painel com `border-radius: 8px` completo e `top: calc(100% + 6px)` — consistência visual entre todos os dropdowns da aplicação |
| 109 | URL do work item em `itemsJson` construída a partir de `baseUrl` em vez de `_links` | `paginatedItems` usa `&fields=` na query da API — quando campos são explicitados o Azure DevOps omite `_links` da resposta; construir `${baseUrl}/_workitems/edit/${id}` diretamente garante URL válida sem custo de payload extra; padrão já usado nas linhas da tabela (`wiUrl`) |
| 110 | Link clicável na coluna ID do `itemsModal` — `color: var(--c-blue)` | `.daily-id-cell a` (classe reutilizada do daily) tinha `color: var(--text-faint)` que deixava o link invisível; override específico `.items-modal-table .daily-id-cell a` aplica cor azul sem afetar o estilo da daily |
| 111 | `_fetchTestPoints` com `isRecursive=true` e paginação própria | Test points ficam aninhados em suites filhas — sem `isRecursive=true` apenas o suite raiz era retornado; paginação de 1000/req com limite de 10.000 cobre projetos grandes sem risco de loop infinito |
| 112 | Campo `testCaseReference` (não `testCase`) na Testplan API | A Testplan API v7.0 retorna `testCaseReference` com `id` e `name` do caso de teste — `testCase` estava undefined, causando nomes `"—"` no painel; descoberto via `console.log` do primeiro ponto e removido após fix |
| 113 | Contadores dos cards independentes, barra com exclusividade mútua | Usuário quer "Em andamento" = todos os planos Active (inclusive os que têm falhas); barra precisa somar 100% — dois conjuntos de variáveis: `plansDone/Failed/WIP/NotStarted` para os cards, `barDone/Failed/WIP/NotStarted` com prioridade exclusiva para os segmentos da barra |
| 114 | Pills com toggle para filtro de resultado dos TCs | `<select>` nativo era inconsistente com o padrão de dropdowns da app; pills permitem ativar/desativar múltiplos outcomes sem abrir dropdown — `uatFilterPlan` agora opera sobre um `Set` por plano; `uatClearPlanFilter` reseta para "todos" |
| 115 | `#ID` como link no header do acordeão, removendo botão `↗` separado | ID numérico do plano como link discreto (cor `text-faint`) com separador `|` antes do título integra navegação ao Azure DevOps sem ocupar espaço extra no header-right; botão seta era redundante e poluía visualmente |
| 116 | `localStorage['uatSprint::NomeProjeto']` para persistência do filtro | Padrão já adotado em outros modais (`tcProject`, `sprintColVisibility`) — chave namespaced por projeto evita colisão entre projetos distintos |
| 117 | `testPlanCount` adicionado ao `fetchProject` via `Promise.all` | Contagem de testplans no card principal precisava de uma chamada extra à API; rodar em paralelo com `paginatedItems` e `fetchIterMap` não aumenta o tempo de carregamento; `.catch(() => null)` garante que falha na API de testplans não quebre o dashboard |
| 118 | `openDailyForProject(projectName)` em `daily.js` + botão "Daily" no card | Abrir o Daily Standup pelo header sempre iniciava no primeiro projeto; botão por card permite entrar direto no slide do projeto desejado; abre em modo `'all'` (navegação entre projetos preservada) e posiciona o carrossel via `findIndex` sem nova chamada à API |

---

## 🧪 UAT Dashboard

Acessado pelo botão **UAT** no rodapé de cada card do dashboard.

- **Abre maximizado por padrão** — botão ⤡ Restaurar disponível para reduzir
- **Filtro de Sprint** — dropdown com todas as iterations dos testplans; preferência persistida em `localStorage['uatSprint::NomeProjeto']`
- **Card de resumo** com:
  - Nome do projeto (alias) + sprint atual + período + dias restantes + badge de risco
  - Percentual de conclusão (planos concluídos ÷ total) em destaque
  - Barra de progresso segmentada (verde/vermelho/amarelo/cinza) por planos
  - Seção **"Indicadores por Testplan"** com 4 cards: Concluídos · Em andamento · Com falha · Total
- **Label "Testplans Detail"** separa o card de resumo da lista de planos
- **Acordeão por testplan** — expande/colapsa com lazy-render do detalhe; scroll automático ao expandir
  - Header: ícone pasta + `#ID` (link clicável para o Azure DevOps) + separador `|` + nome + badge de estado + contagem TCs + % + toggle
  - Barra fina 4 cores (aprovados/falhos/bloqueados/pendentes) em TCs
  - Detalhe: filtro de resultado por **pills** com toggle (Passou / Falhou / Bloqueado / Pendente) + botão Limpar
  - Tabela de TCs: ID (`TC-{id}`), badge de prioridade (P1–P4), nome, tester, badge de resultado

### Indicadores por Testplan — lógica de classificação

| Indicador | Critério |
|-----------|---------|
| **Concluídos** | `passCount === totalCount && failCount === 0 && totalCount > 0` |
| **Em andamento** | `state === 'Active'` (independente do resultado) |
| **Com falha** | `failCount > 0` (independente do estado) |
| **Total** | todos os planos da sprint filtrada |

> Os contadores dos cards são independentes (um plano Active com falhas conta em "Em andamento" E "Com falha"). A barra de progresso usa categorias mutuamente exclusivas (prioridade: Concluído > Falho > Ativo > Não iniciado) para que os segmentos somem 100%.

### Endpoint `/api/uat`

```
GET /api/uat?project=NomeProjeto
```

Retorna por projeto:
```json
{
  "plans": [{
    "id": 123,
    "name": "Sprint 108 UAT",
    "iteration": "Projeto\\Sprint 108",
    "state": "Active",
    "startDate": "2026-05-12",
    "endDate": "2026-05-26",
    "url": "https://dev.azure.com/org/projeto/_testPlans/execute?planId=123",
    "passCount": 14,
    "failCount": 2,
    "blockedCount": 0,
    "notExecutedCount": 5,
    "totalCount": 21,
    "points": [{ "id": 1, "testCaseId": 456, "name": "Login com credenciais válidas", "tester": "Fulano", "outcome": "passed", "priority": 2 }]
  }]
}
```

### Fluxo de dados no backend

- `fetchUATPlans(identifier)` em `projectService.js` — busca todos os planos via `/_apis/testplan/plans`
- `_fetchTestPoints(project, planId, suiteId)` — pagina test points com `isRecursive=true` (lotes de 1000, até 10.000)
- Campo correto da API: `pt.testCaseReference` (não `pt.testCase`) para nome e ID do caso de teste
- `testPlanCount` adicionado ao retorno de `fetchProject` para exibição no card principal (contagem de planos ativos)

---

## 👥 Team Capacity & Performance

Acessado pelo link **Team Capacity** na sidebar. Substitui a view de cards no `main-content` sem recarregar a página.

- **Vista isolada** — `#content` e `.cards-toolbar` ficam ocultos; `#tc-view` é exibido com `display: block`
- **Seletor de projeto** no cabeçalho — persiste em `localStorage['tcProject']`
- **Cards de squad** no topo:
  - **Squad Capacity** — soma das capacidades configuradas por dev (em horas)
  - **Backlog Demand** — soma de `CompletedWork + RemainingWork` de todos os devs na sprint atual
  - **Overload Delta** — diferença Demand − Capacity (positivo = sobrecarga)
- **Cards por desenvolvedor** listam todos que tiveram atividade de tasks nas últimas sprints:
  - Avatar com iniciais, nome, badge de status (HEALTHY / AT RISK / NO CAPACITY)
  - Slider (0–160h, step 4) + input numérico sincronizados bidirecionalmente via `_applyCapacityChange()`
  - Capacidade salva em `localStorage['tc::devName::sprintName']`
  - Stats: Capacidade, Utilização %, Lançado, Restante
  - Gráfico de tendência das últimas N sprints (barras div, sem SVG)
- **Retorno ao dashboard** via link Dashboard na sidebar ou `showDashboardView()`
- **Troca de idioma** preserva a view TC — `setLocale()` salva `localStorage['activeView']` antes do reload; `app.js` restaura chamando `openTeamCapacity()` na inicialização

### Cálculo das métricas

| Métrica | Fórmula |
|---------|---------|
| Backlog Demand | Σ (CompletedWork + RemainingWork) por dev na sprint atual |
| Utilização | CompletedWork ÷ Capacity × 100% |
| Status HEALTHY | Utilização ≤ 100% e Capacity > 0 |
| Status AT RISK | Utilização > 100% |
| Status NO CAPACITY | Capacity = 0 |

### Endpoint `/api/team-capacity`

Retorna por projeto:
```json
{
  "project": "NomeProjeto",
  "currentSprint": "Sprint 108",
  "recentSprints": ["Sprint 106", "Sprint 107", "Sprint 108"],
  "developers": [{
    "name": "Fulano",
    "currentSprint": { "completedWork": 24, "remainingWork": 8, "taskCount": 5 },
    "history": [{ "sprint": "Sprint 106", "completedWork": 30 }, ...]
  }]
}
```

---

## 📋 Review Mensal — Service Delivery Report

Acessado pelo botão **Review Mensal** em cada card do dashboard principal. Abre a rota `/report?project=NOME` diretamente no projeto do card clicado, sem resetar para o primeiro projeto — mesmo padrão do botão Daily (`openDailyForProject`).

### Botão no card

```js
// projectService.js — buildCardHTML
// Adicionado na mesma linha dos botões Daily e UAT:
<button
  class="card-action-btn"
  onclick="window.location.href='/report?project=${encodeURIComponent(proj.name)}'"
  data-i18n="btn.monthlyReview"
  title="Review Mensal do projeto">
  Review Mensal
</button>
```

### Credenciais do Service Now

Seguem o mesmo padrão do PAT do Azure e das credenciais da IA:

- **Credenciais globais** (`instance`, `user`, `pass`) — salvas uma vez na raiz do `config.json`, configuradas na tela de Settings
- **`assignmentGroup` por projeto** — salvo dentro de cada objeto de projeto em `config.json`, idêntico ao campo `team` existente
- **Senha nunca exposta** — `GET /api/sn-config` retorna `hasPass: true/false`, nunca o valor
- **Projeto sem `assignmentGroup`** — relatório exibe apenas dados do Azure DevOps, sem quebrar

### Estrutura do `config.json` com Service Now

```json
{
  "org": "sua-org",
  "pat": "seu-pat-azure",
  "projects": [
    {
      "name": "Projeto Alpha",
      "team": "Alpha Team",
      "servicenow": {
        "assignmentGroup": "sys_id_grupo_alpha",
        "assignmentGroupName": "TI - Suporte Alpha"
      }
    }
  ],
  "ai": { "...": "..." },
  "github": { "...": "..." },
  "servicenow": {
    "instance": "suaempresa.service-now.com",
    "user": "usuario-sn",
    "pass": "senha-ou-token"
  }
}
```

> **Importante:** `POST /setup` preserva os campos `servicenow` global e por projeto ao salvar — igual ao comportamento já existente para `ai` e `github`.

### Payload do relatório

```js
// Estrutura injetada em window.__REPORT_PAYLOAD__ no report.html
{
  metadata:  { project, period, generatedAt },
  hasSn:     true | false,   // false = SN não configurado para o projeto
  delivery: {
    totalDelivered: Number,
    sprints: [{ name, delivered, points }]
  },
  quality: {
    bugsTotal: Number,
    bugsOpen:  Number
  },
  incidents: {              // null se hasSn = false
    total: Number,
    target: 24,             // meta contratual (futuramente por projeto)
    byPriority: { p1, p2, p3 },
    bySystem:   [{ name, count }],   // top 5
    monthly:    [{ label, opened, closed }]   // últimos 5 meses
  },
  prbs: {                   // null se hasSn = false
    open: Number,
    avgAging: Number,
    list: [{ id, title, priority, category, agingDays, state }]
  }
}
```

### Navegação do relatório

- **Seletor de projeto** — troca o projeto sem sair da tela (`changeProject`)
- **Seletor de mês** — últimos 6 meses disponíveis (`changeMonth`)
- **Botão ↻ Atualizar** — invalida o cache e recoleta os dados (`refresh=1`)
- **Indicador de atualização** — exibe `metadata.generatedAt` na toolbar

### Cache local

- Arquivos JSON em `/cache/` com TTL de 6 horas
- Nomenclatura: `azure_{projeto}_{YYYY-MM}.json` e `sn_{projeto}_{YYYY-MM}.json`
- Criado automaticamente na primeira execução
- Invalidado pelo botão Atualizar ou via `cacheInvalidate(project, month)`

### Chaves i18n adicionadas

| Chave | PT | EN | ES |
|---|---|---|---|
| `btn.monthlyReview` | Review Mensal | Monthly Review | Revisión Mensual |
| `report.executiveSummary` | Resumo executivo | Executive summary | Resumen ejecutivo |
| `report.incidents` | Incidentes | Incidents | Incidentes |
| `report.prbs` | PRBs — Problemas | PRBs — Problems | PRBs — Problemas |
| `report.delivery` | Entrega | Delivery | Entrega |
| `report.quality` | Qualidade | Quality | Calidad |
| `report.noSn` | Service Now não configurado | Service Now not configured | Service Now no configurado |
| `report.refresh` | Atualizar | Refresh | Actualizar |

---

## 💬 Copilot Project — Arquitetura da feature de IA

### Provedores suportados

| Provedor | Detecção | Formato do body | Extração da resposta |
|----------|----------|-----------------|---------------------|
| **Azure AI Foundry** | `services.ai.azure.com` na URL | `{ input: [...] }` — system injetado como prefixo da última msg user | `json.output[].content[].text` (Responses API) |
| **Azure OpenAI** | `openai.azure.com` na URL | `{ messages, max_tokens, temperature }` | `json.choices[0].message.content` |
| **OpenAI / genérico** | demais URLs | idem Azure OpenAI + `model` no body | idem |

### Estrutura do contexto (`/ai/context`)

Por projeto, o endpoint retorna:

```json
{
  "name": "NomeProjeto",
  "workItemType": "User Story",
  "activeSprintFilter": ["Sprint 108"],
  "summary": { "totalItems": 42, "userStories": 30, "storyPoints": 120, ... },
  "healthIndicators": { "completionRate": 70, "inUAT_pct": 5, "bugRate_pct": 12, "estimateCoverage": 90 },
  "byStatus": [{ "status": "Active", "count": 12 }, ...],
  "byAssignee": [{ "assignee": "Fulano", "count": 8 }, ...],
  "sprintDistribution": [{ "sprint": "Sprint 107", "totalUS": 10, "completedUS": 10, "completionPct": 100, ... }],
  "currentSprint": { "name": "Sprint 108", "start": "2026-03-31", "end": "2026-04-13", "items": [...] },
  "noEstimateItems": [{ "title": "...", "sprint": "Sprint 108", "assignee": "..." }],
  "noAssigneeItems": [...],
  "openBugs": [...]
}
```

---

## 🛣️ Próximos passos sugeridos

- [x] Suporte a múltiplos times por projeto — seleção individual no setup, filtro de items por time no servidor
- [x] Alias de projeto — renomear nome exibido sem alterar configuração do servidor
- [x] Remoção rápida de projeto via botão 🗑️ no card
- [x] Ordenação de US por campo `Order` (StackRank) no Daily Standup
- [x] `classificationnodes/iterations` para cobertura de sprints em projetos multi-time
- [x] Tooltips i18n — todos os `title` do dashboard agora respondem à troca de idioma
- [x] Toggle grid/lista movido para toolbar acima dos cards
- [x] Tela Team Capacity & Performance — métricas por dev, configuração de capacidade, tendência de entrega
- [x] Copilot AI painel flutuante arrastável com minimize/maximize
- [x] Credenciais do Copilot AI persistidas — formulário pré-preenchido após restart
- [x] Daily Standup e Delivery Plan abrem maximizados por padrão
- [x] Topbar limpa — meta info (N projects · Org) movida para sidebar abaixo do logo
- [x] Cards do dashboard não cortam mais à direita no modo grid (`min-width: 0`)
- [x] Dropdown de sprint com scroll e comportamento drop-up quando espaço é insuficiente
- [x] Nomes de sprint exibidos sem prefixo de time (`.split("\\").pop()`)
- [x] Tela de setup com título "Setup" em todos os idiomas
- [x] Build corrigido: `npm run build` gera `dist/app/server.exe` (path correto para o wrapper)
- [x] Stats do card em grade 2×3 — Story Points e Project Progress adicionados; layout reorganizado em linha Scope + linha Problems
- [x] Feature de Feedback — link na sidebar, formulário (tipo/título/descrição), cria GitHub Issue, modal de sucesso com link clicável
- [x] Coluna "Em UAT %" na tabela de Distribuição por Sprint
- [x] Seletor de colunas visíveis na tabela de Distribuição por Sprint (dropdown ⊞, persistido em localStorage)
- [x] Indicador "Esforço Economizado" nos Health Indicators — `(OriginalEstimate − CompletedWork) / OriginalEstimate × 100`
- [x] Override manual de `OriginalEstimate` via edição inline no anel de Esforço Economizado (ícone ✏, persistido em localStorage por projeto)
- [x] Fix: credenciais do Copilot AI perdidas ao reconfigurar projetos via setup (`POST /setup` agora preserva campos `ai` e `github` do `config.json`)
- [x] Modal de itens reutilizável (`itemsModal.js`) — todos os 4 stats da Daily (User Stories, No Estimate, No Assignee, Bugs) são clicáveis; modal genérico com API `openItemsModal({ title, items, showPts, defaultFilters })`
- [x] Filtro de status com dropdown de checkboxes no `itemsModal` — substitui toggle binário; `defaultFilters` pré-seleciona estados relevantes
- [x] Stats clicáveis no dashboard principal — todos os 4 stats do card abrem `itemsModal` via `openCardStat` em `filters.js`
- [x] Stats clicáveis no modal de detalhes — User Stories, Novos e Sem Estimativa do Resumo Geral abrem `itemsModal` via `openDetailStat` em `detail.js`
- [x] Botão `↻` Refresh na Daily Standup — recarrega dados do Azure sem fechar o modal, preserva slide atual
- [x] Stats Progress (closedCount/total) e Story Points removidos do card do dashboard — layout mais limpo
- [x] Filtro de sprint do dashboard redesenhado para match visual com o filtro do `itemsModal` (underline, label uppercase, painel arredondado)
- [x] Link clicável na coluna ID do `itemsModal` — fix na construção da URL (`baseUrl/_workitems/edit/id`) e estilo azul
- [x] UAT Dashboard — modal por projeto com card de resumo, acordeão por testplan, filtro de sprint persistido, indicadores por plano, pills de resultado
- [x] Botão "Daily" no card do dashboard — abre Daily Standup direto no slide do projeto via `openDailyForProject`, sem resetar para o primeiro projeto

**Review Mensal — implementado**
- [x] `servicenowClient.js` — cliente HTTPS Service Now (snGet, Basic auth, padrão azureClient.js)
- [x] `config.js` — funções `getSnConfig`, `saveSnConfig`, `getProjectSnGroup`
- [x] Tela de Settings — seção Service Now: credenciais globais + botão Testar + botão Salvar (collapsible na `su-left`)
- [x] `POST /setup` — preserva campo `servicenow` por projeto no merge (lookup pelo `name+team` no existing config)
- [x] `reportService.js` — `buildReport`, `fetchAzureReport`, `fetchSnReport`, cache JSON por projeto/mês (TTL 6h)
- [x] Rotas no `server.js` — `GET /report`, `GET /api/sn-config`, `POST /api/sn-config`, `POST /api/sn-test`
- [x] `views/report.html` — template com tokens `{{PAYLOAD}}`, `{{PROJECTS}}`, `{{PROJECT_JSON}}`, `{{MONTH}}`, `{{MONTHS_JSON}}`
- [x] `public/modules/report.js` — `renderReport`, `changeProject`, `changeMonth`, `refreshReport`; charts CSS div-based (zero deps)
- [x] `public/style.css` — classes `.report-*`, `.report-metric`, `.report-bar-*`, `.report-table` (dark mode automático via CSS vars)
- [x] i18n — chaves `btn_monthly_review`, `sn_*` em `pt.json`, `en.json`, `es.json`
- [x] Botão **Monthly Review** no `buildCardHTML` — mesma linha de Daily e UAT, `onclick` abre `/report?project=NAME`

**Backlog geral**
- [ ] Adicionar anexo de imagem ao feedback (upload para repo GitHub via `Contents API`) — requer PAT com `contents:write`
- [ ] Adicionar PAT com permissão `Project and Team (Read)` para usar `_apis/teams` corretamente
- [ ] Migrar para **Azure Function + Static Web App** para acesso remoto sem rodar localmente
- [ ] Integrar com **Power BI** para histórico e relatórios gerenciais
- [ ] Adicionar filtro por responsável além do filtro por sprint
- [ ] Adicionar histórico de saúde do backlog (comparar com semanas anteriores)
- [ ] Burndown baseado em datas reais de conclusão (via histórico de estado do Azure DevOps)
- [ ] Streaming de respostas da IA (SSE) para reduzir tempo de espera percebido
- [ ] Troca de idioma sem reload (templates reativos ao locale via `data-i18n` no HTML gerado dinamicamente)
- [ ] Meta contratual de incidentes configurável por projeto (hoje fixo em 24 no `reportService.js`)

---

*Documentação atualizada em Junho/2026 — Team Capacity & Performance, redesign do dashboard, Copilot painel flutuante + credenciais persistidas, modais maximizados por padrão, topbar limpa, correções UX (grid overflow, dropdown drop-up, sprint labels, build path), stats 2×3, feature de Feedback via GitHub Issues, coluna "Em UAT %" + seletor de colunas na Sprint Distribution, indicador "Esforço Economizado" com override manual, fix persistência credenciais Copilot, `itemsModal.js` componente reutilizável, filtro de status com checkboxes, stats clicáveis no dashboard principal + modal de detalhes + daily standup, botão Refresh na Daily, remoção de Progress e Story Points do card, redesign filtro de sprint (underline), link clicável na coluna ID do itemsModal, UAT Dashboard (modal por projeto, acordeão por testplan, card de resumo com indicadores de plano, filtro de sprint persistido, pills de resultado), botão Daily por card (openDailyForProject — abre direto no slide do projeto), **Review Mensal — Service Delivery Report implementado** (servicenowClient.js, reportService.js, views/report.html, public/modules/report.js, cache JSON 6h, credenciais SN globais + assignmentGroup por projeto, seção SN collapsible no Settings, rotas /report + /api/sn-*, botão Monthly Review por card)*
