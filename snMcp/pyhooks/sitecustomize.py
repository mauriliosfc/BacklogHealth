"""Backlog Health: ajustes do Playwright para o processo do mfa-servicenow-mcp.

Carregado automaticamente pelo Python (sitecustomize, via PYTHONPATH) apenas no processo do
MCP iniciado pelo app. Cada ajuste só age com a sua variável de ambiente:

BH_SN_BROWSER_CHANNEL=msedge
    O MCP sempre chama ``chromium.launch_persistent_context`` sem canal (usaria o Chromium do
    Playwright). Injetamos ``channel=msedge`` para a janela de login abrir no Edge instalado.
    Se o Edge não abrir (ex.: política corporativa), cai para o Chromium do Playwright usando
    outra pasta de perfil — perfis do Edge e do Chromium não são compatíveis.

BH_SN_FAST_PROBE=1
    No startup o MCP abre e fecha um navegador headless temporário só para confirmar que o
    Chromium está instalado. Em máquinas corporativas isso leva 10-17 s (o fechamento apaga o
    perfil temporário sob o antivírus). Para esse caso (``launch`` não persistente e headless)
    verificamos se o executável existe e devolvemos um objeto com ``close()`` — mesma garantia,
    sem abrir navegador. No modo Edge verificamos o msedge.exe (o Chromium do Playwright não é
    baixado). Se nada existir, segue o fluxo original (erro real do MCP).
"""
import os
import sys


def _log(msg):
    try:
        sys.stderr.write("[backlog-health] " + msg + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _edge_executable():
    """Caminho do msedge.exe instalado (mesmos locais que o Playwright procura no Windows)."""
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if base:
            exe = os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe")
            if os.path.exists(exe):
                return exe
    return ""


class _ProbeBrowser(object):
    """Substituto do navegador da checagem de instalação: só precisa de close()."""

    def close(self, *args, **kwargs):
        return None


def _install():
    channel    = os.environ.get("BH_SN_BROWSER_CHANNEL", "").strip()
    fast_probe = os.environ.get("BH_SN_FAST_PROBE", "").strip() == "1"
    if not channel and not fast_probe:
        return
    try:
        from playwright.sync_api._generated import BrowserType
    except Exception as exc:  # playwright ausente: o MCP reportará o erro real
        _log("playwright hooks disabled: %s" % exc)
        return
    if getattr(BrowserType, "_bh_patched", False):
        return

    def _with_channel(orig, persistent):
        def wrapper(self, *args, **kwargs):
            if not channel or self.name != "chromium" or kwargs.get("channel") or kwargs.get("executable_path"):
                return orig(self, *args, **kwargs)
            try:
                return orig(self, *args, channel=channel, **kwargs)
            except Exception as exc:
                _log("%s could not be launched, falling back to bundled Chromium: %s"
                     % (channel, str(exc).splitlines()[0] if str(exc) else exc))
                if persistent:
                    if args:
                        args = (str(args[0]) + "-chromium",) + tuple(args[1:])
                    elif "user_data_dir" in kwargs:
                        kwargs["user_data_dir"] = str(kwargs["user_data_dir"]) + "-chromium"
                return orig(self, *args, **kwargs)

        wrapper.__name__ = getattr(orig, "__name__", "launch")
        wrapper.__doc__ = getattr(orig, "__doc__", None)
        return wrapper

    orig_launch = BrowserType.launch
    channel_launch = _with_channel(orig_launch, False)

    def launch(self, *args, **kwargs):
        # Checagem de instalação do MCP: headless, não persistente, sem argumentos extras
        if (fast_probe and self.name == "chromium" and kwargs.get("headless", True)
                and not args and set(kwargs) <= {"headless"}):
            # Login no Edge: basta o Edge existir (o Chromium do Playwright nem é baixado)
            if channel == "msedge" and _edge_executable():
                return _ProbeBrowser()
            try:
                exe = self.executable_path
            except Exception:
                exe = ""
            if exe and os.path.exists(exe):
                return _ProbeBrowser()
        return channel_launch(self, *args, **kwargs)

    launch.__doc__ = getattr(orig_launch, "__doc__", None)
    BrowserType.launch = launch
    BrowserType.launch_persistent_context = _with_channel(BrowserType.launch_persistent_context, True)
    BrowserType._bh_patched = True


_install()
