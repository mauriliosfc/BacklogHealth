# 📋 Backlog Health Dashboard — Documentação

> Criado com auxílio do Claude (Anthropic) | Março/2026 — Atualizado Abril/2026 (multi-time, alias, lixeira)

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
│       └── copilot.js    ← openCopilot, sendCopilotMessage, _loadRichContext, _buildContext (fallback DOM)
├── aiClient.js         ← chatCompletion, testConnection (Azure AI Foundry / Azure OpenAI / OpenAI-compat)
├── views/
│   ├── dashboard.html  ← template HTML do dashboard com tokens {{ORG}}, {{CARDS}}, etc.
│   └── setup.html      ← template HTML do setup com tokens de configuração
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
        └── Servidor HTTP local (porta 3030)
                ├── GET /                    → dashboard principal (HTML cacheado)
                ├── GET /refresh             → rebusca dados e retorna HTML atualizado
                ├── GET /settings            → tela de configurações (pré-preenchida)
                ├── GET /api/projects        → lista projetos disponíveis para o PAT informado
                ├── POST /setup              → salva config.json e retorna JSON {ok:true}
                ├── GET /detail?project=NAME → JSON com items, taskItems, bugItems, iterMap
                ├── GET /ai/config           → verifica se a IA está configurada
                ├── POST /ai/config          → salva credenciais da IA em config.json
                ├── POST /ai/test            → testa conexão com o provedor de IA
                ├── POST /ai/context         → retorna contexto rico dos projetos (respeita filtros de sprint)
                ├── POST /ai/chat            → envia mensagem para a IA e retorna resposta
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
  - Tabela de User Stories da sprint atual (Título, Status, Estimativa, Responsável)
- Navegação por botões (← Anterior / Próximo →) ou teclas `←` `→`
- Fecha com ✕ ou tecla `Escape`
- Modal expansível (⤢ Maximizar / ⤡ Restaurar)

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
| **Indicadores de Saúde** | Taxa de Conclusão (US), Em UAT (US), Taxa de Bugs (hrs bugs/total hrs), Cobertura de Estimativas (US) |
| **US por Status** | Barras horizontais com todos os estados — filtrado apenas por User Stories |
| **US por Responsável** | Barras horizontais com membros da equipe — filtrado apenas por User Stories |
| **Distribuição por Sprint** | Tabela: Sprint, Período, User Stories, Story Points, Concluídos (%), Ações (botão burndown 📊 + botão ver sprint ☰) — ordenada por data crescente |
| **Cronograma de Sprints** | Gantt visual com blocos posicionados por data, barra proporcional à qtd de US, marcador "hoje" |

### Cálculo dos indicadores de saúde

| Indicador | Fórmula |
|-----------|---------|
| Taxa de Conclusão | US com estado Closed/Done/Resolved ÷ total de US |
| Em UAT | US com estado UAT ÷ total de US |
| Taxa de Bugs | Hrs Bugs ÷ (Hrs Tasks + Hrs Bugs) |
| Cobertura de Estimativas | US com Story Points ÷ total de US |

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

- **Modal expandível** com maximizar, fechar e tecla `Escape`
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
- [ ] Adicionar PAT com permissão `Project and Team (Read)` para usar `_apis/teams` corretamente
- [ ] Migrar para **Azure Function + Static Web App** para acesso remoto sem rodar localmente
- [ ] Integrar com **Power BI** para histórico e relatórios gerenciais
- [ ] Adicionar filtro por responsável além do filtro por sprint
- [ ] Adicionar histórico de saúde do backlog (comparar com semanas anteriores)
- [ ] Burndown baseado em datas reais de conclusão (via histórico de estado do Azure DevOps)
- [ ] Streaming de respostas da IA (SSE) para reduzir tempo de espera percebido

---

*Documentação atualizada em Abril/2026 — Multi-time, alias de projeto, remoção rápida, ordenação por Order na daily, classificationnodes para sprints, tooltips i18n*
