using System;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Velopack;

class UpdateDialogTests {
  class FakeUpdater : IReleaseUpdater {
    public string Notes;
    public int Downloads, Installs;
    public Task<UpdateInfo> CheckAsync() { return Task.FromResult(new UpdateInfo(new VelopackAsset { Version = SemanticVersion.Parse("0.2.1"), NotesMarkdown = Notes }, false, null, new VelopackAsset[0])); }
    public Task DownloadAsync(UpdateInfo update, Action<int> progress, CancellationToken cancellation) { Downloads++; return Task.FromResult(true); }
    public void Apply(VelopackAsset update) { Installs++; }
  }
  static void Require(bool value, string message) { if (!value) throw new Exception(message); }
  static T Find<T>(Control control) where T : Control {
    foreach (Control child in control.Controls) { if (child is T) return (T)child; var found = Find<T>(child); if (found != null) return found; }
    return null;
  }
  static void CheckLayout(Control parent) {
    foreach (Control child in parent.Controls) {
      Require(parent.ClientRectangle.Contains(child.Bounds), "컨트롤이 창 밖으로 잘립니다: " + child.GetType().Name);
      foreach (Control sibling in parent.Controls) if (child != sibling) Require(!child.Bounds.IntersectsWith(sibling.Bounds), "컨트롤이 겹칩니다.");
      if (child is Label) Require(child.Height >= child.GetPreferredSize(new Size(child.Width, 0)).Height, "안내 문장이 잘립니다.");
      CheckLayout(child);
    }
  }
  [STAThread]
  static void Main(string[] args) {
    try { Run(args); } catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); Environment.ExitCode = 1; }
  }
  static void Run(string[] args) {
    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
    var notes = System.IO.File.ReadAllText("release-notes/0.2.1.md").Replace("\r\n", "\n");
    if (args.Length > 0 && args[0] == "--preview") {
      AppTheme.Set(Array.IndexOf(args, "--dark") >= 0 ? "dark" : "light");
      var preview = new FakeUpdater { Notes = notes }; var candidate = new UpdateConsent(preview); candidate.CheckAsync().GetAwaiter().GetResult();
      using (var dialog = new UpdateDialog(candidate, delegate { throw new Exception("미리보기에서 설치하면 안 됩니다."); })) { dialog.Text += " — 읽기 검증"; Application.Run(dialog); }
      return;
    }
    foreach (var newline in new[] { "\n", "\r\n", "\r" }) {
      var service = new FakeUpdater { Notes = "# 업데이트" + newline + newline + "- 첫 번째 항목" + newline + "- 두 번째 항목" + newline + newline + "저장된 세션과 설정을 유지합니다." };
      var update = new UpdateConsent(service); update.CheckAsync().GetAwaiter().GetResult();
      using (var dialog = new UpdateDialog(update, delegate { throw new Exception("확인만으로 설치하면 안 됩니다."); })) {
        dialog.Show(); Application.DoEvents();
        var body = Find<TextBoxBase>(dialog);
        var text = body.Text;
        var title = body.GetPositionFromCharIndex(text.IndexOf("# 업데이트"));
        var first = body.GetPositionFromCharIndex(text.IndexOf("- 첫 번째"));
        var second = body.GetPositionFromCharIndex(text.IndexOf("- 두 번째"));
        using (var graphics = body.CreateGraphics()) Require(second.Y - first.Y >= body.Font.SizeInPoints * graphics.DpiY / 72, "릴리즈 항목의 줄바꿈 또는 글자 크기에 필요한 줄 간격이 사라졌습니다.");
        Require(first.Y - title.Y == 2 * (second.Y - first.Y), "제목과 첫 항목 사이의 빈 줄이 표시되지 않습니다.");
        body.Select(text.IndexOf("첫 번째"), 3); var selection = body.SelectionStart;
        AppTheme.Set("dark");
        Require(dialog.BackColor == AppTheme.Background && body.ForeColor == AppTheme.Foreground && body.BackColor != SystemColors.Window, "열린 업데이트 창의 배경·글자색이 다크 테마를 따르지 않습니다.");
        Require(body.Text == text && body.SelectionStart == selection && body.SelectionLength == 3, "테마 변경으로 내역이나 선택이 초기화됐습니다.");
        AppTheme.Set("light"); Require(body.BackColor.ToArgb() == Color.White.ToArgb(), "일반 테마로 돌아오지 않았습니다.");
        CheckLayout(dialog);
        var originalSize = body.Size;
        dialog.ClientSize = new Size(dialog.ClientSize.Width + 160, dialog.ClientSize.Height + 120); Application.DoEvents();
        Require(body.Width > originalSize.Width && body.Height > originalSize.Height, "창을 넓혀도 내역 표시 영역이 늘지 않습니다.");
        dialog.Size = dialog.MinimumSize; Application.DoEvents(); CheckLayout(dialog);
        dialog.Scale(new SizeF(1.5f, 1.5f)); Application.DoEvents(); CheckLayout(dialog);
        dialog.Close();
      }
      Require(service.Downloads == 0 && service.Installs == 0, "창 확인·크기 변경·닫기로 다운로드하거나 설치하면 안 됩니다.");
    }
    using (var timer = new System.Windows.Forms.Timer { Interval = 100 }) {
      Exception failure = null;
      timer.Tick += delegate {
        timer.Stop(); var message = Application.OpenForms["테마 동의 검증"];
        if (message == null) foreach (Form form in Application.OpenForms) if (form.Text == "테마 동의 검증") message = form;
        try {
          Require(message != null && message.BackColor == AppTheme.Background, "새 확인 창이 다크 테마를 따르지 않습니다.");
          Require(((Button)message.AcceptButton).DialogResult == DialogResult.No, "설치 확인 창의 기본 선택은 거부여야 합니다.");
          AppTheme.Set("light"); Require(message.BackColor == AppTheme.Background, "열린 확인 창의 테마가 바뀌지 않습니다."); CheckLayout(message);
        } catch (Exception error) { failure = error; }
        finally { if (message != null) message.Close(); }
      };
      AppTheme.Set("dark"); timer.Start();
      var result = AppTheme.ShowMessage(null, "연결을 정리하고 업데이트를 설치할까요?\n설치 여부는 직접 선택해야 합니다.", "테마 동의 검증", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
      if (failure != null) throw failure; Require(result != DialogResult.Yes, "창 닫기를 설치 동의로 처리하면 안 됩니다.");
    }
    Console.WriteLine("업데이트 창 검증 통과: 줄바꿈·한글 간격·크기 변경·테마 전환·내용/선택 유지·확인 창 기본 거부·동의 정책");
  }
}
