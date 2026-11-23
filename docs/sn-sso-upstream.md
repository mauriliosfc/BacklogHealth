# Login SSO do Service Now: mapa do port e acompanhamento do original

A lógica de login de `snMcp/` foi portada do projeto
[`jshsakura/mfa-servicenow-mcp`](https://github.com/jshsakura/mfa-servicenow-mcp) (Python +
Playwright), que o app usou até a 1.3.x. Este documento diz **o que veio de onde**, **o que ficou
de fora** e **como trazer correções de versões novas** do original.

- **Versão de referência:** `snMcp/upstream.json` (`referenceVersion`), hoje **1.25.48**.
- **Máquina e problemas:** [`sn-sso.md`](sn-sso.md).

---

## Como verificar se o original mudou

```powershell
npm run check:sn-upstream
```

1. Consulta o PyPI. Se a versão mais recente for igual à de referência, termina ("Nada a fazer").
2. Se houver versão nova:
   - baixa as duas wheels e confere o SHA-256 publicado no PyPI;
   - extrai **só** os arquivos de `trackedFiles`, em `build/sn-upstream/src/<versão>/`.
3. Gera em `build/sn-upstream/`:
   - `<de>..<para>.diff`: o diff completo, com a função inteira em cada trecho;
   - `<de>..<para>.md`: arquivos alterados e **casos afetados**.
     - **símbolo**: um nome listado no caso aparece num trecho alterado (ou no cabeçalho da função do trecho). Prioridade alta.
     - **revisar**: o arquivo do caso mudou, mas nenhum símbolo listado apareceu. Confira se a mudança mexe na mesma lógica.

Para comparar versões específicas, use `npm run check:sn-upstream -- --from 1.25.48 --to 1.26.3`.

### Procedimento de atualização

1. Rode `npm run check:sn-upstream` e abra o `.md` gerado.
2. Leia o changelog do original (link no `.md`). Correções de login e cookies costumam vir explicadas nas notas da versão e nos comentários do código (`# v1.x.y: …`).
3. Para cada caso **símbolo**, leia o trecho no `.diff` e decida:
   - **Portar:** a mudança corrige algo que também vale para nós. Altere a função Node do caso (coluna "Nosso código") e escreva um teste com o cenário do comentário do original.
   - **Ignorar:** a mudança só vale para algo que não portamos (ver "Não portado"). Registre o motivo no histórico.
4. Para cada caso **revisar**, confirme que a mudança não toca a mesma lógica.
5. Se o original criou lógica nova de login em outro arquivo, inclua o arquivo em `trackedFiles` e, se for portar, crie um caso novo em `cases`.
6. Atualize `snMcp/upstream.json` (`referenceVersion` e `reviewedAt`) e a tabela de histórico abaixo.
7. Rode `npm test`, depois o teste real (`node scripts/sn-sso-debug.js <instância> <usuário>`, sem e com `--window`), em pelo menos uma instância.

---

## Mapa dos casos portados

Os nomes de função são do original 1.25.48. O comentário `// Origem:` no código Node aponta para eles.

| Caso | O que resolve (relato do original) | Origem (Python) | Nosso código (Node) | Testes |
|---|---|---|---|---|
| **C1** Páginas de login e MFA | Declarar login concluído com o usuário ainda no MFA. Variantes genéricas `/login_`, `multifactor`, `mfa_` cobrem versões não vistas. MFA é mais estreito, porque `/login.do` aparece de passagem num login que vai dar certo. | `auth/_url_predicates.py`: `_is_login_page_url`, `_is_mfa_challenge_url`, `_visible_window_mid_auth` | `loginRules.js`: `isLoginPageUrl`, `isMfaChallengeUrl`, `isMidAuth`, `isLoggedInUrl` | `loginRules.test.js` › C1 |
| **C2** Cookie jar completo | Sem `JSESSIONID` e `BIGipServer*`, chamadas paralelas caem em backends sem a sessão: ondas de 401 (v1.12.0) | `auth/auth_manager.py`: comentário v1.12.0 em `_login_with_browser_sync`, `_build_instance_cookie_header` | `loginRules.js`: `selectInstanceCookies`, `missingRequiredCookies`; `edgeLogin.js` relê os cookies até 3 vezes | `loginRules.test.js` › C2; `edgeLogin.test.js` › C2 |
| **C3** Rotação do BIG-IP | O F5 responde `Set-Cookie BIGipServerpool_*` apontando o backend da sessão. Absorver e repetir evita um novo login (v1.12.18) | `_response_predicates.py`: `_extract_bigip_routing_hint`; `auth_manager.py`: `_absorb_response_bigip_rotation`; `_cookies.py`: `_replace_cookie_value_in_header` | `loginRules.js`: `bigipHintFrom`, `absorbBigipRotation`; `sessionStore.js`: `absorbBigipRotation`; `index.js`: `get` | `loginRules.test.js` › C3; `sessionStore.test.js`; `index.test.js` › C3 |
| **C4** Captura do `g_ck` | Sem `X-UserToken`, a primeira leitura protegida manda para `/logout_success.do` e vira 401 permanente (v1.11.43). O token é setado um instante depois da navegação, às vezes só no iframe. | `auth_manager.py`: `GCK_CAPTURE_MAX_ATTEMPTS` (8), `GCK_CAPTURE_INTERVAL_SECONDS` (1) | `edgeLogin.js`: `JS_GCK` (janela + iframes), 8 tentativas de 1 s | `edgeLogin.test.js` › C4 |
| **C5** Cookies antigos | Cookies de uma sessão já morta no servidor fazem o novo `login.do` virar logout (v1.11.14/15) | `_response_predicates.py`: `_STALE_PROFILE_COOKIE_NAMES`; `auth_manager.py`: `_purge_stale_profile_cookies` | `loginRules.js`: `STALE_SESSION_COOKIES`; `edgeLogin.js`: `_purgeStaleCookies` (antes de navegar) | `loginRules.test.js` › C5; `edgeLogin.test.js` › C5 |
| **C6** Sem janela primeiro | Login silencioso quando o navegador é lembrado. Se aparecer MFA, sair em ~1 s e abrir a janela sem gastar o cooldown (v1.15.14) | `auth_manager.py`: `_login_with_browser`, `_has_valid_mfa_remembered_cookie`, `force_interactive` | `sessionManager.js`: `_login`; `edgeLogin.js`: `runLogin({ headless })` com `JS_NEEDS_PERSON` | `edgeLogin.test.js` › sem janela; `sessionManager.test.js` › C6 |
| **C7** Cooldown e circuit breaker | O servidor marca contas que disparam logins seguidos (abuso). Janela fechada é espera curta, sem backoff. | `auth_manager.py`: `_MIN_LOGIN_INTERVAL_SECONDS` (60), `_SELF_HEAL_CIRCUIT_THRESHOLD` (3), `_enforce_login_circuit`; `_url_predicates.py`: `_looks_like_user_close` | `sessionManager.js`: `_checkCooldown`, `CIRCUIT_*`, `CANCEL_COOLDOWN_MS` | `sessionManager.test.js` › C7 |
| **C8** Sondagem e nascida morta | Login "ok" cuja sessão a REST não aceita | `auth_manager.py`: `_probe_browser_api_with_cookie`, `_is_browser_session_valid` (`sys_user_preference`) | `sessionManager.js`: `_probe`, `SN_LOGIN_BORN_DEAD` | `sessionManager.test.js` › C8 |
| **C9** Keep-alive | Estender a sessão; parar depois de muito tempo sem uso | `auth/_keepalive.py`: `_DEFAULT_INTERVAL_S` (300), `_DEFAULT_MAX_IDLE_S` (6 h) | `sessionManager.js`: `_keepAliveTick`, `touch` | `sessionManager.test.js` › C9 |
| **C10** Página de SSO | Instâncias com SSO de vários provedores: digitar só o ID em `#sso_selector_id`, nunca a senha | `browser/login.py`: `SSO_USER_FIELD`, `SSO_SUBMIT_SELECTORS`; `utils/instances.py`: `SSO_LOCATOR_PATH` | `edgeLogin.js`: `jsFillSsoLocator`, `startUrlFor` | `edgeLogin.test.js` › C10 |
| **C11** Nome e formato da sessão | Mesmo nome de perfil e de arquivo: a migração da 1.3.x não pede novo login | `auth_manager.py`: `_get_instance_user_suffix`, `_save_session_to_disk`, `_resolve_user_data_dir` | `edgeLogin.js`: `sessionSuffix`, `sessionPaths`, `writeSessionFile`; `sessionStore.js` | `edgeLogin.test.js` › C11 |
| **C12** Rotação do `g_ck` | O ServiceNow troca o token nas respostas | `auth_manager.py`: `_absorb_response_token_rotation` | `sessionStore.js`: `rotatedTokenFrom`, `persistRotatedToken` | `sessionStore.test.js`; `index.test.js` |

### Casos nossos (não existem no original)

Encontrados nos testes reais de nov/2026 (vale e cnhi). Também estão em [`sn-sso.md`](sn-sso.md) › Problemas conhecidos.

| Caso | Onde |
|---|---|
| Seletor de contas da Microsoft: clique de mouse via CDP na conta do ID | `edgeLogin.js`: `jsFindAccountTile` + `Input.dispatchMouseEvent` |
| Página de erro de rede (`chrome-error://`): volta para a página de SSO, até 3 vezes | `loginRules.js`: `isNetworkErrorUrl`; `edgeLogin.js` |
| Preencher o ID só com `readyState === 'complete'` | `edgeLogin.js`: `jsFillSsoLocator` |
| Fechar o Edge com garantia (`Browser.close`, depois `taskkill /T`) | `cdpPipe.js`: `launchEdge().close`, `killTree` |
| Perfil preso por Edge antigo: fechar só os processos do perfil e tentar de novo | `cdpPipe.js`: `killProfileProcesses`; `edgeLogin.js` |
| `--user-data-dir` sempre absoluto | `cdpPipe.js`: `edgeArgs` |

### Diferença consciente em relação ao original

- **C6 sem a trava do cookie lembrado.** O original só tenta sem janela se houver o cookie `glide_mfa_remembered_browser` do ServiceNow.
- **Por que não serve para nós:** com SSO pela Microsoft, quem "lembra" é a Microsoft (cookies dela e a conta conectada ao Windows), e esse cookie do ServiceNow não existe.
- **O que fazemos:** tentamos sem janela sempre que há ID ou URL de login, e saímos em 4 s se a tela pedir senha, e-mail ou código, ou na hora se for página de MFA. O efeito é o mesmo que o original busca: sem janela quando dá, janela rápida quando não dá.

## Não portado (e por quê)

Na hora de atualizar, mudanças nestas partes do original podem ser **ignoradas**:

| Parte do original | Motivo |
|---|---|
| `make_request`, `get_headers` e as ferramentas MCP (`tools/`, `server.py`) | Os dados vão direto pela Table API em `snMcp/index.js` |
| OAuth, basic auth, API key, login por senha (`saved_credentials`) | O app só usa SSO pelo navegador. Usuário e senha ficam no modo API, que tem cliente próprio. |
| Instalação e checagem do Chromium, `_ensure_playwright_ready`, `launch_budget.py` | Usamos o Edge do Windows via CDP |
| Ponte asyncio ↔ Playwright sync, `_offload.py` | Não existe em Node |
| Travas entre vários processos MCP (`_acquire_login_lock`, `_wait_for_other_login`, `_maybe_adopt_sibling_session_update`, `_launch_lock.py`) | Um único processo do app controla a sessão; o single-flight do `sessionManager` cobre |
| Eventos de diagnóstico (`_auth_event`, `_diagnostics.py`) | Equivalente: `logs/backlog-health.log` |
| `browser/` (janela de debug, captura, impersonate, relatórios) | Funções de automação do MCP, fora do login |
| `profile_label` (várias instâncias no mesmo config) | O app tem uma instância por config |

---

## Histórico de revisões

| Data | De → para | O que mudou nos arquivos acompanhados | Portado? |
|---|---|---|---|
| 2026-11-23 | (port inicial) 1.25.48 | Port dos casos C1–C12 a partir da 1.25.48; validado em vale e cnhi (com janela e sem janela) | Sim (port inicial) |
