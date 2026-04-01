using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace BacklogHealth
{
    public partial class MainWindow : Window
    {
        private Process _serverProcess;
        private const string ServerUrl = "http://localhost:3030";

        public MainWindow()
        {
            InitializeComponent();
            Loaded  += OnLoaded;
            Closing += OnClosing;
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            try
            {
                StartServer();
                statusText.Text = "Conectando...";
                await WaitForServerAsync();
                await InitWebViewAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Erro ao iniciar o Backlog Health:\n\n" + ex.Message,
                    "Backlog Health", MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
            }
        }

        private void StartServer()
        {
            if (IsPortInUse()) return;

            var exeDir    = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
            var serverExe = Path.Combine(exeDir, "server.exe");

            if (!File.Exists(serverExe))
                throw new FileNotFoundException("server.exe não encontrado em:\n" + exeDir);

            var psi = new ProcessStartInfo(serverExe)
            {
                UseShellExecute = false,
                CreateNoWindow  = true,
                WindowStyle     = ProcessWindowStyle.Hidden,
            };

            _serverProcess = Process.Start(psi);
        }

        private static bool IsPortInUse()
        {
            try
            {
                using (var client = new System.Net.Sockets.TcpClient())
                {
                    client.Connect("127.0.0.1", 3030);
                    return true;
                }
            }
            catch { return false; }
        }

        private async Task WaitForServerAsync()
        {
            using (var http = new HttpClient())
            {
                http.Timeout = TimeSpan.FromSeconds(3);
                for (int i = 0; i < 20; i++)
                {
                    try
                    {
                        var r = await http.GetAsync(ServerUrl);
                        if (r.IsSuccessStatusCode) return;
                    }
                    catch { }
                    await Task.Delay(500);
                }
            }
            throw new TimeoutException("O servidor não respondeu após 10 segundos.");
        }

        private async Task InitWebViewAsync()
        {
            var userDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BacklogHealth", "WebView2");

            var env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
            await webView.EnsureCoreWebView2Async(env);

            var s = webView.CoreWebView2.Settings;
            s.AreDevToolsEnabled            = false;
            s.IsStatusBarEnabled            = false;
            s.AreDefaultContextMenusEnabled = false;
            s.IsZoomControlEnabled          = false;

            webView.CoreWebView2.NavigationCompleted += (o, args) =>
            {
                statusText.Visibility = Visibility.Hidden;
                webView.Visibility    = Visibility.Visible;
            };

            webView.Source = new Uri(ServerUrl);
        }

        private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            try { _serverProcess?.Kill(); } catch { }
        }
    }
}
