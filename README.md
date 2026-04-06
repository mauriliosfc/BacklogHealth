# Backlog Health Dashboard

Dashboard para monitoramento e análise de saúde dos backlogs de projetos no **Azure DevOps**. Visualize métricas de User Stories, filtre por sprint e identifique rapidamente itens sem estimativa, sem responsável, bugs e itens em UAT.

---

## Funcionalidades

- Indicadores de saúde por projeto (Saudável / Atenção / Crítico) com tooltip explicando o motivo do alerta
- **Suporte a dois modos por projeto** — *User Story* (Story Points) ou *Task* (Horas: RemainingWork / OriginalEstimate), configurável por projeto na tela de setup
- Métricas agregadas: User Stories/Tasks (abertas + fechadas), sem estimativa, sem responsável e bugs ativos
- Agrupamento por sprint ordenado cronologicamente
- Seção "Visualizar User Stories" por card com tabela filtrada (toggle expansível)
- Modal de detalhes com indicadores, gráficos de distribuição, cronograma de sprints e tabela de distribuição por sprint
- **Gráfico de burndown por sprint** — acessível via coluna "Ações" na tabela de distribuição, com linha ideal, linha real e marcador de hoje
- **Apresentação de Daily Standup** — modal em carrossel com métricas e User Stories da sprint atual, botão de burndown integrado
- **Delivery Plan** — timeline compartilhada de todos os projetos lado a lado, com blocos de sprint posicionados por data, filtro por projeto e herança dos filtros de sprint do dashboard principal
- **Copilot Project (IA)** — assistente de IA integrado ao dashboard com contexto rico dos projetos monitorados (ver seção abaixo)
- Filtros por sprint com persistência no navegador
- **Suporte a múltiplos idiomas** — Português, Inglês (padrão) e Espanhol, alternável pelo seletor PT/EN/ES no header
- **Distribuição como app Windows nativo** — `BacklogHealth.exe` via wrapper WebView2, sem instalar Node.js ou browser
- Temas claro e escuro com cores adaptadas por tema (blocos de sprint passados usam tons suaves no tema claro)
- Atualização automática a cada 5 minutos

---

## Pré-requisitos

- **Node.js v18+** — [Download](https://nodejs.org/)
- Conta no **Azure DevOps** com acesso aos projetos desejados
- **Personal Access Token (PAT)** com as permissões:
  - `Work Items (Read)`
  - `Project and Team (Read)`

> **Como gerar o PAT:** Azure DevOps → User Settings → Personal Access Tokens → New Token

---

## Instalação

```bash
# 1. Clone o repositório
git clone https://github.com/mauriliosfc/BacklogHealth.git
cd BacklogHealth

# 2. (Opcional) Instale o nodemon para hot reload em desenvolvimento
npm install -g nodemon
```

Não há dependências de produção — apenas módulos nativos do Node.js são utilizados.

---

## Configuração

Na primeira execução, o dashboard abre uma tela de configuração onde você deve informar:

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| **Organização** | Nome da organização **ou** URL completa do Azure DevOps | `minha-empresa` · `https://empresa.visualstudio.com/` |
| **PAT** | Personal Access Token gerado no Azure DevOps | `xxxxxxxxxxxxxxxxxxxx` |

Após preencher, clique em **"Testar conexão e carregar projetos"**, selecione os projetos que deseja monitorar e clique em **"Salvar e abrir dashboard"**.

As configurações são salvas automaticamente em `config.json` (ignorado pelo Git para proteger suas credenciais).

Para alterar a configuração posteriormente, clique no botão ⚙️ no cabeçalho do dashboard ou acesse `http://localhost:3030/settings`.

---

## Executando

```bash
# Modo desenvolvimento (com hot reload — não reabre o navegador a cada reinício)
nodemon server.js

# Modo produção (abre o navegador automaticamente)
node server.js
```

O servidor sobe na porta **3030**. Para encerrar, pressione `Ctrl+C`.

---

## Estrutura do Projeto

```
BacklogHealth/
├── server.js           # Entry point: HTTP server, rotas, serve arquivos de public/ dinamicamente
├── config.js           # Gerenciamento de configuração + parseOrgInput (detecta formato da org)
├── azureClient.js      # Cliente HTTP para a API REST do Azure DevOps (usa cfg.baseUrl)
├── projectService.js   # Lógica de negócio: queries, cálculo de saúde, cards HTML
├── utils/
│   ├── health.js       # calcHealth — fonte única compartilhada com o frontend
│   ├── paginate.js     # paginatedItems — busca em lotes de 200
│   └── iterMap.js      # fetchIterMap — busca de sprints/iterations
├── public/
│   ├── style.css       # Todo o CSS (temas claro/escuro, dashboard, setup)
│   ├── app.js          # Entry point ES Module: importa módulos e expõe ao window
│   ├── i18n/
│   │   ├── pt.json     # Traduções em Português
│   │   ├── en.json     # Traduções em Inglês (padrão)
│   │   └── es.json     # Traduções em Espanhol
│   └── modules/
│       ├── constants.js  # US_TYPES, CLOSED_STATES, ACTIVE_BUG_STATES
│       ├── health.js     # calcHealth (browser)
│       ├── utils.js      # fmtD, buildSprintData
│       ├── theme.js      # setTheme, toggleTheme
│       ├── timer.js      # startTimer, doRefresh
│       ├── filters.js    # applyFilter, initFilters, toggleDropdown, toggleUS, initHealthBadges
│       ├── i18n.js       # initI18n, t, setLocale, getLocale, applyTranslations
│       ├── detail.js     # loadDetailData, buildDetailHTML, buildTimeline
│       ├── daily.js      # openDaily, buildDailySlide
│       ├── burndown.js   # openBurndown, buildBurndownChart, openBurndownFromDaily
│       ├── deliveryPlan.js # openDeliveryPlan, buildDeliveryPlan, filtros de projeto
│       └── copilot.js    # openCopilot, sendCopilotMessage, contexto rico de projetos
├── aiClient.js           # Cliente HTTP para Azure AI Foundry, Azure OpenAI e APIs compatíveis
├── views/
│   ├── dashboard.html  # Template HTML do dashboard
│   └── setup.html      # Template HTML da tela de configuração
├── wrapper/
│   ├── BacklogHealth.csproj  # Projeto C# WPF (.NET Framework 4.8)
│   └── MainWindow.xaml.cs    # Inicia server.exe, aguarda porta 3030, abre WebView2
├── config.json         # Credenciais e projetos monitorados (gerado automaticamente, não versionado)
├── nodemon.json        # Configuração do hot reload
└── .gitignore
```

---

## Indicadores de Saúde — Dashboard Principal

Os cards exibem métricas baseadas exclusivamente em **User Stories**:

| Métrica | Descrição |
|---------|-----------|
| **User Stories** | Total de US (abertas e fechadas) |
| **Sem Estimativa** | US abertas sem Story Points definidos |
| **Sem Responsável** | US abertas sem assigned to |
| **Bugs Abertos** | Bugs com estado Active, In Progress ou New |

| Status | Condição |
|--------|----------|
| 🟢 **Saudável** | Sem alertas ativos |
| 🟡 **Atenção** | US sem estimativa >30% ou sem responsável >20% ou >5 bugs |
| 🔴 **Crítico** | US sem estimativa >50% ou >10 bugs |

> Passe o mouse sobre o badge de saúde para ver o motivo detalhado do alerta.

---

## Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Dashboard principal |
| `GET` | `/settings` | Página de configurações |
| `GET` | `/refresh` | Recarrega dados do Azure DevOps |
| `GET` | `/detail?project=NOME` | Detalhes completos de um projeto (JSON) |
| `GET` | `/api/projects?org=X&pat=Y` | Lista projetos disponíveis |
| `POST` | `/setup` | Salva configuração |
| `GET` | `/ai/config` | Verifica se a IA está configurada |
| `POST` | `/ai/config` | Salva credenciais da IA |
| `POST` | `/ai/test` | Testa conexão com a IA |
| `POST` | `/ai/context` | Retorna contexto rico dos projetos para a IA |
| `POST` | `/ai/chat` | Envia mensagem para a IA e retorna resposta |

---

## Copilot Project (IA)

O Copilot Project é um assistente de IA integrado ao dashboard, acessível pelo botão **🤖 Copilot** no header.

### Configuração

Na primeira abertura, o Copilot solicita as credenciais da IA:

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| **Endpoint** | URL base da API | `https://sua-org.openai.azure.com/` · `https://copilot.services.ai.azure.com/api/projects/.../...` |
| **API Key** | Chave de autenticação | `sk-...` ou chave Azure |
| **Model / Deployment** | Nome do modelo ou deployment | `gpt-4o` · `gpt-5.4-mini` |
| **API Version** | Versão da API (apenas Azure OpenAI) | `2024-02-01` |

As credenciais são salvas localmente em `config.json` e podem ser alteradas a qualquer momento pelo botão ⚙️ dentro do chat.

### Provedores suportados

| Provedor | Detecção automática | Observações |
|----------|-------------------|-------------|
| **Azure AI Foundry** | URL contém `services.ai.azure.com` | System prompt injetado como prefixo da mensagem do usuário (restrição do agent) |
| **Azure OpenAI** | URL contém `openai.azure.com` | Usa header `api-key`; requer `apiVersion` |
| **OpenAI / compatível** | demais URLs | Usa header `Authorization: Bearer` |

### Contexto enviado à IA

Ao abrir o chat, o Copilot busca automaticamente os dados de todos os projetos monitorados via `/ai/context`, respeitando os filtros de sprint ativos no dashboard. O contexto inclui, por projeto:

- **Resumo Geral** — total de itens, User Stories, Story Points, horas de tasks e bugs, bugs abertos
- **Indicadores de Saúde** — taxa de conclusão, % em UAT, taxa de bugs, cobertura de estimativas
- **US por Status** — distribuição de estados (New, Active, Closed, etc.)
- **US por Responsável** — distribuição por membro da equipe (top 15)
- **Distribuição por Sprint** — por sprint: total de US, concluídas, %, Story Points, horas
- **Sprint Atual** — lista completa de US da sprint ativa com título, estado, pontos e responsável
- **Itens problemáticos** — US sem estimativa, US sem responsável, bugs abertos (até 30 cada)

O contexto completo é reenviado a cada mensagem para garantir que o assistente tenha acesso aos dados mesmo em provedores que não persistem o system prompt entre turnos (ex.: Azure AI Foundry agents).

---

## Licença

Este projeto é de uso pessoal e interno. Nenhuma licença de distribuição foi definida.
