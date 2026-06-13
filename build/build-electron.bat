@echo off
setlocal
cd /d "%~dp0.."

echo.
echo === Backlog Health - Electron Build ===
echo.

:: ── 1. Atualiza o 7za.exe bundled com a versao do sistema ──────────────────
set "SEVENZIP=%ProgramFiles%\7-Zip\7z.exe"
if not exist "%SEVENZIP%" (
  echo [AVISO] 7-Zip nao encontrado em "%SEVENZIP%". Pulando atualizacao do 7za.
) else (
  taskkill /F /IM 7za.exe >nul 2>&1
  copy /Y "%SEVENZIP%" "node_modules\7zip-bin\win\x64\7za.exe" >nul
  echo [OK] 7za.exe atualizado para a versao do sistema.
)

:: ── 2. Regenera o icon.ico com o design atual ──────────────────────────────
echo Gerando icon.ico...
node build\gen-icon.js
if %ERRORLEVEL% neq 0 (
  echo [ERRO] Falha ao gerar icon.ico. Abortando.
  pause & exit /b 1
)
echo [OK] icon.ico atualizado.

:: ── 3. Remove cache corrompido do winCodeSign ──────────────────────────────
set "WINCSC=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
if exist "%WINCSC%" (
  rmdir /S /Q "%WINCSC%"
  echo [OK] Cache winCodeSign limpo.
)

:: ── 4. Limpa cache de icones do Windows (forca refresh no Explorer) ─────────
ie4uinit.exe -show >nul 2>&1

:: ── 5. Gera o build ────────────────────────────────────────────────────────
echo.
echo Gerando build...
echo.
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run electron:build
set BUILD_EXIT=%ERRORLEVEL%

echo.
if %BUILD_EXIT% equ 0 (
  echo === Build concluido com sucesso! ===
  echo.
  echo Artefatos em dist\electron\:
  dir /B "dist\electron\*.exe" 2>nul
) else (
  echo === ERRO no build (codigo %BUILD_EXIT%) ===
)

echo.
pause
endlocal
