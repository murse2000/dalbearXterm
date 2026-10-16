using System;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class NativeStartup {
  [STAThread]
  static void Main() {
    Application.EnableVisualStyles();
    var window = new Form { Text = "시작 시간 비교", Width = 1480, Height = 920 };
    var web = new WebView2 { Dock = DockStyle.Fill };
    window.Controls.Add(web);
    window.Shown += async delegate {
      var environment = await CoreWebView2Environment.CreateAsync(null, Path.GetFullPath("test-results/performance/webview2-data"));
      await web.EnsureCoreWebView2Async(environment);
      web.NavigationCompleted += delegate {
        var elapsed = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - long.Parse(Environment.GetEnvironmentVariable("DALBEAR_STARTED"));
        File.WriteAllText(Path.GetFullPath("test-results/performance/native-startup.json"), "{\"elapsedMs\":" + elapsed + "}");
        window.Close();
      };
      web.NavigateToString("<html><body>시작 시간 비교용 빈 창</body></html>");
    };
    Application.Run(window);
  }
}
