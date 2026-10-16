using System;
using System.Threading;
using System.Threading.Tasks;
using Velopack;

class UpdateConsentTests {
  class FakeUpdater : IReleaseUpdater {
    public int Downloads, Installs;
    public bool Fail;
    public TaskCompletionSource<bool> Pending;
    public Task<UpdateInfo> CheckAsync() { return Task.FromResult(new UpdateInfo(new VelopackAsset { Version = SemanticVersion.Parse("0.3.0") }, false, null, new VelopackAsset[0])); }
    public Task DownloadAsync(UpdateInfo update, Action<int> progress, CancellationToken cancellation) {
      Downloads++; cancellation.ThrowIfCancellationRequested();
      if (Fail) throw new Exception("검증 실패"); return Pending == null ? Task.FromResult(true) : Pending.Task;
    }
    public void Apply(VelopackAsset update) { Installs++; }
  }
  static void Require(bool value, string message) { if (!value) throw new Exception(message); }
  static void Main() { Run().GetAwaiter().GetResult(); }
  static async Task Run() {
    var service = new FakeUpdater(); var update = new UpdateConsent(service);
    await update.CheckAsync(); update.ApplyAfterShutdown();
    Require(service.Downloads == 0 && service.Installs == 0, "확인만으로 다운로드·설치하면 안 됩니다.");
    await update.DownloadAsync(false, null, CancellationToken.None);
    Require(service.Downloads == 0, "다운로드 거부 후 파일을 받으면 안 됩니다.");
    Require(!update.ApproveInstall(true), "다운로드 전 설치를 승인하면 안 됩니다.");
    service.Fail = true;
    try { await update.DownloadAsync(true, null, CancellationToken.None); } catch (Exception) { }
    Require(!update.Downloaded && !update.ApproveInstall(true), "실패한 다운로드를 설치하면 안 됩니다.");
    service.Fail = false;
    service.Pending = new TaskCompletionSource<bool>(); var cancellation = new CancellationTokenSource();
    var downloading = update.DownloadAsync(true, null, cancellation.Token);
    Require(!update.ApproveInstall(true), "진행 중인 다운로드를 설치하면 안 됩니다.");
    cancellation.Cancel(); service.Pending.SetResult(true);
    try { await downloading; } catch (OperationCanceledException) { }
    Require(!update.Downloaded && !update.ApproveInstall(true), "취소한 다운로드를 설치하면 안 됩니다.");
    service.Pending = null;
    await update.DownloadAsync(true, null, CancellationToken.None);
    Require(update.Downloaded && service.Installs == 0, "다운로드만 동의했을 때 설치하면 안 됩니다.");
    update.ApproveInstall(false); update.ApplyAfterShutdown();
    Require(service.Installs == 0, "설치 거부·일반 종료 시 적용하면 안 됩니다.");
    var restarted = new UpdateConsent(service); await restarted.CheckAsync(); restarted.ApplyAfterShutdown();
    Require(service.Installs == 0, "다시 실행한 것만으로 이전 패키지를 설치하면 안 됩니다.");
    Require(update.ApproveInstall(true), "완료한 다운로드에 설치 동의가 적용되어야 합니다.");
    Require(service.Installs == 0, "연결 정리가 끝나기 전에 설치하면 안 됩니다.");
    update.ApplyAfterShutdown(); update.ApplyAfterShutdown();
    Require(service.Installs == 1, "동의한 설치는 정리 완료 후 한 번만 실행해야 합니다.");
    Console.WriteLine("업데이트 동의 정책 검증 통과: 확인·거부·실패·보류·재실행·정리 후 설치·중복 방지");
  }
}
