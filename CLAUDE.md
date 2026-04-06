# 📋 Backlog Health Dashboard — Documentação

> Criado com auxílio do Claude (Anthropic) | Março/2026 — Atualizado Março/2026

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
│       └── deliveryPlan.js ← openDeliveryPlan, buildDeliveryPlan, filtros de projeto
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
        └── Servidor HTTP local (porta 3030)
                ├── GET /                    → dashboard principal (HTML cacheado)
                ├── GET /refresh             → rebusca dados e retorna HTML atualizado
                ├── GET /settings            → tela de configurações (pré-preenchida)
                ├── GET /api/projects        → lista projetos disponíveis para o PAT informado
                ├── POST /setup              → salva config.json e retorna JSON {ok:true}
                ├── GET /detail?project=NAME → JSON com items, taskItems, bugItems, iterMap
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

Acessado pelo botão **📅 Apresentar daily** no header.

- Modal em carrossel — um slide por projeto monitorado
- Cada slide exibe dados **filtrados pela sprint atual** do projeto
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
| **Distribuição por Sprint** | Tabela: Sprint, Período, User Stories, Story Points, Concluídos (%), Ações (botão burndown) — ordenada por data crescente |
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
| WIQL | `/{project}/_apis/wit/wiql` | Consulta work items por critérios |
| Work Items | `/{project}/_apis/wit/workitems?ids=...` | Detalhes dos items em lotes de 200 (até 500) |
| Iterations | `/{project}/{team}/_apis/work/teamsettings/iterations` | Sprints com datas e timeFrame |

> **Nota:** A API `_apis/teams` retorna 401 com PAT sem permissão de times. O script contorna isso tentando o nome do time padrão diretamente (`{projeto} Team`).

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

---

## 🛣️ Próximos passos sugeridos

- [ ] Adicionar PAT com permissão `Project and Team (Read)` para usar `_apis/teams` corretamente
- [ ] Migrar para **Azure Function + Static Web App** para acesso remoto sem rodar localmente
- [ ] Integrar com **Power BI** para histórico e relatórios gerenciais
- [ ] Adicionar filtro por responsável além do filtro por sprint
- [ ] Adicionar histórico de saúde do backlog (comparar com semanas anteriores)
- [ ] Burndown baseado em datas reais de conclusão (via histórico de estado do Azure DevOps)

---

*Documentação atualizada em Abril/2026 — Delivery Plan, tema-aware sprint colors, datas nos blocos, modo Task por projeto*
