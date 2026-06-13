# Plano de Implementação UX — Backlog Health Dashboard

> Gerado em: 2026-06-10  
> Baseado nos protótipos em `prototypes/` (11 arquivos HTML)  
> Histórico de decisões arquiteturais: [`docs/decisions.md`](decisions.md)

---

## Como usar este documento

- Marque tarefas concluídas com `[x]`
- Consulte o protótipo de referência para cada fase antes de implementar
- Ao iniciar uma fase, registre a data em "Iniciado em"
- Ao concluir, registre a data em "Concluído em"

---

## Visão geral

| Fase | Nome | Dias est. | Protótipo | Status |
|------|------|-----------|-----------|--------|
| 0 | Quick wins | 1–2 | IT-01, IT-01b | **concluído** |
| 1 | Settings redesenhado | 3–4 | IT-07b | **concluído** |
| 2 | Onboarding de primeiro uso | 3–4 | IT-00 | **concluído** |
| 3 | Modo SN-only | 4–5 | IT-01b | **concluído** |
| 4 | Dashboard — melhorias nos cards | 2–3 | IT-01 | **concluído** |
| 5 | Copilot IA — painel de chat | 3–4 | IT-06 | **concluído** |
| 6 | Feedback + SN Config | 2–3 | IT-08 | **concluído** |
| 7 | Burndown + UAT | 3–4 | IT-05 | **concluído** |
| 8 | Plano de Entrega | 2–3 | IT-04 | **concluído** |
| 9 | Review Mensal | 4–5 | IT-02 | pendente |
| 10 | Capacidade do Time | 4–5 | IT-03 | pendente |

**Total estimado:** 31–42 dias de desenvolvimento

---

## Dependências

```
[Fase 0 — Quick wins]
        ↓
[Fase 1 — Settings]  →  [Fase 2 — Onboarding]  →  [Fase 3 — SN-only]
        ↓
[Fase 4 — Dashboard cards]
        ↓
[Fase 5 — Copilot]   [Fase 6 — Feedback]    ← paralelo
[Fase 7 — Burndown]  [Fase 8 — Gantt]        ← paralelo
[Fase 9 — Review]    [Fase 10 — Capacidade]  ← paralelo
```

---

## Fase 0 — Quick wins `IT-01` `IT-01b`

> Protótipo: `prototypes/prototype-ux.html` + `prototypes/prototype-it01b.html`  
> Iniciado em: —  
> Concluído em: —

- [x] **0.1** Empty state no dashboard — quando `cfg.projects` está vazio, renderizar tela "Nenhum projeto ainda" com ilustração SVG e CTA "Configurar Azure DevOps"
  - Arquivos: `views/dashboard.html`, `handlers/dashboard.js` (`buildCardHTML` retorna empty state quando array vazio)
- [x] **0.2** Tooltip "Como gerar um PAT?" no campo PAT do setup — popover inline com passos numerados
  - Arquivos: `views/setup.html`, `public/style.css`
- [x] **0.3** Preview da URL da org em tempo real — digitar "accenture-brasil" exibe `dev.azure.com/accenture-brasil` abaixo do campo
  - Arquivos: `views/setup.html` (JS inline, event `input` no campo org)
- [x] **0.4** Status pill colorida no "Testar Conexão" — substituir texto simples por pill "Conectado · org · N projetos" ou pill vermelha com mensagem de erro
  - Arquivos: `views/setup.html`

---

## Fase 1 — Settings redesenhado `IT-07b`

> Protótipo: `prototypes/prototype-it07b.html`  
> Iniciado em: 2026-06-10  
> Concluído em: 2026-06-10

- [x] **1.1** Estrutura de abas: **Azure DevOps / ServiceNow / Projetos / Copilot IA** com badge de status por aba (Conectado / Não configurado / N projetos)
  - Arquivos: `views/setup.html`, `public/style.css`
- [x] **1.2** Aba Azure — form atual + URL preview live + hint de validade do PAT + guia PAT inline + zona de perigo com desconectar (confirm inline)
  - Arquivos: `views/setup.html`, `handlers/projects.js` (disconnect), `server.js` (/api/disconnect)
- [x] **1.3** Aba ServiceNow — promover SN do collapsible para aba dedicada; banner amarelo "Não configurado"; assignment group por projeto
  - Arquivos: `views/setup.html`
- [x] **1.4** Aba Projetos — lista de projetos com expand inline para tipo/equipe; filtro por texto; badge de contagem na aba
  - Arquivos: `views/setup.html`
- [x] **1.5** Aba Copilot IA — campos endpoint/key/model/version + 3 toggles de comportamento (UI) + test + save
  - Arquivos: `views/setup.html`
- [x] **1.6** Dot amarelo de alterações não salvas por aba — aparece ao editar, some após salvar
  - Arquivos: `views/setup.html` (JS)

---

## Fase 2 — Onboarding de primeiro uso `IT-00`

> Protótipo: `prototypes/prototype-it00.html`  
> Iniciado em: 2026-06-10  
> Concluído em: 2026-06-10

- [x] **2.0** Seletor de idioma na tela de boas-vindas — PT-BR / EN / ES com persistência em `localStorage`. **Default: English**. Troca todo o texto do fluxo imediatamente via `setLocale()` do módulo `public/modules/i18n.js` já existente. Idioma salvo deve ser aplicado automaticamente em toda a sessão subsequente.
  - Arquivos: `views/onboarding.html`, `public/modules/i18n.js` (já existe), `public/i18n/pt.json` / `en.json` / `es.json`
- [x] **2.1** Detecção de primeiro uso — flag `_onboarded` em `config.json`; `server.js` redireciona para `/onboarding` quando `!cfg._onboarded`; após setup `_onboarded: true` é persistido; `disconnect()` preserva a flag → próxima sessão vai para `/settings`
  - Arquivos: `server.js`, `handlers/projects.js`
- [x] **2.2** Nova view `views/onboarding.html` — tela Welcome (branding + CTA) com transições fade + translateY entre telas; fundo animado bg-glow + bg-grid; theme toggle
  - Arquivos: `views/onboarding.html` *(novo, 1718 linhas)*
- [x] **2.3** Tela 1: "What do you want to monitor?" — 3 cards de seleção (Azure DevOps / ServiceNow / Azure + ServiceNow com badge Recommended), lógica de toggle exclusiva/combinada
  - Arquivos: `views/onboarding.html`
- [x] **2.4** Tela 2: Formulário dinâmico — painéis condicionais por seleção; Azure (org+PAT+popover+test) e SN (instance+user+pass+test); botão "Skip for now"
  - Arquivos: `views/onboarding.html`
- [x] **2.5** Tela 3: Seleção de projetos — grid de project cards carregados via `GET /api/projects?org=&pat=`; toggle User Story/Task por card; campo team opcional; estado vazio com "Go to connections"
  - Arquivos: `views/onboarding.html`
- [x] **2.6** Tela 4: Conclusão — checkmark SVG animado, pills dinâmicas de resumo, 3 preview cards, botão "Open Dashboard" → `/`; rota `GET /onboarding` no server
  - Arquivos: `views/onboarding.html`, `server.js`

---

## Fase 3 — Modo SN-only `IT-01b`

> Protótipo: `prototypes/prototype-it01b.html` (Estado 2)  
> Iniciado em: 2026-06-10  
> Concluído em: 2026-06-10

- [x] **3.1** Helper `getAppMode()` em `config.js` → retorna `'empty'` / `'sn-only'` / `'azure'` / `'full'`
  - Arquivos: `config.js`
- [x] **3.2** Dashboard SN-only — `views/sn-dashboard.html` + `handlers/sn-dashboard.js`; agrupa incidentes ativos por `assignment_group`; KPI bar (total, P1, P2, P3, grupos); `buildAndCache()` delega para `buildSNCache()` quando `mode === 'sn-only'`
  - Arquivos: `views/sn-dashboard.html` *(novo)*, `handlers/sn-dashboard.js` *(novo)*, `handlers/dashboard.js`
- [x] **3.3** Sidebar adaptada — "Daily Standup", "Plano de Entrega", "Capacidade do Time" com cadeado + tooltip "Requer Azure DevOps"
  - Arquivos: `views/sn-dashboard.html`, `public/style.css`
- [x] **3.4** Banner informativo no topo "Habilite o Azure DevOps" — dispensável, estado salvo em `localStorage`
  - Arquivos: `views/sn-dashboard.html`
- [x] **3.5** CTA card no final "Ativar monitoramento de backlog" — lista de features + botão "Configurar Azure DevOps"
  - Arquivos: `views/sn-dashboard.html`
- [x] **3.6** Roteamento SN-only em `server.js` — startup carrega SN data; requisições sem Azure config e com `_onboarded=true` servem `state.html` (SN dashboard); API calls durante onboarding não são interceptadas
  - Arquivos: `server.js`
- [x] **3.7** Testes — `getAppMode()` (8 cenários), `fetchSNGroups` (7), `buildIncidentCardsHTML` (3), `fetchAndBuildCards` (3) — 192 testes, 10 suites, todos passando
  - Arquivos: `tests/unit/config.test.js`, `tests/unit/handlers/sn-dashboard.test.js` *(novo)*

---

## Fase 4 — Dashboard: melhorias nos cards `IT-01`

> Protótipo: `prototypes/prototype-ux.html`  
> Iniciado em: 2026-06-10  
> Concluído em: 2026-06-10

- [x] **4.1** Barra de saúde de 3px no topo do card colorida por threshold (vermelho/amarelo/verde)
  - Arquivos: `public/style.css`, `projectService.js` (`buildCardHTML`)
- [x] **4.2** Sprint filter dropdown por card — seletor de sprint inline no header do card
  - Arquivos: `public/modules/filters.js`, `views/dashboard.html`
- [x] **4.3** Summary bar global — barra horizontal acima dos cards com KPIs somados (total US, total pts, sem estimativa, sprint atual)
  - Arquivos: `views/dashboard.html`, `projectService.js`
- [x] **4.4** Drag handle — ícone de arrastar no hover para reordenar cards (ordem salva em `localStorage`)
  - Arquivos: `views/dashboard.html`, `public/app.js`
- [x] **4.5** More menu (⋯) consolidado — "Renomear", "Review Mensal", "Remover" em dropdown limpo
  - Arquivos: `views/dashboard.html`, `public/modules/`

---

## Fase 5 — Copilot IA: painel de chat `IT-06`

> Protótipo: `prototypes/prototype-it06.html`  
> Iniciado em: 2026-06-10  
> Concluído em: 2026-06-10

- [x] **5.1** Painel de chat flutuante (400px, fixed right) — substitui/complementa o modal atual
  - Arquivos: `public/modules/copilot.js`, `views/dashboard.html`, `public/style.css`
- [x] **5.2** Estados minimize/maximize — minimizar colapsa a pill de 48px com badge de mensagem não lida
  - Arquivos: `public/modules/copilot.js`
- [x] **5.3** Typing indicator animado (3 pontos bouncing) durante aguardo da resposta
  - Arquivos: `public/modules/copilot.js`
- [x] **5.4** Contexto automático — ao abrir o chat, carregar resumo dos projetos como contexto da primeira mensagem
  - Arquivos: `public/modules/copilot.js`, `handlers/ai.js`
- [x] **5.5** Botão de limpar conversa com confirmação inline
  - Arquivos: `public/modules/copilot.js`
- [x] **5.6** Renderização de markdown básico nas mensagens IA — `**bold**` → `<strong>`, `- item` → `<ul>`
  - Arquivos: `public/modules/copilot.js`

---

## Fase 6 — Feedback + SN Config `IT-08`

> Protótipo: `prototypes/prototype-it08.html`  
> Iniciado em: 2026-06-10  
> Concluído em: 2026-06-10

- [x] **6.1** Modal de Feedback: dropdown de tipo com ícone dinâmico por categoria
  - Arquivos: `views/dashboard.html`, `public/modules/`
- [x] **6.2** Contadores de caracteres — título (0/80) e descrição (0/500) com alerta visual ao aproximar do limite
  - Arquivos: `views/dashboard.html`
- [x] **6.3** Box de contexto automático — versão, org, número de projetos (não-sensível)
  - Arquivos: `views/dashboard.html`, `handlers/feedback.js`
- [x] **6.4** Tela de sucesso no modal — checkmark + "Issue #N criada" + link para o GitHub (substituir toast atual)
  - Arquivos: `views/dashboard.html`, `handlers/feedback.js`
- [x] **6.5** Modal de config SN: tabela de grupos por projeto com sys_id, status dot dinâmico
  - Arquivos: `public/modules/snConfig.js`, `views/dashboard.html`

---

## Fase 7 — Burndown + UAT `IT-05`

> Protótipo: `prototypes/prototype-it05.html`  
> Iniciado em: 2026-06-11  
> Concluído em: 2026-06-11

- [x] **7.1** SVG burndown chart com tooltip interativo por ponto — hover mostra data, pts restantes, pts ideais
  - Arquivos: `public/modules/burndown.js`, `public/style.css`
- [x] **7.2** Stats row abaixo do gráfico — Remaining, Delivered, Days left, Delta (verde/vermelho vs ideal)
  - Arquivos: `public/modules/burndown.js`
- [x] **7.3** UAT: filtros por prioridade (P1/P2/P3) e resultado (Passou/Falhou/Bloqueado) como pills clicáveis
  - Arquivos: `public/modules/uat.js`, `public/style.css`
- [x] **7.4** UAT: acordeão de planos com tabela de casos de teste — badges de resultado coloridos
  - Arquivos: `public/modules/uat.js`, `projectService.js`

---

## Fase 8 — Plano de Entrega `IT-04`

> Protótipo: `prototypes/prototype-it04.html`  
> Iniciado em: 2026-06-12  
> Concluído em: 2026-06-12

- [x] **8.1** Barras Gantt com visual diferenciado: passado (cinza + checkmark), atual (azul pulsante + borda pulsante), futuro (dashed)
  - Arquivos: `public/modules/deliveryPlan.js`, `public/style.css`
- [x] **8.2** Indicador "HOJE" — linha vertical dashed vermelha com chip "HOJE", posicionada por JS via `requestAnimationFrame`
  - Arquivos: `public/modules/deliveryPlan.js`
- [x] **8.3** Tooltip ao hover na barra — sprint name, datas, status (Concluido/Em andamento/Planejado)
  - Arquivos: `public/modules/deliveryPlan.js`
- [x] **8.4** Painel lateral esquerdo — checkboxes por projeto com avatar colorido, "Selecionar todos / Limpar", legenda de cores
  - Arquivos: `public/modules/deliveryPlan.js`, `public/style.css`
- [x] **8.5** Botão maximize/restore no modal + reposicionamento da linha HOJE ao redimensionar
  - Arquivos: `public/modules/deliveryPlan.js`

---

## Fase 9 — Review Mensal `IT-02`

> Protótipo: `prototypes/prototype-it02.html`  
> Iniciado em: —  
> Concluído em: —

- [ ] **9.1** KPI summary bar — 4 cards (Entregas, Story Points, Bugs, Incidentes SN) com sparkline e tendência vs mês anterior
  - Arquivos: `views/report.html`, `public/modules/report.js`
- [ ] **9.2** Gráfico de barras agrupadas SVG — entregas por projeto por sprint, gerado em JS, tooltip interativo
  - Arquivos: `public/modules/report.js`, `public/style.css`
- [ ] **9.3** Mini-cards de saúde por projeto com tendência vs mês anterior
  - Arquivos: `public/modules/report.js`, `reportService.js`
- [ ] **9.4** Tabela de incidentes com filtro por prioridade (pills P1/P2/P3) e popover de detalhe
  - Arquivos: `public/modules/report.js`, `views/report.html`
- [ ] **9.5** Seção "Análise do Copilot IA" colapsável — chevron rotacionado, borda gradiente azul-roxo, botão "Regenerar"
  - Arquivos: `public/modules/report.js`, `views/report.html`
- [ ] **9.6** Navegação de mês `< Maio 2026 >` — prev/next atualizam os dados do relatório
  - Arquivos: `public/modules/report.js`
- [ ] **9.7** Botão "Exportar PDF" — toast + `window.print()` ou blob download
  - Arquivos: `public/modules/report.js`

---

## Fase 10 — Capacidade do Time `IT-03`

> Protótipo: `prototypes/prototype-it03.html`  
> Iniciado em: —  
> Concluído em: —

- [ ] **10.1** Seletor de projeto/sprint no topbar do modal — troca os dados sem reload
  - Arquivos: `public/modules/teamCapacity.js`, `views/dashboard.html`
- [ ] **10.2** Tabela de membros: avatares coloridos por membro (iniciais + cor consistente via hash do nome), barra de ocupação inline com cor por threshold
  - Arquivos: `public/modules/teamCapacity.js`
- [ ] **10.3** Badge de ausências na tabela — "2d" em amarelo; linha com fundo tintado quando ausências > 0
  - Arquivos: `public/modules/teamCapacity.js`
- [ ] **10.4** Donut chart SVG por atividade (stroke-dasharray, hover com tooltip)
  - Arquivos: `public/modules/teamCapacity.js`, `public/style.css`
- [ ] **10.5** Timeline de ausências — grid CSS com colunas por dia útil, coluna "hoje" destacada em azul, células de ausência com badge "A"
  - Arquivos: `public/modules/teamCapacity.js`, `public/style.css`
- [ ] **10.6** Painel lateral deslizante por membro — click na linha abre drawer com stats, work items e breakdown de atividades
  - Arquivos: `public/modules/teamCapacity.js`, `public/style.css`
