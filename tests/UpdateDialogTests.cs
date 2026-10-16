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
    Console.WriteLine("업데이트 창 검증 통과: LF·CRLF·CR 문단/한글 줄 간격·확대/최소 크기·150% 배율·동의 없는 작업 방지");
  }
}
