# Backlog Health Dashboard

Dashboard para monitoramento e análise de saúde dos backlogs de projetos no **Azure DevOps**. Visualize métricas de User Stories, filtre por sprint e identifique rapidamente itens sem estimativa, sem responsável, bugs e itens em UAT.

---

## Funcionalidades

- Indicadores de saúde por projeto (Saudável / Atenção / Crítico) baseados em User Stories
- Métricas agregadas: US abertas, sem estimativa, sem responsável e bugs
- Agrupamento por sprint ordenado cronologicamente
- Seção "Visualizar User Stories" por card com tabela filtrada
- Modal de detalhes com indicadores, gráficos de distribuição e cronograma
- Botão de atualização de dados dentro do modal de detalhes
- Filtros por sprint com persistência no navegador
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
| **Organização** | Nome da sua organização no Azure DevOps | `minha-empresa` |
| **PAT** | Personal Access Token gerado no Azure DevOps | `xxxxxxxxxxxxxxxxxxxx` |

Após preencher, clique em **"Testar conexão e carregar projetos"**, selecione os projetos que deseja monitorar e clique em **"Salvar e abrir dashboard"**.

As configurações são salvas automaticamente em `config.json` (ignorado pelo Git para proteger suas credenciais).

Para alterar a configuração posteriormente, clique no botão ⚙️ no cabeçalho do dashboard ou acesse `http://localhost:3030/settings`.

---

## Executando

```bash
# Modo desenvolvimento (com hot reload — não reabre o navegador a cada reinício)
nodemon dashboard_node.js

# Modo produção (abre o navegador automaticamente)
node dashboard_node.js
```

O servidor sobe na porta **3030**. Para encerrar, pressione `Ctrl+C`.

---

## Estrutura do Projeto

```
BacklogHealth/
├── dashboard_node.js   # Servidor e toda a lógica da aplicação
├── config.json         # Credenciais e projetos monitorados (gerado automaticamente, não versionado)
├── nodemon.json        # Configuração do hot reload (define NO_OPEN_BROWSER=1)
└── .gitignore
```

---

## Indicadores de Saúde — Dashboard Principal

Os cards exibem métricas baseadas exclusivamente em **User Stories**:

| Métrica | Descrição |
|---------|-----------|
| **Total Abertos** | Quantidade de US com estado ativo |
| **Sem Estimativa** | US sem Story Points definidos |
| **Sem Responsável** | US sem assigned to |
| **Bugs Abertos** | Total de bugs independente de estado |

| Status | Condição |
|--------|----------|
| 🟢 **Saudável** | Sem alertas ativos |
| 🟡 **Atenção** | US sem estimativa >30% ou sem responsável >20% ou >5 bugs |
| 🔴 **Crítico** | US sem estimativa >50% ou >10 bugs |

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
