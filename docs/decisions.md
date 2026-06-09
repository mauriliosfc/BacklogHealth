# Histórico de Decisões — Backlog Health Dashboard

> Arquivo de arquivo. Decisões arquiteturais ativas estão no `CLAUDE.md`.

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
| 83 | Stats do card em grade 2×3 | Quatro stats em linha única ficavam apertados no modo grid; separar em duas linhas temáticas melhora leitura |
| 84 | Story Points somados de todos os `mainItems` (independente de sprint) | SP representa o escopo total do projeto, não apenas da sprint filtrada |
| 85 | Project Progress = US fechadas ÷ total de US do backlog | Diferente do burndown (por sprint), o Progress mostra o avanço geral do projeto |
| 86 | Token GitHub hardcoded em `config.json`, sem UI de configuração | Feedback vai para um repo centralizado do desenvolvedor — expor configuração ao usuário criaria risco de substituição indevida |
| 87 | `POST /api/feedback` cria GitHub Issue com label baseado no tipo | Mapear tipo do form (bug/suggestion/help/other) para label do GitHub permite filtrar issues por categoria no repositório |
| 88 | Modal de sucesso separado após criar a issue | Fechar o form e abrir um segundo modal com link clicável para o GitHub é mais limpo do que exibir uma mensagem inline |
| 89 | Coluna "Em UAT %" na tabela de Distribuição por Sprint | Visibilidade do % de US em UAT por sprint sem abrir o modal de detalhes completo |
| 90 | Seletor de colunas como dropdown com ícone ⊞ no cabeçalho da seção | Checkboxes inline ocupavam espaço permanente — dropdown posicionado à direita do título; estado persistido em `localStorage['sprintColVisibility']` |
| 91 | `AbortController` para listeners do seletor de colunas | Cada abertura do modal de detalhes recria o HTML e registrava novos listeners no `document` — `AbortController` descarta os listeners anteriores sem acúmulo |
| 92 | Indicador "Esforço Economizado" em `buildDetailHTML` | `(OriginalEstimate − CompletedWork) / OriginalEstimate × 100` mede eficiência das tasks |
| 93 | Override manual de `OriginalEstimate` com edição inline | Azure DevOps nem sempre tem `OriginalEstimate` preenchido — campo inline salva override em `localStorage['origEstOverride::NomeProjeto']` |
| 94 | `POST /setup` preserva campos existentes do `config.json` via spread | `saveConfig(...)` criava objeto do zero, descartando `ai`, `github` e qualquer outro campo já salvo |
| 95 | `id`, `title`, `url`, `assignedTo` adicionados ao `itemsJson` em `projectService.js` | Modal de bugs da Daily precisava exibir nome, link e responsável de cada bug |
| 96 | `itemsJson` escapa `'` com `&#39;` | `data-items='...'` usa aspas simples — títulos com apóstrofo quebravam o JSON silenciosamente |
| 97 | `_slidesData[]` acumulado em `buildDailySlide` e resetado em `openDaily` | Items Modal precisa saber os dados de cada slide sem nova chamada à API — array paralelo a `_dailySlides` preenchido em ordem garante índice correto |
| 98 | `itemsModal.js` como componente genérico | API `openItemsModal({ title, items, showPts, defaultFilters })` — reutilizável em qualquer contexto sem duplicar HTML/CSS/lógica |
| 99 | `defaultFilters` em vez de `toggleBtn` no `itemsModal` | O toggle binário foi substituído por filtro com checkboxes — mais flexível; `defaultFilters: string[]` pré-seleciona estados sem acoplar lógica de negócio ao modal |
| 100 | `openDailyStat(stat)` como ponto de entrada único para stats clicáveis | Um único dispatcher com string (`'us'`, `'noEst'`, `'noResp'`, `'bugs'`) reduz a superfície da API global |
| 101 | Filtro de status com dropdown de checkboxes no `itemsModal.js` | Substitui toggle binário; dropdown com todos os estados presentes nos itens; `defaultFilters` pré-seleciona estados relevantes |
| 102 | Fix: listener global do `filters.js` fechava o dropdown do `itemsModal` | `filters.js` tem `document.addEventListener('click', ...)` que fecha `.select-panel.open`; adicionada verificação `!e.target.closest('.items-filter-select')` |
| 103 | `openCardStat(statEl, stat)` em `filters.js` para stats clicáveis no dashboard | Lê `data-items` do card, aplica filtro de sprint ativo do `localStorage` e computa o subconjunto correto |
| 104 | `openDetailStat(stat)` e `_ctx` em `detail.js` para stats clicáveis no detalhe | `_ctx` armazena `{ filtered, workItemType }` após `loadDetailData` para acesso sem nova chamada à API |
| 105 | `refreshDaily()` em `daily.js` | Botão `↻` chama `doRefresh()`, depois reconstrói slides com novos cards preservando o índice atual |
| 106 | `_buildDailyTrack()` + estado `_dailyMode/_dailyForcedProject/_dailyForcedSprint` | Centraliza construção de slides para que `refreshDaily()` reconstrua corretamente independente de como a daily foi aberta |
| 107 | Stats Progress e Story Points removidos do card do dashboard | Informações redundantes com a barra de percentual e o modal de detalhes |
| 108 | Filtro de sprint redesenhado com underline | Trigger usa `border-bottom` em vez de caixa com borda completa — consistência visual com `itemsModal` |
| 109 | URL do work item via `baseUrl/_workitems/edit/${id}` | `_links` é omitido quando `&fields=` é usado na query da API |
| 110 | Link clicável na coluna ID do `itemsModal` com `color: var(--c-blue)` | `.daily-id-cell a` tinha `color: var(--text-faint)` que deixava o link invisível |
| 111 | `_fetchTestPoints` com `isRecursive=true` e paginação própria | Test points ficam aninhados em suites filhas — sem recursão apenas o suite raiz era retornado |
| 112 | Campo `testCaseReference` (não `testCase`) na Testplan API | A API v7.0 retorna `testCaseReference` com `id` e `name` — `testCase` estava undefined |
| 113 | Contadores dos cards independentes, barra com exclusividade mútua | UAT: dois conjuntos de variáveis — `plansDone/Failed/WIP/NotStarted` para cards; `barDone/Failed/WIP/NotStarted` com prioridade exclusiva para barra |
| 114 | Pills com toggle para filtro de resultado dos TCs | Pills permitem ativar/desativar múltiplos outcomes sem abrir dropdown — `uatFilterPlan` opera sobre um `Set` por plano |
| 115 | `#ID` como link no header do acordeão | ID numérico do plano como link discreto integra navegação ao Azure DevOps sem ocupar espaço extra |
| 116 | `localStorage['uatSprint::NomeProjeto']` para persistência do filtro UAT | Chave namespaced por projeto evita colisão entre projetos distintos |
| 117 | `testPlanCount` adicionado ao `fetchProject` via `Promise.all` | Contagem de testplans no card principal; `.catch(() => null)` garante que falha não quebre o dashboard |
| 118 | `openDailyForProject(projectName)` em `daily.js` + botão "Daily" no card | Abrir pelo header sempre iniciava no primeiro projeto; botão por card permite entrar direto no slide desejado |
| 119 | Review Mensal convertido de SSR para SPA | Template server-side impossibilitava renderização incremental — modal no `dashboard.html` com `report.js` como ES Module segue a mesma arquitetura dos demais modais |
| 120 | `snConfig.js` como módulo dedicado para configurar SN — modal in-app | Permite ajustar `assignmentGroup` e credenciais sem sair do contexto do Report Modal |
| 121 | `Report Modal` no `dashboard.html` com `openReport(project)` | Navegação por URL trocava de página e perdia o contexto do dashboard |
| 122 | Agrupamento de incidentes configurável (`cmdb_ci` vs `u_additional_res_code`) | Diferentes projetos usam métricas distintas; persiste `incidentGroupBy` em `config.json` |
| 123 | TOP 9 + "Outros" para gráfico de incidentes e heatmap | Mais de 9 sistemas gerava barras ilegíveis — agregar o restante em "Outros" mantém o visual limpo |
| 124 | Gráfico de incidentes reescrito como barras verticais agrupadas | Barras verticais com labels rotacionados (-42°) comportam melhor no espaço fixo |
| 125 | Paleta rgba semitransparente no gráfico TOP 9 | Rgba com alpha 0.35–0.65 reduz fadiga visual sem perder distinção entre segmentos |
| 126 | Contadores numéricos dentro de segmentos/fatias | Exibir o número diretamente no shape elimina consulta à legenda; threshold evita texto em shapes pequenos |
| 127 | Legendas dos charts SVG extraídas para HTML | Texto longo dentro de `<svg>` não quebra linha; `<div>` HTML com `flex-wrap` reflow automaticamente |
| 128 | Gráfico de evolução PRB reposicionado antes do donut/aging | Fluxo de leitura: tendência temporal primeiro, depois detalhe de estado atual |
| 129 | `_snVal(v)` / `_snRaw(v)` + `sysparm_display_value=all` | Com `display_value=all` campos relacionais retornam `{value, display_value}` — sem normalização campos viram `"[object Object]"` |
| 130 | `byGroupAlt` / `byGroupAltMonthly` pré-computados no backend | Trocar o groupBy no frontend sem round-trip exige que ambos os agrupamentos estejam no payload |
| 131 | Cache key com sufixo `groupFields` | Configs diferentes coexistem sem invalidação cruzada |
| 132 | `_fetchTeamSprintsForPeriod` — filtragem por sprints do time | Relatório sem filtro incluía items de sprints de outros times no mesmo projeto |
| 133 | Refactor `report.js`: `_PRB_STATES`, `_fmtMonth`, `_loadReportConfig`/`_saveReportConfig` | Fonte única de configuração de estados PRB; helper de formatação elimina 4 blocos repetidos |
| 134 | Loop sequencial histórico SN → batches paralelos de 4 (`HISTORY_BATCH`) | 13 rounds sequenciais → ~4 rounds (~3× mais rápido) sem alterar o total de requisições |
| 135 | Seção Delivery padronizada com `report-prb-cards` | Unificar padrão visual reduz CSS específico e cria consistência |
| 136 | Gráficos de Delivery movidos para dentro da seção Delivery | Cria seção coesa de análise de entrega; `_renderFixedChartCell` descartado |
| 137 | `byTypes` considera todas as USs do período (removido filtro `DONE_STATES`) | Remover o filtro reflete o escopo real do backlog no período |
| 138 | Seção Quality eliminada; incorporada à Delivery como "AMS Sprint Delivery" | Unificar reduz scroll e coloca indicadores de qualidade junto ao contexto de entrega |
| 139 | `_renderTypeBarVertical` — barras verticais SVG | Terceiro estilo visual para gráficos de agrupamento (além de horizontal e donut) |
| 140 | `/api/report-fields` expandido com campos standard do Azure DevOps | Times que usam campos padrão não tinham como criar gráficos de agrupamento por esses campos |
| 141 | Donut ampliado (`r 44→62`); legenda ancorada na base via `flex-column` + `margin-top:auto` | Donut pequeno era difícil de visualizar; legenda flutuava sem âncora visual |
| 142 | Barras usam paleta `COLORS` multicolor; picker adiciona "Cor única" com `<input type="color">` | Cor única impossibilitava distinguir categorias — paleta multicolor por padrão |
| 143 | `<title>` + `onmouseenter/onmouseleave` nos segmentos do donut | Tooltip nativo SVG `<title>` exibe `"Nome: N (XX%)"` sem JS extra |
| 144 | Barra amarela de "Cancelados" no gráfico de histórico de incidentes | Incidentes cancelados (state=8) são categoria distinta de fechados |
| 145 | `^resolved_atISEMPTY` no branch `closed_at` de `incClosedQ` evita double-count | Incidentes com `resolved_at` e `closed_at` seriam contados duas vezes sem essa condição |
| 146 | `incBacklogQuery` para meses passados usa 3 partes via `^NQ` | Cobre todos os casos de backlog histórico sem double-count: abertos + cancelados após corte + resolvidos após corte |
| 147 | `removedFromSprint` detecta dois casos: `state='Removed'` + `Was Ever` | Times removem itens mudando estado OU movendo para outra sprint — ambos os casos precisam ser detectados |
| 148 | `Was Ever` queries rodadas em paralelo após `sprintMap` já construído | Evita round-trips sequenciais; só quando `teamIterations.length > 0` |
| 149 | `data-inc='{"mode":...}'` + `_incOnclick` helper para barras clicáveis | Onclick em SVG não suporta objetos JS inline; serializar como JSON em `data-inc` centraliza a lógica |
| 150 | `rawValue` em `byGroupAlt`/`byGroupAltMonthly` + `altRawValues` map | `u_additional_res_code` é reference field: `_snVal` retorna display_value mas o filtro SN exige o raw value |
| 151 | Gráfico de localização como bloco fixo abaixo do heatmap | Bloco fixo com picker próprio mantém paridade com o heatmap sem fragmentar a experiência |
| 152 | Heatmap top N configurável via `_heatmapTopN` (0 = todos os sistemas) | Top 9 fixo impossibilitava ver sistemas menos frequentes; `0` como sentinela de "sem corte" |
| 153 | Modal de incidentes: colunas Assigned to, Res. Code, IC Afetado, Imp. Plants | Campos consistentes com os charts — `sysparm_fields` do `fetchSnIncidentBacklog` expandido |
| 154 | Filtros in-grid com `<select>` para colunas categóricas e `<input>` para textuais | Baixa cardinalidade → select com valores únicos; texto livre → input substring |
| 155 | Exportar CSV com BOM UTF-8 e separador `;` — lê DOM da tabela | Ler `tbody tr` visíveis exporta exatamente o que o usuário vê respeitando filtros; BOM garante encoding no Excel PT-BR |
| 156 | `_snRaw(i.number)` e `_snRaw(i.sys_id)` em `fetchSnIncidentBacklog` | Com `display_value=all`, campos string podem retornar como objetos — `_snRaw` previne `[object Object]` no link |
| 157 | `utils/paths.js` como fonte única de caminhos graváveis | `config.js` e `reportService.js` calculavam o path de dados cada um do seu jeito; centralizar em `utils/paths.js` permite que o Electron injete `ELECTRON_DATA_DIR` via env var |
| 158 | `handlers/` como camada de domínio — funções puras `async` sem `req/res` | Handlers em `server.js` acoplavam lógica ao transporte HTTP; extrair para funções puras permite que o Electron chame via IPC sem duplicar lógica |
| 159 | `handlers/state.js` como singleton para `cachedHTML` | `cachedHTML` era variável de closure em `main()`, inacessível a handlers externos; singleton torna o estado compartilhável |
| 160 | `json(res, fn)` e `page(res, fn)` como helpers de resposta em `server.js` | Cada rota repetia try/catch + writeHead + JSON.stringify; dois helpers de 10 linhas eliminam esse boilerplate |
| 161 | `server.js` reduzido a ~190 linhas de roteamento puro | 830 linhas misturando roteamento, lógica de negócio e renderização; após extração para `handlers/`, responsabilidade única |
