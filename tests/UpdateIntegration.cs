using System;
using System.IO;
using System.Threading;
using Velopack;

class UpdateIntegration {
  static void Main(string[] args) {
    VelopackApp.Build().SetAutoApplyOnStartup(false).Run();
    var feed = Environment.GetEnvironmentVariable("DALBEAR_UPDATE_TEST_FEED");
    var result = Environment.GetEnvironmentVariable("DALBEAR_UPDATE_TEST_RESULT");
    if (String.IsNullOrEmpty(feed) || String.IsNullOrEmpty(result)) return;
    var manager = new UpdateManager(feed);
    var action = Environment.GetEnvironmentVariable("DALBEAR_UPDATE_TEST_ACTION");
    if (action == "verify") {
      if (manager.CurrentVersion.ToString() != "0.2.0") throw new Exception("버전 교체 실패");
      if (File.ReadAllText(result + ".settings") != "저장된 세션 보존") throw new Exception("설정 보존 실패");
      File.WriteAllText(result, "설치 동의 후 0.2.0 교체·재시작·설정 보존 통과"); return;
    }
    if (manager.CurrentVersion.ToString() != "0.1.0") throw new Exception("동의 전에 버전이 바뀌었습니다.");
    var update = new UpdateConsent(new GithubUpdater(manager)); update.CheckAsync().GetAwaiter().GetResult();
    if (update.Candidate == null) throw new Exception("업데이트 후보 누락");
    if (action == "check") {
      update.DownloadAsync(false, null, CancellationToken.None).GetAwaiter().GetResult(); update.ApplyAfterShutdown();
    } else if (action == "download") {
      update.DownloadAsync(true, null, CancellationToken.None).GetAwaiter().GetResult(); update.ApproveInstall(false); update.ApplyAfterShutdown();
      if (manager.UpdatePendingRestart == null) throw new Exception("검증된 다운로드 누락");
    } else if (action == "corrupt") {
      try { update.DownloadAsync(true, null, CancellationToken.None).GetAwaiter().GetResult(); }
      catch { if (update.Downloaded || update.ApproveInstall(true)) throw new Exception("손상된 파일 설치 가능"); Console.WriteLine("손상 패키지 거부 통과"); return; }
      throw new Exception("손상 패키지를 거부하지 않았습니다.");
    } else if (action == "apply") {
      update.DownloadAsync(true, null, CancellationToken.None).GetAwaiter().GetResult(); update.ApproveInstall(true);
      Environment.SetEnvironmentVariable("DALBEAR_UPDATE_TEST_ACTION", "verify"); update.ApplyAfterShutdown();
    } else throw new Exception("알 수 없는 시험 작업");
    Console.WriteLine(action + " 통과 · 현재 버전 " + manager.CurrentVersion);
  }
}
