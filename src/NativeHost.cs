using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Reflection;
using System.Threading.Tasks;
using Velopack;
using Velopack.Sources;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class NativeHost : Form {
  const string Origin = "https://app.dalbear.invalid/";
  readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
  readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
  readonly MenuStrip menu = new MenuStrip();
  readonly string root = AppDomain.CurrentDomain.BaseDirectory;
  Process backend;
  StreamWriter input;
  IntPtr job;
  bool closing;
  bool shutdownComplete;
  bool backendExited;
  bool fatal;
  string backendError = "";
  UpdateConsent update;
  UpdateDialog updateDialog;
  bool checkingUpdates;
  bool restartForUpdate;
  static readonly string Version = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);

  [STAThread]
  static void Main() {
    VelopackApp.Build().SetAutoApplyOnStartup(false).Run();
    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new NativeHost());
  }
  NativeHost() {
    Text = "dalbearXterm"; Width = 1480; Height = 920; MinimumSize = new Size(1024, 680); BackColor = Color.White;
    Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    Controls.Add(web); Controls.Add(menu); MainMenuStrip = menu; menu.Enabled = false;
    var terminal = new ToolStripMenuItem("터미널");
    Add(terminal, "로컬 터미널 시작", "local", Keys.Control | Keys.Shift | Keys.T);
    Add(terminal, "출력 지우기", "clear"); Add(terminal, "출력 검색", "search", Keys.Control | Keys.Shift | Keys.F);
    terminal.DropDownItems.Add(new ToolStripSeparator()); terminal.DropDownItems.Add("종료", null, delegate { Close(); });
    var sessions = new ToolStripMenuItem("세션"); Add(sessions, "새 시리얼 연결", "serial", Keys.Control | Keys.Shift | Keys.N); Add(sessions, "새 SSH 연결", "ssh"); Add(sessions, "저장된 세션", "sessions"); Add(sessions, "현재 연결 종료", "disconnect");
    var view = new ToolStripMenuItem("보기"); Add(view, "시작 화면", "home"); Add(view, "화면 분할", "split"); Add(view, "SFTP 파일", "files");
    view.DropDownItems.Add("전체 화면", null, delegate { WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; });
    var tools = new ToolStripMenuItem("도구"); Add(tools, "포트 새로고침", "refresh"); Add(tools, "로그 저장 시작 / 종료", "log");
    var help = new ToolStripMenuItem("도움말");
    help.DropDownItems.Add("업데이트 확인…", null, async delegate { await CheckUpdates(true); });
    help.DropDownItems.Add("dalbearXterm 정보", null, delegate { MessageBox.Show(this, "dalbearXterm " + Version + "\n시리얼 · SSH · SFTP 장비 개발 터미널", "정보"); });
    menu.Items.AddRange(new ToolStripItem[] { terminal, sessions, view, tools, help });
    Shown += async delegate {
      try {
        StartBackend();
        var data = Environment.GetEnvironmentVariable("DALBEAR_TEST_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "dalbear-xterm");
        var options = new CoreWebView2EnvironmentOptions();
        var port = Environment.GetEnvironmentVariable("DALBEAR_TEST_CDP_PORT");
        if (!String.IsNullOrEmpty(Environment.GetEnvironmentVariable("DALBEAR_TEST_DATA")) && !String.IsNullOrEmpty(port)) options.AdditionalBrowserArguments = "--remote-debugging-port=" + int.Parse(port);
        var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "WebView2"), options);
        await web.EnsureCoreWebView2Async(environment);
        web.CoreWebView2.SetVirtualHostNameToFolderMapping("app.dalbear.invalid", Path.Combine(root, "web"), CoreWebView2HostResourceAccessKind.DenyCors);
        web.CoreWebView2.Settings.AreHostObjectsAllowed = false;
        web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
        web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { if (e.Uri != Origin + "index.html") e.Cancel = true; };
        web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
        web.CoreWebView2.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) { e.Cancel = true; };
        web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) {
          e.State = e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead && e.IsUserInitiated && e.Uri.StartsWith(Origin) ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        };
        web.CoreWebView2.WebMessageReceived += delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
          if (e.Source != Origin + "index.html" || closing || e.WebMessageAsJson.Length > 1024 * 1024) return;
          Send(e.WebMessageAsJson);
        };
        web.NavigationCompleted += async delegate {
          menu.Enabled = true;
          if (String.IsNullOrEmpty(Environment.GetEnvironmentVariable("DALBEAR_TEST_DATA"))) { await Task.Delay(2000); if (!IsDisposed && !closing) await CheckUpdates(false); }
        };
        web.CoreWebView2.Navigate(Origin + "index.html");
      } catch (Exception error) { fatal = true; MessageBox.Show(this, error.Message, "dalbearXterm 시작 실패", MessageBoxButtons.OK, MessageBoxIcon.Error); Close(); }
    };
    FormClosing += delegate(object sender, FormClosingEventArgs e) {
      if (!shutdownComplete && !backendExited && backend != null && !backend.HasExited) {
        e.Cancel = true;
        if (!closing) { closing = true; menu.Enabled = false; web.Enabled = false; Text = "dalbearXterm · 연결 정리 중"; Send("{\"kind\":\"invoke\",\"action\":\"shutdown\",\"requestId\":-1}"); }
      }
    };
    FormClosed += delegate { if (job != IntPtr.Zero) CloseHandle(job); web.Dispose(); if (input != null) input.Dispose(); if (backend != null) backend.Dispose(); };
  }
  async Task CheckUpdates(bool manual) {
    if (checkingUpdates || closing) return;
    if (updateDialog != null && !updateDialog.IsDisposed) { updateDialog.Show(); updateDialog.BringToFront(); return; }
    checkingUpdates = true;
    try {
      var manager = new UpdateManager(new GithubSource("https://github.com/murse2000/dalbearXterm", null, false));
      if (!manager.IsInstalled) {
        if (manual) MessageBox.Show(this, "GitHub 릴리즈의 설치 파일 또는 Portable.zip으로 실행하면 업데이트를 사용할 수 있습니다.", "업데이트 확인");
        return;
      }
      update = new UpdateConsent(new GithubUpdater(manager)); await update.CheckAsync();
      if (IsDisposed || closing) return;
      if (update.Candidate == null) { if (manual) MessageBox.Show(this, "현재 최신 버전입니다. (" + Version + ")", "업데이트 확인"); return; }
      updateDialog = new UpdateDialog(update, delegate { restartForUpdate = true; Close(); }); updateDialog.Icon = Icon; updateDialog.Show(this);
    } catch (Exception error) { if (manual && !IsDisposed && !closing) MessageBox.Show(this, "업데이트를 확인하지 못했습니다.\n" + error.Message, "업데이트 확인", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    finally { checkingUpdates = false; }
  }
  void Add(ToolStripMenuItem parent, string label, string action, Keys shortcut = Keys.None) {
    var item = new ToolStripMenuItem(label); item.ShortcutKeys = shortcut;
    item.Click += delegate { if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "menu", action = action })); };
    parent.DropDownItems.Add(item);
  }
  void StartBackend() {
    job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    var limits = new JobLimits(); limits.Basic.LimitFlags = 0x2000;
    if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new Win32Exception();
    backend = new Process { EnableRaisingEvents = true, StartInfo = new ProcessStartInfo {
      FileName = Path.Combine(root, "runtime", "node.exe"), Arguments = "\"" + Path.Combine(root, "backend.cjs") + "\"", WorkingDirectory = root,
      UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
      StandardOutputEncoding = new UTF8Encoding(false), StandardErrorEncoding = new UTF8Encoding(false)
    } };
    backend.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
      if (e.Data == null || IsDisposed) return;
      BeginInvoke(new Action(delegate { Receive(e.Data); }));
    };
    backend.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) { backendError += e.Data + "\n"; if (backendError.Length > 3000) backendError = backendError.Substring(backendError.Length - 3000); } };
    backend.Exited += delegate {
      if (IsDisposed || shutdownComplete) return;
      BeginInvoke(new Action(delegate { backendExited = true; if (!closing && !fatal) MessageBox.Show(this, "통신 프로세스가 종료되었습니다.\n" + backendError, "연결 종료", MessageBoxButtons.OK, MessageBoxIcon.Error); Close(); }));
    };
    backend.Start();
    if (!AssignProcessToJobObject(job, backend.Handle)) { backend.Kill(); throw new Win32Exception(); }
    input = new StreamWriter(backend.StandardInput.BaseStream, new UTF8Encoding(false)) { AutoFlush = true };
    backend.BeginOutputReadLine(); backend.BeginErrorReadLine();
  }
  void Send(string message) {
    if (backend != null && !backend.HasExited) { try { input.WriteLine(message); } catch (IOException) { } }
  }
  string Option(Dictionary<string, object> options, string name) { object value; return options.TryGetValue(name, out value) ? Convert.ToString(value) : ""; }
  void Receive(string message) {
    if (IsDisposed) return;
    try {
      var body = json.Deserialize<Dictionary<string, object>>(message);
      var kind = Convert.ToString(body["kind"]);
      if (kind == "dialog") {
        var options = (Dictionary<string, object>)body["options"]; var method = Convert.ToString(body["method"]); object result = null;
        if (closing) result = method == "confirm" ? (object)false : null;
        else if (method == "confirm") result = MessageBox.Show(this, Option(options, "message"), Option(options, "title"), MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        else if (method == "open") { using (var choice = new OpenFileDialog { Title = Option(options, "title"), InitialDirectory = Option(options, "directory"), CheckFileExists = true }) if (choice.ShowDialog(this) == DialogResult.OK) result = choice.FileName; }
        else if (method == "save") { using (var choice = new SaveFileDialog { Title = Option(options, "title"), FileName = Option(options, "name"), OverwritePrompt = true }) if (choice.ShowDialog(this) == DialogResult.OK) result = choice.FileName; }
        Send(json.Serialize(new { kind = "dialog-reply", dialogId = body["dialogId"], result = result }));
      } else if (kind == "reply" && closing && Convert.ToInt32(body["requestId"]) == -1) {
        // 로그·전송 정리 응답을 받은 뒤 소유한 작업 개체를 함께 종료한다.
        if (!(bool)body["ok"]) MessageBox.Show(this, Convert.ToString(body["error"]), "연결 정리 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
        shutdownComplete = true;
        if (restartForUpdate && (bool)body["ok"]) update.ApplyAfterShutdown();
        Close();
      } else if (kind == "fatal") { fatal = true; MessageBox.Show(this, Convert.ToString(body["message"]), "시작 실패", MessageBoxButtons.OK, MessageBoxIcon.Error); }
      else if (web.CoreWebView2 != null && !closing) web.CoreWebView2.PostWebMessageAsJson(message);
    } catch (Exception error) { fatal = true; MessageBox.Show(this, error.Message, "앱 통신 오류", MessageBoxButtons.OK, MessageBoxIcon.Error); Close(); }
  }
  // 창이 비정상 종료되어도 소유한 통신·셸 프로세스가 남지 않게 한다.
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)] struct JobLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref JobLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}
