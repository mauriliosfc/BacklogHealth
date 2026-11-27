# Service Now: modo SSO (login corporativo) — manutenção

Como o login SSO/MFA do Service Now funciona por dentro, onde ficam os arquivos e como investigar
problemas. Para o mapa do que veio do projeto original e o procedimento de atualização, veja
[`sn-sso-upstream.md`](sn-sso-upstream.md). Para suporte ao usuário final, veja a página
**Suporte** da wiki do GitHub.

> No config o modo continua se chamando `servicenow.mode = "mcp"` (e as rotas `/api/sn-mcp/*`),
> por compatibilidade com configs existentes. Desde a 1.4 não há MCP nem Python: é tudo Node.

---

## Visão geral

```
Tela (snMcpPanel / snStatus)         ← polling de /api/sn-mcp/status
        │
handlers/snMcp.js                    ← connect / warmup / disconnect (funções puras)
        │
snMcp/index.js  (registro + fachada) ← um gerenciador e uma fachada por instância;
        │                               get(): Table API com a sessão, limite de 8, retry 202/429,
        │                               BIG-IP, revalidação após 401
snMcp/sessionManager.js              ← estados, sessão salva → login sem janela → janela,
        │                               cooldown, circuit breaker, keep-alive
snMcp/edgeLogin.js                   ← fluxo no Edge: SSO → Microsoft → instância → cookies + g_ck
        │
snMcp/cdpPipe.js                     ← Edge com --remote-debugging-pipe (CDP por pipe, sem deps)
snMcp/loginRules.js                  ← regras puras: URLs de login/MFA, cookies, BIG-IP
snMcp/sessionStore.js                ← lê/atualiza o arquivo de sessão (token e BIG-IP rotacionados)
```

**Por que assim:**
- **Dados direto pela Table API, em paralelo.** Os dados vêm direto da Table API com a sessão do navegador (headers `Cookie`, `User-Agent` e `X-UserToken`), nas mesmas chamadas e com o mesmo paralelismo do modo API.
- **O navegador só serve para o login.**
- **Edge controlado pelo CDP.** O Edge é iniciado com `--remote-debugging-pipe`, que é o mesmo transporte que o Playwright usa com `channel=msedge`. É o Edge corporativo, então SSO, Conditional Access e "Connected to Windows" funcionam como no navegador do dia a dia.
- **Sem Python nem Playwright.** Até a 1.3.x isso era feito pelo `mfa-servicenow-mcp` (Python + Playwright), com ~92 MB de runtime e 8–16 min de instalação na rede corporativa. A migração está registrada nas decisões #177–#184.

### Várias instâncias

Com mais de um Service Now em SSO (`config.snInstances`, decisões #204–#207), cada instância tem o
seu gerenciador de sessão e a sua fachada, criados sob demanda em `createSnMcpRegistry`. A chave é
`host|usuário|loginUrl` (`keyOf`). Por isso, cada instância tem os seus próprios:
- estado, sessão, janela de login, keep-alive, cooldown e circuit breaker;
- limite de 8 chamadas simultâneas.

Uma instância não derruba a sessão da outra.

- **Chamadas:** todas recebem o `snCfg` da instância. Sem `snCfg`, `getStatus` e `isConnected` usam
  a única instância em uso (compatibilidade). `logout()` sem `snCfg` sai de todas.
- **Rotas:** `/api/sn-mcp/*` aceitam `instanceId` (instância salva) ou `instance` (digitada, ainda
  não salva). `GET /api/sn-mcp/status?all=1` lista as instâncias em SSO para o aviso do dashboard
  (`snStatus.js`), que cita a instância e reconecta só ela.
- **Ao abrir o app:** o servidor confere em background a sessão salva de cada instância em SSO. O
  dashboard SN-only é reconstruído quando conecta uma instância que aparece nele (a principal ou
  uma com grupos).
- **Grupos na tela de Configurações:** com a sessão da instância caída, a lista de grupos não é
  buscada (`needsLogin`), para não abrir a janela de login só por abrir a aba.

## Estados (`/api/sn-mcp/status`)

| `state` | Quando | Tela |
|---|---|---|
| `stopped` | Sem sessão validada (início, logout, keep-alive viu a sessão cair: `reason: expired`) | "Entrar" |
| `connecting` | Conferindo a sessão salva ou tentando o login sem janela | "Conectando…" |
| `awaiting_login` | Janela do Edge aberta esperando o usuário | "Conclua o login na janela" |
| `connected` | Sessão aceita pela REST; `user` = nome do `sys_user` | "Conectado como …" |
| `error` | Ver `reason` abaixo | Mensagem + "Tentar de novo" |

`reason` em `error`:
- `cancelled`: janela fechada;
- `cooldown`: espera entre tentativas;
- `edge_missing`;
- `network`: página de login inacessível;
- `timeout`: 5 min sem concluir;
- `auth`: login ok, mas a REST recusou ("nascida morta");
- `other`.

`edgeAvailable: false` desabilita o botão e mostra "Edge não encontrado".

### Ordem do `ensureSession`

1. **Sessão salva** (`session_*.json`): uma sondagem `sys_user_preference`. Se responder 200, conecta sem abrir navegador (~1–2 s).
2. **Login sem janela** (só com ID ou URL de login configurados): Edge `--headless=new` com o perfil da instância, com saída rápida se a tela pedir uma pessoa:
   - página de MFA;
   - campo de senha, e-mail ou código visível por 4 s.
3. **Janela visível**: estado `awaiting_login`, até 5 min.
4. **Gravação e conferência**: grava a sessão e sonda de novo. Se a REST recusar, o erro é `SN_LOGIN_BORN_DEAD`.

Chamadas simultâneas compartilham a mesma promessa (single-flight).

### Proteções

| Regra | Valor | Onde |
|---|---|---|
| Intervalo mínimo entre logins automáticos | 60 s | `MIN_LOGIN_INTERVAL_MS` |
| Circuit breaker | 3 falhas seguidas → espera de 30/60/120 s | `CIRCUIT_*` |
| Janela fechada | espera de 5 s, não conta como tentativa | `CANCEL_COOLDOWN_MS` |
| Botão "Entrar" (`connect`) | ignora o cooldown e zera as falhas | `force: true` |
| Dashboard SN abrindo (`ensure`) | respeita o cooldown (página em loop não abre janelas em série) | `snMcp.ensure` |
| Keep-alive | sonda a cada 5 min; para após 6 h sem consulta real | `KEEPALIVE_MS`, `MAX_IDLE_MS` |
| Concorrência na sessão | 8 chamadas; 202/429 com espera crescente (5 tentativas) | `snMcp/index.js` |

O keep-alive nunca abre janela. Se a sessão caiu, marca `stopped/expired`, e o próximo uso faz o
login, sem janela quando possível.

## Arquivos e pastas

Em `<DATA_DIR>/sn-mcp/`. O `DATA_DIR` é `%APPDATA%\backlog-health` no app instalado ou portátil, e a pasta do repositório em `node server.js`.

| Caminho | O que é |
|---|---|
| `session-edge/profile_<host>_<usuário>/` | Perfil dedicado do Edge (cookies da Microsoft e do SN, "manter conectado") |
| `session-edge/session_<host>_<usuário>.json` | Sessão usada pela REST |
| `logs/backlog-health.log` | Passos do login e do keep-alive (ver abaixo) |
| `venv/`, `runtime/`, `uv/`, `python/`, `pyhooks/` … | Sobras do MCP em Python (≤ 1.3.x). Não são usadas e podem ser apagadas. |

`<host>` troca `.` por `_`. `<usuário>` troca `@` por `_at_` e `.` por `_`. São os mesmos nomes do
MCP, então quem atualiza da 1.3.x reaproveita perfil e sessão.

### Arquivo de sessão

```json
{
  "cookie_header": "JSESSIONID=…; BIGipServerpool_<inst>=…; glide_user_route=…; …",
  "user_agent": "Mozilla/5.0 … Edg/157…",
  "session_token": "<g_ck = X-UserToken>",
  "expires_at": null,
  "instance_url": "https://<instância>",
  "last_validated_at": 1795440000.0,
  "last_login_at": 1795440000.0,
  "source": "backlog-health"
}
```

O `sessionStore` atualiza `session_token` quando a resposta traz um token novo (`X-UserToken`) e
`cookie_header` quando o balanceador (F5 BIG-IP) indica outro backend em `Set-Cookie`. A escrita é
atômica (`.tmp` + `rename`).

## Log (`logs/backlog-health.log`)

| Linha | Significado |
|---|---|
| `saved session ok in Nms` | A sessão salva valeu, sem navegador |
| `login: purged stale cookies: …` | Cookies de sessão antigos removidos do perfil antes do login |
| `login: login start (headless\|window) <url>` | Edge aberto sem janela ou com janela |
| `login: url <url>` | Cada página por onde o login passou (query cortada) |
| `login: sso id submitted` | ID preenchido em `login_locate_sso.do` |
| `login: microsoft account picked` | Conta escolhida sozinha no seletor da Microsoft |
| `login: page asks for input (<seletor>) at <url>` | Sem janela: a tela pede senha, e-mail ou código |
| `silent login needs interaction: …` | Desistiu do modo sem janela e vai abrir a janela |
| `login: network error page, retry n/3` | Página de erro de rede; volta para a página de SSO |
| `login: edge exited at start (profile busy): closed N leftover process(es)` | Perfil preso por um Edge antigo (ver problemas conhecidos) |
| `login: warning: no g_ck captured` / `missing cookies …` | Sessão incompleta; pode virar 401 |
| `window login ok in Nms` / `silent login ok in Nms` | Login concluído |
| `session ready in Nms` | Sessão gravada e aceita pela REST |
| `session failed (<CODE>): …` | Falha; `<CODE>` = `SN_LOGIN_*`, `SN_EDGE_NOT_FOUND`, `SN_AUTH`… |
| `keep-alive ok` / `keep-alive: session expired` / `keep-alive idle, skipped` | Keep-alive |

## Como depurar

```powershell
# login sem janela num perfil novo (temporário), com cada passo na tela e teste da Table API
node scripts/sn-sso-debug.js cnhi.service-now.com usuario@empresa.com

# com janela
node scripts/sn-sso-debug.js vale.service-now.com C0733221 --window

# com o perfil do app (testa a sessão lembrada; feche o app antes)
node scripts/sn-sso-debug.js vale.service-now.com C0733221 --profile "$env:APPDATA\backlog-health\sn-mcp\session-edge\profile_vale_service-now_com_C0733221"
```

O script não grava a sessão do app. Os códigos de erro são os mesmos do log.

Para zerar a sessão de uma instância, use **Sair / trocar conta** no painel dela: ele apaga só o
perfil e o arquivo de sessão daquela instância e usuário. As outras instâncias continuam
conectadas. Para zerar tudo, feche o app e apague `%APPDATA%\backlog-health\sn-mcp`.

## Problemas conhecidos

| Sintoma | Causa | Tratamento |
|---|---|---|
| Consultas voltam vazias ou `HTTP 202` | Uma sessão SSO aceita cerca de 12 transações simultâneas | Limite de 8 + retry (`snMcp/index.js`) |
| Ondas de 401 logo após o login | Faltou `JSESSIONID`/`BIGipServer*` ou o balanceador trocou de backend | Login relê os cookies (C2); `get` absorve BIG-IP e repete (C3) |
| `edge exited at start (profile busy)` | Processo do Edge antigo, de uma queda ou do MCP da 1.3.x, segurando o perfil | `killProfileProcesses` fecha só os processos desse `--user-data-dir` e tenta de novo |
| Edge abre e fecha na hora | `--user-data-dir` relativo | `edgeArgs` resolve para caminho absoluto |
| Sem janela parado em "Pick an account" | Várias contas no Windows | Clique de mouse via CDP na conta do ID (`element.click()` não funciona nessa página) |
| `ERR_TIMED_OUT` na Microsoft | Rede corporativa instável | Volta para a página de SSO (até 3 vezes) |
| ID enviado cai no `login.do` comum | Preenchido antes de a página carregar | Espera `document.readyState === 'complete'` |
| "Não foi possível acessar a página de login" | VPN/rede | Mensagem `network`; o usuário tenta de novo |
| Login bloqueado por política (Conditional Access) | Política da empresa | Igual ao Edge do usuário: é o mesmo navegador. Se bloquear lá, bloqueia aqui |

## Testes

Todos os testes de `tests/unit/snMcp/`:

| Arquivo | O que cobre |
|---|---|
| `loginRules.test.js` | Casos C1, C2, C3 e C5 |
| `cdpPipe.test.js` | Enquadramento `\0`, ids, timeout, `findEdge`, `killProfileProcesses`, fechar com garantia |
| `edgeLogin.test.js` | Fluxo com um Edge falso: SSO, conta, erro de rede, MFA, cancelamento, perfil preso, nomes e formato |
| `sessionManager.test.js` | Estados, single-flight, nascida morta, cooldown e circuit breaker, keep-alive, warmup, logout (inclusive de uma instância só) |
| `registry.test.js` | Várias instâncias: fachada e status por instância, logout de uma sem mexer na outra, eventos com a instância |
| `index.test.js` | REST com a sessão, BIG-IP, revalidação, 202/429, limite de 8 |

Os testes do script de acompanhamento ficam em `tests/unit/scripts/check-sn-upstream.test.js`.
