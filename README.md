# Backlog Health Dashboard

Dashboard para monitoramento e análise de saúde dos backlogs de projetos no **Azure DevOps**. Visualize métricas de User Stories, filtre por sprint e identifique rapidamente itens sem estimativa, sem responsável, bugs e itens em UAT.

---

## Funcionalidades

- Indicadores de saúde por projeto (Saudável / Atenção / Crítico) com tooltip explicando o motivo do alerta
- Métricas agregadas: User Stories (abertas + fechadas), sem estimativa, sem responsável e bugs ativos
- Agrupamento por sprint ordenado cronologicamente
- Seção "Visualizar User Stories" por card com tabela filtrada (toggle expansível)
- Modal de detalhes com indicadores, gráficos de distribuição, cronograma de sprints e tabela de distribuição por sprint
- **Gráfico de burndown por sprint** — acessível via coluna "Ações" na tabela de distribuição, com linha ideal, linha real e marcador de hoje
- **Apresentação de Daily Standup** — modal em carrossel com métricas e User Stories da sprint atual, botão de burndown integrado
- Filtros por sprint com persistência no navegador
- **Suporte a múltiplos idiomas** — Português, Inglês (padrão) e Espanhol, alternável pelo seletor PT/EN/ES no header
- **Distribuição como app Windows nativo** — `BacklogHealth.exe` via wrapper WebView2, sem instalar Node.js ou browser
- Temas claro e escuro
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
│       └── burndown.js   # openBurndown, buildBurndownChart, openBurndownFromDaily
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

---

## Licença

Este projeto é de uso pessoal e interno. Nenhuma licença de distribuição foi definida.
