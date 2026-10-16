using System;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Velopack;

public interface IReleaseUpdater {
  Task<UpdateInfo> CheckAsync();
  Task DownloadAsync(UpdateInfo update, Action<int> progress, CancellationToken cancellation);
  void Apply(VelopackAsset update);
}

public sealed class GithubUpdater : IReleaseUpdater {
  readonly UpdateManager manager;
  public GithubUpdater(UpdateManager manager) { this.manager = manager; }
  public Task<UpdateInfo> CheckAsync() { return manager.CheckForUpdatesAsync(); }
  public Task DownloadAsync(UpdateInfo update, Action<int> progress, CancellationToken cancellation) { return manager.DownloadUpdatesAsync(update, progress, cancellation); }
  public void Apply(VelopackAsset update) { manager.WaitExitThenApplyUpdates(update, silent: false, restart: true); }
}

// 다운로드 동의와 설치 동의를 분리하고 정상 종료만으로는 설치하지 않는다.
public sealed class UpdateConsent {
  readonly IReleaseUpdater updater;
  public UpdateInfo Candidate { get; private set; }
  public bool Downloaded { get; private set; }
  public bool InstallApproved { get; private set; }
  public UpdateConsent(IReleaseUpdater updater) { this.updater = updater; }
  public async Task CheckAsync() {
    Candidate = await updater.CheckAsync(); Downloaded = false; InstallApproved = false;
  }
  public async Task<bool> DownloadAsync(bool consent, Action<int> progress, CancellationToken cancellation) {
    if (!consent || Candidate == null) return false;
    Downloaded = false; InstallApproved = false;
    await updater.DownloadAsync(Candidate, progress, cancellation);
    cancellation.ThrowIfCancellationRequested(); Downloaded = true; return true;
  }
  public bool ApproveInstall(bool consent) { InstallApproved = consent && Downloaded; return InstallApproved; }
  public void ApplyAfterShutdown() {
    if (!InstallApproved) return;
    InstallApproved = false; updater.Apply(Candidate.TargetFullRelease);
  }
}

sealed class UpdateDialog : Form {
  readonly UpdateConsent update;
  readonly Action restart;
  readonly Button primary = new Button { Text = "동의하고 다운로드", AutoSize = true };
  readonly Button later = new Button { Text = "나중에", AutoSize = true };
  readonly Label status = new Label { AutoSize = true, MaximumSize = new Size(465, 0) };
  readonly ProgressBar progress = new ProgressBar { Width = 465, Height = 15 };
  readonly CancellationTokenSource cancellation = new CancellationTokenSource();
  bool downloading;
  public UpdateDialog(UpdateConsent update, Action restart) {
    this.update = update; this.restart = restart;
    Text = "dalbearXterm 업데이트"; ClientSize = new Size(505, 375); FormBorderStyle = FormBorderStyle.FixedDialog;
    MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterParent;
    var layout = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(16) };
    var version = update.Candidate.TargetFullRelease.Version;
    layout.Controls.Add(new Label { Text = "새 버전 " + version + "을 사용할 수 있습니다.", Font = new Font(Font, FontStyle.Bold), AutoSize = true, Margin = new Padding(3, 3, 3, 10) });
    layout.Controls.Add(new Label { Text = "다운로드와 설치는 각각 동의한 경우에만 진행합니다.\n나중에를 누르거나 창을 닫으면 자동 설치하지 않습니다.", AutoSize = true, Margin = new Padding(3, 3, 3, 10) });
    layout.Controls.Add(new TextBox { Text = update.Candidate.TargetFullRelease.NotesMarkdown ?? "릴리즈 정보가 없습니다.", Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Width = 465, Height = 155 });
    status.Text = "다운로드 대기 중"; layout.Controls.Add(status); layout.Controls.Add(progress);
    var buttons = new FlowLayoutPanel { AutoSize = true }; buttons.Controls.Add(primary); buttons.Controls.Add(later); layout.Controls.Add(buttons); Controls.Add(layout);
    later.Click += delegate { Close(); };
    FormClosing += delegate { cancellation.Cancel(); };
    primary.Click += async delegate {
      if (downloading) return;
      if (update.Downloaded) {
        var consent = MessageBox.Show(this, "모든 시리얼·SSH·로컬 셸 연결을 종료하고 업데이트한 뒤 재시작할까요?\n설정과 저장된 세션은 유지됩니다.", "업데이트 설치 동의", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        if (update.ApproveInstall(consent)) { primary.Enabled = false; later.Enabled = false; restart(); }
        return;
      }
      downloading = true; primary.Enabled = false; later.Text = "다운로드 취소"; status.Text = "다운로드·무결성 검사 중…";
      var reporter = new Progress<int>(percent => { if (!IsDisposed) progress.Value = Math.Max(0, Math.Min(100, percent)); });
      try {
        await update.DownloadAsync(true, percent => ((IProgress<int>)reporter).Report(percent), cancellation.Token);
        if (!IsDisposed) { status.Text = "검사가 끝났습니다. 설치에 동의하면 연결을 종료하고 재시작합니다."; primary.Text = "설치하고 재시작"; later.Text = "나중에"; }
      } catch (OperationCanceledException) { }
      catch (Exception error) { if (!IsDisposed) { status.Text = "업데이트 실패: " + error.Message; later.Text = "나중에"; } }
      finally { downloading = false; if (!IsDisposed) primary.Enabled = true; }
    };
  }
}
