# 📋 Backlog Health Dashboard — Documentação

> Criado com auxílio do Claude (Anthropic) | Março/2026 — Atualizado Março/2026

---

## 🎯 Objetivo

Automatizar a rotina de validação de backlog de projetos no **Azure DevOps**, eliminando a necessidade de acessar cada projeto manualmente. O resultado é um dashboard local que exibe o status de saúde de todos os projetos de forma visual e consolidada, com filtros por sprint, atualização automática e painel de detalhes por projeto.

---

## 🏗️ Arquitetura

```
Node.js Script (dashboard_node.js)
        │
        ├── config.json (credenciais salvas localmente)
        │
        ├── Chama API REST do Azure DevOps (HTTPS)
        │       ├── Projects API       → lista todos os projetos acessíveis pelo PAT
        │       ├── WIQL Query         → busca IDs de work items ativos (state NOT IN Closed/Done/Removed)
        │       ├── Work Items API     → detalhes dos items do dashboard principal (até 100)
        │       ├── Iterations API     → sprints com datas (tenta "{projeto} Team" → "{projeto}")
        │       ├── WIQL (detail)      → items ativos para indicadores de saúde (até 500)
        │       ├── WIQL (tasks/bugs)  → todos os estados para CompletedWork e contagem total
        │       └── WIQL (allItems)    → todos os tipos/estados para distribuição por tipo
        │
        └── Servidor HTTP local (porta 3030)
                ├── GET /                    → dashboard principal (HTML cacheado)
                ├── GET /refresh             → rebusca dados e retorna HTML atualizado
                ├── GET /settings            → tela de configurações (pré-preenchida)
                ├── GET /api/projects        → lista projetos disponíveis para o PAT informado
                ├── POST /setup              → salva config.json e retorna JSON {ok:true}
                └── GET /detail?project=NAME → JSON com items, taskItems, bugItems, allItems, iterMap
```

---

## ⚙️ Configuração

| Parâmetro | Valor |
|-----------|-------|
| Porta local | `3030` |
| Arquivo de configuração | `config.json` (gerado automaticamente na primeira execução) |
| Autenticação | PAT (Personal Access Token) |
| Hot reload | `nodemon dashboard_node.js` |

As credenciais são configuradas pela **tela de setup** na primeira execução e salvas em `config.json`. Não há valores hardcoded no código.

> ℹ️ **Permissões do PAT necessárias:**
> - `Work Items (Read)` — obrigatório para leitura de work items e backlogs
> - `Project and Team (Read)` — recomendado para listagem de projetos e dados de sprint

---

## 📦 Dependências

- **Node.js v24 LTS** — instalado via `winget install OpenJS.NodeJS.LTS`
- **nodemon** — instalado via `npm install -g nodemon` (hot reload ao salvar)
- Sem pacotes externos no runtime — usa apenas módulos nativos (`http`, `https`, `dns`, `child_process`)

> **Nota:** `dns.setDefaultResultOrder("ipv4first")` é aplicado no início do script para evitar timeout em redes sem conectividade IPv6 (o DNS do Azure DevOps retorna endereços IPv6 primeiro).

---

## 🚀 Como executar

```bash
# Com hot reload (recomendado para desenvolvimento — não reabre o navegador a cada reinício):
nodemon dashboard_node.js

# Sem hot reload (abre o navegador automaticamente):
node dashboard_node.js

# O servidor sobe em:
# http://localhost:3030
```

---

## 📊 Dashboard Principal — O que é exibido

Todos os indicadores do dashboard principal são calculados considerando apenas **User Stories** (tipos: `User Story`, `Product Backlog Item`, `Requirement`).

| Métrica | Alerta | Crítico |
|--------|--------|---------|
| US sem estimativa (Story Points) | > 30% do total de US | > 50% do total de US |
| US sem responsável | > 20% do total de US | — |
| Bugs abertos (todos os estados) | > 5 | > 10 |

### Status de saúde
- 🟢 **Saudável** — backlog bem estruturado
- 🟡 **Atenção** — pontos de melhoria identificados
- 🔴 **Crítico** — ação imediata necessária

### Seção "Visualizar User Stories"
Cada card possui um `<details>` expansível que exibe apenas User Stories agrupadas por sprint, ordenadas cronologicamente (mais antiga primeiro). A tabela contém: Título, Status, Estimativa e Responsável.

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
- Stats: Total US, Sem Estimativa, Sem Responsável, Bugs
- Badge de saúde (🟢 🟡 🔴)

---

## 📊 Dashboard de Detalhes do Projeto

Acessado pelo botão **📊 Detalhes do projeto** em cada card.

- Busca dados via `/detail?project=NAME` com múltiplas queries ao Azure DevOps
- **Respeita os filtros de sprint ativos** na tela principal — todos os indicadores, incluindo `taskItems`, `bugItems` e `allItems`, são filtrados por sprint no cliente antes de agregar
- Modal com botão **↻** para atualizar os dados sem fechar o modal
- Modal com botão **⤢ Maximizar / ⤡ Restaurar**
- Fecha com ✕, clique fora do modal ou tecla `Escape`

### Seções do painel de detalhes

| Seção | Conteúdo |
|-------|----------|
| **Resumo Geral** | Total itens, User Stories, Story Points, Pts Entregues, Em Andamento, Novos, Sem Estimativa, Hrs Tasks, Hrs Bugs |
| **Indicadores de Saúde** | Taxa de Conclusão (US), Em UAT (US), Taxa de Bugs (hrs bugs/total hrs), Cobertura de Estimativas (US) |
| **Itens por Status** | Barras horizontais com todos os estados (inclui fechados) |
| **Itens por Tipo** | Barras: US, Bug, Task, Feature, Epic — inclui itens fechados |
| **Carga por Responsável** | Top 12 membros com quantidade de items |
| **Distribuição por Sprint** | Tabela: Sprint, Período, User Stories, Story Points, Concluídos (%) — ordenada por data crescente |
| **Cronograma de Sprints** | Gantt visual com blocos posicionados por data, barra proporcional à qtd de US, marcador "hoje" |

### Cálculo dos indicadores de saúde

| Indicador | Fórmula |
|-----------|---------|
| Taxa de Conclusão | US com estado Closed/Done/Resolved ÷ total de US |
| Em UAT | US com estado UAT ÷ total de US |
| Taxa de Bugs | Hrs Bugs ÷ (Hrs Tasks + Hrs Bugs) |
| Cobertura de Estimativas | US com Story Points ÷ total de US |

### Queries ao Azure DevOps no `/detail`

| Query | Filtro | Finalidade |
|-------|--------|------------|
| WIQL principal | State NOT IN (Closed, Done, Removed) | Items ativos para indicadores de saúde |
| WIQL tasks | Sem filtro de estado | CompletedWork + IterationPath para Hrs Tasks |
| WIQL bugs | Sem filtro de estado | CompletedWork + IterationPath + contagem total |
| WIQL allItems | State <> Removed | Distribuição por tipo (inclui fechados) |

---

## 🔌 APIs do Azure DevOps utilizadas

| API | Endpoint | Finalidade |
|-----|----------|------------|
| Projects | `/_apis/projects` | Lista todos os projetos acessíveis pelo PAT |
| WIQL | `/{project}/_apis/wit/wiql` | Consulta work items por critérios |
| Work Items | `/{project}/_apis/wit/workitems?ids=...` | Detalhes dos items (máx 200/request) |
| Iterations | `/{project}/{team}/_apis/work/teamsettings/iterations` | Sprints com datas e timeFrame |

> **Nota:** A API `_apis/teams` retorna 401 com PAT sem permissão de times. O script contorna isso tentando o nome do time padrão diretamente (`{projeto} Team`).

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

---

## 🛣️ Próximos passos sugeridos

- [ ] Criar um `.bat` para abrir com duplo clique
- [ ] Adicionar PAT com permissão `Project and Team (Read)` para usar `_apis/teams` corretamente
- [ ] Migrar para **Azure Function + Static Web App** para acesso remoto sem rodar localmente
- [ ] Integrar com **Power BI** para histórico e relatórios gerenciais
- [ ] Adicionar filtro por responsável além do filtro por sprint
- [ ] Adicionar histórico de saúde do backlog (comparar com semanas anteriores)

---

*Documentação atualizada em Março/2026*
