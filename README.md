# Backlog Health Dashboard

Dashboard Node.js local para monitoramento e análise de saúde dos backlogs de projetos no **Azure DevOps**. Visualize métricas de User Stories, filtre por sprint e identifique rapidamente itens sem estimativa, sem responsável, bugs, itens em UAT e muito mais — tudo em uma única tela.

---

## Download

**Versão atual: v1.1.1**

| | Arquivo | Indicado para |
|---|---|---|
| **Instalador** | [Backlog Health Setup 1.1.1.exe](https://github.com/mauriliosfc/BacklogHealth/releases/download/v1.1.1/Backlog.Health.Setup.1.1.1.exe) | Uso diário — cria atalho no Desktop e Menu Iniciar |
| **Portátil** | [Backlog Health 1.1.1.exe](https://github.com/mauriliosfc/BacklogHealth/releases/download/v1.1.1/Backlog.Health.1.1.1.exe) | Sem instalar — execute direto |

> Requer Windows 10 ou superior. Não precisa instalar Node.js.

Todas as versões: [github.com/mauriliosfc/BacklogHealth/releases](https://github.com/mauriliosfc/BacklogHealth/releases)

---

## Funcionalidades

- **Indicadores de saúde** por projeto (Saudável / Atenção / Crítico) com tooltip explicando o motivo
- **Dois modos por projeto** — *User Story* (Story Points) ou *Task* (Horas), configurável no setup
- Métricas por card: User Stories/Tasks, sem estimativa, sem responsável, bugs ativos
- **Filtro por sprint** com seleção múltipla, datas e persistência no browser
- **Modal de Detalhes** — indicadores de saúde, distribuição por status/responsável/sprint, cronograma Gantt, burndown
- **Gráfico de Burndown** por sprint — linha ideal, linha real, marcador de hoje
- **Daily Standup** — carrossel com métricas da sprint atual, navegável por teclado, botão por card para entrar direto no projeto
- **Delivery Plan** — timeline compartilhada de todos os projetos com blocos de sprint posicionados por data
- **UAT Dashboard** — planos de teste por projeto com acordeão, pills de filtro, indicadores e progresso
- **Team Capacity** — métricas por desenvolvedor, configuração de capacidade em horas, tendência de entrega
- **Review Mensal** — relatório consolidado Azure DevOps + Service Now (incidentes, PRBs, entrega, qualidade)
- **Copilot IA** — assistente integrado com contexto rico dos projetos (Azure AI Foundry / Azure OpenAI / OpenAI)
- **Suporte a múltiplos times** por projeto — cada time monitorado de forma isolada
- **Alias de projeto** — renomear o nome exibido sem alterar configuração do servidor
- **i18n** — Português, Inglês (padrão) e Espanhol
- **Tema claro/escuro** com persistência no browser — sincroniza automaticamente com a preferência do Windows no app Electron
- **App Windows nativo** — instalador NSIS ou versão portátil via Electron, sem instalar Node.js
- **Atualizações no app** — banner aparece quando uma nova versão é publicada; baixe e instale sem sair do dashboard

---

## Pré-requisitos

- **Node.js v18+** — [Download](https://nodejs.org/)
- Conta no **Azure DevOps** com acesso aos projetos desejados
- **Personal Access Token (PAT)** com as permissões:
  - `Work Items (Read)` — obrigatório
  - `Project and Team (Read)` — recomendado

> **Como gerar o PAT:** Azure DevOps → User Settings → Personal Access Tokens → New Token

---

## Instalação

```bash
git clone https://github.com/mauriliosfc/BacklogHealth.git
cd BacklogHealth

# Opcional: instalar nodemon para hot reload em desenvolvimento
npm install -g nodemon

# Instalar dependências de dev (apenas para testes)
npm install
```

Não há dependências de produção — apenas módulos nativos do Node.js são utilizados.

---

## Configuração

Na primeira execução, o dashboard abre uma tela de configuração onde você informa:

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| **Organização** | Nome da org ou URL completa do Azure DevOps | `minha-empresa` · `https://empresa.visualstudio.com/` |
| **PAT** | Personal Access Token | `xxxxxxxxxxxxxxxxxxxx` |

Após preencher, clique em **"Testar conexão e carregar projetos"**, selecione os projetos e clique em **"Salvar"**.

As configurações são salvas em `config.json` (ignorado pelo Git).

Para alterar posteriormente: botão ⚙️ no cabeçalho ou `http://localhost:3030/settings`.

---

## Executando

```bash
# Desenvolvimento (hot reload — não reabre o navegador a cada reinício)
nodemon server.js

# Produção (abre o navegador automaticamente)
node server.js
```

O servidor sobe na porta **3030**. Para encerrar: `Ctrl+C`.

---

## Testes

```bash
npm test                # roda todos os testes
npm run test:watch      # modo watch (re-executa ao salvar)
npm run test:coverage   # exibe cobertura por arquivo
```

259 testes unitários cobrindo handlers de domínio, utilitários e funções puras de configuração.

---

## Build — distribuição como .exe

```bash
npm run electron:build
```

Gera em `dist/electron/`:
- `Backlog Health Setup x.x.x.exe` — instalador NSIS (~76MB); cria atalho no Desktop e Menu Iniciar
- `Backlog Health x.x.x.exe` — versão portátil; execute direto, sem instalar

As releases são publicadas em [github.com/mauriliosfc/BacklogHealth/releases](https://github.com/mauriliosfc/BacklogHealth/releases). O app detecta novas versões automaticamente e exibe um banner para download e instalação.

---

## Estrutura do Projeto

```
BacklogHealth/
├── server.js              # Thin router ~190 linhas + helpers json()/page()
├── config.js              # Gerenciamento de config + parseOrgInput, getDisplayName
├── azureClient.js         # Cliente HTTPS para a API REST do Azure DevOps
├── projectService.js      # Queries WIQL, cards HTML, fetchProjectDetail, fetchUATPlans
├── teamCapacityService.js # fetchTeamCapacity — tasks por dev/sprint
├── reportService.js       # buildReport, cache JSON 6h (Azure + Service Now)
├── servicenowClient.js    # snGet — HTTPS Basic auth para a Table API do SN
├── aiClient.js            # chatCompletion, testConnection (Foundry / Azure OAI / genérico)
├── electron/
│   ├── main.js            # BrowserWindow, tema da barra de título, IPC, update check
│   ├── preload.js         # contextBridge — expõe electronAPI ao renderer
│   └── updater.js         # checkForUpdates, downloadUpdate via GitHub Releases API
├── handlers/              # Funções puras async — sem req/res, reutilizáveis por IPC
│   ├── utils.js           # HttpError, httpError(), readBody()
│   ├── state.js           # Singleton cachedHTML
│   ├── dashboard.js       # renderDashboard, renderSetup, buildAndCache
│   ├── projects.js        # listProjects, setup, removeProject
│   ├── azure.js           # getDetail, getTeamCapacity, getUAT, getReportFields, getContext
│   ├── ai.js              # getAiConfig, saveAiCfg, testAiConnection, chat
│   ├── report.js          # getReportConfig, saveReportConfig, getReport, getIncidents
│   ├── sn.js              # getSnCfg, saveSnCfg, testSn
│   └── feedback.js        # submitFeedback
├── utils/
│   ├── paths.js           # DATA_DIR, CONFIG_PATH, CACHE_DIR (pronto para Electron)
│   ├── health.js          # calcHealth — compartilhado com frontend
│   ├── paginate.js        # paginatedItems — lotes de 200
│   └── iterMap.js         # fetchIterMap — sprints/iterations com fallback
├── public/
│   ├── style.css          # Todo o CSS (dark/light, Electron, scrollbar, zero duplicatas)
│   ├── app.js             # Entry point ES Module
│   ├── i18n/              # pt.json, en.json (padrão), es.json
│   └── modules/           # constants, health, utils, filters, detail, daily,
│                          # burndown, teamCapacity, copilot, report, snConfig,
│                          # itemsModal, alias, deliveryPlan, updater, theme, timer, i18n
├── views/
│   ├── dashboard.html     # Template com tokens {{ORG}}, {{CARDS}}, etc.
│   ├── setup.html         # Template da tela de configuração
│   └── report.html        # Template do Review Mensal
├── tests/
│   ├── unit/              # 259 testes (handlers, utils, config)
│   └── integration/       # Planejado: supertest + nock
├── dist/electron/         # Distribuição Electron (não versionado)
├── docs/
│   └── decisions.md       # Histórico de decisões arquiteturais
└── config.json            # Credenciais (gerado automaticamente, não versionado)
```

---

## Indicadores de Saúde

Baseados exclusivamente em **User Stories** (ou Tasks, conforme o modo do projeto):

| Métrica | Descrição |
|---------|-----------|
| **User Stories** | Total de US (abertas e fechadas) |
| **Sem Estimativa** | US abertas sem Story Points |
| **Sem Responsável** | US abertas sem Assigned To |
| **Bugs Abertos** | Bugs com estado Active, In Progress ou New |

| Status | Condição |
|--------|----------|
| Saudável | Sem alertas ativos |
| Atenção | Sem estimativa >30% ou sem responsável >20% ou >5 bugs |
| Crítico | Sem estimativa >50% ou >10 bugs |

---

## Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Dashboard principal (HTML) |
| `GET` | `/refresh` | Recarrega dados e retorna HTML atualizado |
| `GET` | `/settings` | Tela de configurações |
| `GET` | `/api/projects?org=X&pat=Y` | Lista projetos disponíveis para o PAT |
| `POST` | `/setup` | Salva configuração (preserva ai, github, servicenow) |
| `POST` | `/api/remove-project` | Remove projeto do monitoramento |
| `GET` | `/detail?project=NAME` | Detalhes completos de um projeto (JSON) |
| `GET` | `/api/team-capacity?project=NAME` | Dados de capacidade por desenvolvedor |
| `GET` | `/api/uat?project=NAME` | Planos de teste e test points |
| `GET` | `/ai/config` | Configuração da IA (endpoint, model, apiVersion) |
| `POST` | `/ai/config` | Salva credenciais da IA |
| `POST` | `/ai/test` | Testa conexão com o provedor de IA |
| `POST` | `/ai/context` | Contexto rico dos projetos para a IA |
| `POST` | `/ai/chat` | Envia mensagem e retorna resposta da IA |
| `GET` | `/api/report?project=NAME&month=YYYY-MM` | Review Mensal (JSON) |
| `GET` | `/api/report-config?project=NAME` | Configuração do relatório por projeto |
| `POST` | `/api/report-config` | Salva configuração do relatório |
| `GET` | `/api/report-fields?project=NAME` | Campos disponíveis para gráficos de agrupamento |
| `GET` | `/api/sn-config?project=NAME` | Configuração do Service Now (sem expor senha) |
| `POST` | `/api/sn-config` | Salva credenciais SN e/ou assignmentGroup por projeto |
| `POST` | `/api/sn-test` | Testa conexão com o Service Now |
| `POST` | `/api/feedback` | Cria GitHub Issue com o feedback do usuário |

---

## Copilot IA

Assistente integrado ao dashboard, acessível pelo botão **Copilot** no header.

### Provedores suportados

| Provedor | Detecção | Observação |
|----------|----------|------------|
| **Azure AI Foundry** | URL contém `services.ai.azure.com` | System prompt injetado como prefixo da mensagem (restrição do agent) |
| **Azure OpenAI** | URL contém `openai.azure.com` | Header `api-key`; requer `apiVersion` |
| **OpenAI / compatível** | demais URLs | Header `Authorization: Bearer` |

### Configuração

| Campo | Exemplo |
|-------|---------|
| Endpoint | `https://sua-org.openai.azure.com/` |
| API Key | `sk-...` ou chave Azure |
| Model / Deployment | `gpt-4o` |
| API Version (Azure OAI) | `2024-02-01` |

---

## Licença

Este projeto é de uso pessoal e interno. Nenhuma licença de distribuição foi definida.
