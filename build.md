# Build — Backlog Health Dashboard

## Pré-requisitos (apenas na máquina de desenvolvimento)

| Ferramenta | Versão | Instalação |
|---|---|---|
| Node.js | 18+ | `winget install OpenJS.NodeJS.LTS` |
| PKG | qualquer | `npm install -g pkg` |
| .NET SDK | 8.0+ | `winget install Microsoft.DotNet.SDK.8` (o build usa .NET Framework 4.8 como target, mas o SDK 8 é necessário para compilar) |

> O usuário final **não precisa** de nenhuma dessas ferramentas instaladas.

---

## Estrutura do build

O sistema é composto por dois executáveis gerados separadamente:

```
dist/app/
├── BacklogHealth.exe        ← wrapper WebView2 (abre a janela do app)
├── BacklogHealth.exe.config ← configuração .NET (gerado automaticamente)
├── server.exe               ← servidor Node.js com toda a aplicação
├── Microsoft.Web.WebView2.Core.dll
├── Microsoft.Web.WebView2.Wpf.dll
├── WebView2Loader.dll
└── runtimes/                ← DLLs nativas do WebView2
```

---

## Passo a passo

### 1. Gerar o servidor Node.js (`server.exe`)

```bash
npm run build
```

> Gera `dist/BacklogHealth.exe` via PKG. Internamente é o servidor Node.js empacotado com toda a aplicação (HTML, CSS, JS, módulos).

O script está configurado em `package.json`:
```json
"build": "pkg . --targets node18-win-x64 --output dist/BacklogHealth.exe --compress GZip"
```

---

### 2. Gerar o wrapper WebView2 (`BacklogHealth.exe`)

```bash
"C:\Program Files\dotnet\dotnet.exe" publish wrapper/BacklogHealth.csproj -c Release -o dist/app
```

> Gera o wrapper WPF que abre a janela nativa do Windows e inicia o servidor em background.

---

### 3. Copiar o servidor para a pasta de distribuição

```bash
copy dist\BacklogHealth.exe dist\app\server.exe
```

> O wrapper procura por `server.exe` na mesma pasta onde está o `BacklogHealth.exe`.

---

### 4. Limpeza opcional (reduz tamanho)

```bash
del dist\app\BacklogHealth.pdb
del dist\app\Microsoft.Web.WebView2.WinForms.dll
```

---

### 5. Distribuição

Compacte a pasta `dist/app/` em um `.zip` e entregue ao usuário.

O usuário só precisa:
1. Extrair o `.zip` em qualquer pasta
2. Clicar duas vezes em `BacklogHealth.exe`

---

## Requisitos na máquina do usuário final

| Requisito | Situação |
|---|---|
| Node.js | ❌ não precisa |
| .NET | ❌ não precisa (.NET Framework 4.8 já vem no Windows 10/11) |
| WebView2 Runtime | ✅ já vem pré-instalado no Windows 10 atualizado e Windows 11 |
| Edge ou outro browser | ❌ não precisa |

> **Windows 10 desatualizado:** caso o WebView2 Runtime não esteja presente, o usuário verá uma mensagem de erro ao abrir. Nesse caso, basta instalar o [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) gratuitamente pela Microsoft.

---

## Observações

- O `config.json` (credenciais do Azure DevOps) é salvo automaticamente na pasta do `server.exe` na primeira configuração.
- O servidor roda em `http://localhost:3030` — não fica exposto na rede.
- Ao fechar a janela do `BacklogHealth.exe`, o servidor é encerrado automaticamente.
- Para rodar em modo desenvolvimento (sem gerar exe): `nodemon server.js` ou `node server.js`.
