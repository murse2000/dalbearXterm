using System;
using System.IO;
using Velopack;
using Velopack.Locators;
using Velopack.Sources;
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]

class GithubFeedProbe {
  static void Main(string[] args) {
    try { Run(args); }
    catch (Exception error) { for (var cause = error; cause != null; cause = cause.InnerException) Console.Error.WriteLine(cause.GetType().FullName + ": " + cause.Message); Environment.ExitCode = 1; }
  }
  static void Run(string[] args) {
    var source = new GithubSource("https://github.com/murse2000/dalbearXterm", null, false);
    var packages = Path.GetFullPath("test-results/github-feed"); Directory.CreateDirectory(packages);
    var previous = new UpdateManager(source, locator: new TestVelopackLocator("DalbearXterm", "0.1.0", packages));
    var candidate = previous.CheckForUpdatesAsync().GetAwaiter().GetResult();
    if (candidate == null || candidate.TargetFullRelease.Version.ToString() != args[0]) throw new Exception("공개 릴리즈 버전 불일치");
    if (String.IsNullOrEmpty(candidate.TargetFullRelease.SHA256)) throw new Exception("SHA-256 메타데이터 누락");
    var current = new UpdateManager(source, locator: new TestVelopackLocator("DalbearXterm", args[0], packages));
    if (current.CheckForUpdatesAsync().GetAwaiter().GetResult() != null) throw new Exception("같은 버전을 업데이트로 표시했습니다.");
    Console.WriteLine("인증 토큰 없는 GitHub 업데이트 확인 통과 · 최신 " + args[0] + " · 이전 버전 후보 있음 · 동일 버전 후보 없음 · 다운로드 없음");
  }
}
