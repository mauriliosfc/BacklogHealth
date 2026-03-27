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
        │       ├── Projects API → lista todos os projetos acessíveis pelo PAT
        │       ├── WIQL Query → busca IDs dos work items ativos
        │       ├── Work Items API → busca detalhes dos items (até 100)
        │       ├── Iterations API → busca todas as sprints com datas
        │       │       └── Tenta "{projeto} Team" → "{projeto}" (sem usar _apis/teams)
        │       └── Work Items API (detail) → busca até 500 items (todos os status)
        │
        └── Servidor HTTP local (porta 3030)
                ├── GET /                    → dashboard principal (HTML cacheado)
                ├── GET /refresh             → rebusca dados e retorna HTML atualizado
                ├── GET /settings            → tela de configurações (pré-preenchida)
                ├── GET /api/projects        → lista projetos disponíveis para o PAT informado
                ├── POST /setup              → salva config.json e retorna JSON {ok:true}
                └── GET /detail?project=NAME → JSON com todos os items do projeto
```

---

## ⚙️ Configuração

| Parâmetro | Valor |
|-----------|-------|
| Porta local | `3030` |
| Arquivo de configuração | `config.json` (gerado automaticamente na primeira execução) |
| Autenticação | PAT (Personal Access Token) |
| Hot reload | `nodemon dashboard_node.js` |

As credenciais são configuradas pela **tela de setup** na primeira execução e salvas em `config.json`. Não há mais valores hardcoded no código.

> ℹ️ **Permissões do PAT necessárias:**
> - `Work Items (Read)` — obrigatório para leitura de work items e backlogs
> - `Project and Team (Read)` — recomendado para listagem de projetos e dados de sprint

---

## 📦 Dependências

- **Node.js v24 LTS** — instalado via `winget install OpenJS.NodeJS.LTS`
- **nodemon** — instalado via `npm install -g nodemon` (hot reload ao salvar)
- Sem pacotes externos no runtime — usa apenas módulos nativos (`http`, `https`, `child_process`)

---

## 🚀 Como executar

```bash
# Com hot reload (recomendado para desenvolvimento):
nodemon dashboard_node.js

# Sem hot reload:
node dashboard_node.js

# O navegador abre automaticamente em:
# http://localhost:3030
```

---

## 📊 Dashboard Principal — O que é exibido

Para cada projeto, o script verifica e exibe:

| Métrica | Alerta | Crítico |
|--------|--------|---------|
| Items sem estimativa (Story Points) | > 30% do total | > 50% do total |
| Items sem responsável | > 20% do total | — |
| Bugs abertos | > 5 | > 10 |

### Status de saúde
- 🟢 **Saudável** — backlog bem estruturado
- 🟡 **Atenção** — pontos de melhoria identificados
- 🔴 **Crítico** — ação imediata necessária

### Tabela de work items agrupada por sprint
- Items organizados por `System.IterationPath`
- Sprint atual aparece primeiro, em destaque verde
- Cabeçalho de grupo mostra nome da sprint, período e contagem

---

## 🎨 Sistema de Temas

O dashboard suporta múltiplos temas via **CSS Custom Properties** (`var(--nome)`).

- **Botão ☀️/🌙** no header alterna entre tema escuro e claro
- **Persistência no `localStorage`** — tema sobrevive a F5, auto-refresh e reabertura do browser
- **Sem flash (FOUC)** — script inline no `<head>` aplica o tema antes da página renderizar
- **Tema escuro** é o padrão (`:root`)
- **Tema claro** sobrescreve via `[data-theme="light"]`

### Como adicionar um novo tema

1. Adicione um bloco CSS em `buildHTML`:
```css
[data-theme="nomeTema"] {
  --bg-page: #...; --bg-card: #...;
  /* ... sobrescreva as variáveis desejadas */
}
```
2. Ajuste a lógica de `setTheme()` no bloco `<script>` para incluir o novo tema.

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
- Stats: Total, Sem Estimativa, Sem Responsável, Bugs
- Badge de saúde (🟢 🟡 🔴)

---

## 📊 Dashboard de Detalhes do Projeto

Acessado pelo botão **📊 Detalhes do projeto** em cada card.

- Busca **todos os items** do projeto via `/detail?project=NAME` (incluindo Closed/Done/Removed, até 500 items)
- **Respeita os filtros de sprint ativos** na tela principal — exibe banner azul indicando quais sprints estão filtradas
- Modal com botão **⤢ Maximizar / ⤡ Restaurar** para usar toda a área da tela
- Fecha com ✕, clique fora do modal ou tecla `Escape`

### Seções do painel de detalhes

| Seção | Conteúdo |
|-------|----------|
| Resumo Geral | Total itens, US, Story Points, Pts Entregues, Em Andamento, Novos, Bugs, Sem estimativa |
| Indicadores de Saúde | Gráficos circulares: Taxa de Conclusão, Cobertura de Estimativas, Taxa de Bugs |
| Itens por Status | Gráfico de barras horizontais com cores por status |
| Itens por Tipo | Gráfico de barras: US, Bug, Task, Feature, Epic |
| Carga por Responsável | Top 12 membros com quantidade de items |
| Distribuição por Sprint | Tabela: Sprint, Período, Itens, Story Points, Concluídos (%) |
| Cronograma de Sprints | Gantt visual com blocos posicionados por data, barra proporcional à qtd de US, marcador "hoje" |

---

## 🔌 APIs do Azure DevOps utilizadas

| API | Endpoint | Finalidade |
|-----|----------|------------|
| Projects | `/_apis/projects` | Lista todos os projetos acessíveis pelo PAT |
| WIQL | `/{project}/_apis/wit/wiql` | Consulta work items (ativos ou todos) |
| Work Items | `/{project}/_apis/wit/workitems?ids=...` | Detalhes dos items (máx 200/request) |
| Iterations | `/{project}/{team}/_apis/work/teamsettings/iterations` | Todas as sprints com datas e timeFrame |

> **Nota:** A API `_apis/teams` retorna 401 com PAT sem permissão de times. O script contorna isso tentando o nome do time padrão diretamente (`{projeto} Team`).

---

## ➕ Como adicionar/remover projetos monitorados

Clique no botão **⚙️** no header do dashboard para acessar a tela de configurações. Lá você pode:
- Alterar a organização ou o PAT
- Recarregar a lista de projetos disponíveis
- Marcar/desmarcar os projetos a monitorar

As alterações são salvas em `config.json` e o dashboard é atualizado automaticamente.

---

## 💬 Histórico de decisões

| # | Decisão | Motivo |
|---|---------|--------|
| 1 | Artifact React → script local | CORS bloqueava chamadas diretas ao Azure DevOps |
| 2 | Sem pacotes externos (axios, react, etc.) | Zero dependências, roda em qualquer Node.js |
| 3 | `/refresh` retorna HTML completo | Permite atualizar conteúdo sem recarregar a página |
| 4 | `localStorage` para filtros | Persistência sem backend, zero custo |
| 5 | `/detail` endpoint separado | Busca todos os status sem impactar performance do dashboard principal |
| 6 | `{projeto} Team` sem usar `_apis/teams` | PAT não tem permissão de leitura de times |
| 7 | `nodemon` para hot reload | Evita reiniciar manualmente a cada alteração |
| 8 | CSS Custom Properties para temas | Permite trocar todo o visual com um único atributo `data-theme` no `<html>` |
| 9 | Script inline no `<head>` para tema | Evita FOUC (flash do tema errado antes do JS carregar) |
| 10 | Credenciais em `config.json` (não hardcoded) | Segurança e portabilidade — cada usuário configura suas próprias credenciais |
| 11 | Tela de setup com teste de conexão + listagem de projetos | UX mais segura: valida PAT antes de salvar e lista projetos reais disponíveis |
| 12 | `/api/projects` endpoint com `rawAzureGet` | Permite testar credenciais sem modificar `cfg` global — usa org/pat passados como parâmetro |

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
