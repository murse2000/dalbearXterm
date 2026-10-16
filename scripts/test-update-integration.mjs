import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, writeFile, readdir, mkdtemp, access } from 'node:fs/promises';
import path from 'node:path';
const root = await mkdtemp(path.resolve('test-results/update-'));
const app = path.join(root, 'app'); const feed = path.join(root, 'feed'); await mkdir(app); await mkdir(feed);
const host = path.resolve('.tools/native-host-build');
for (const file of ['Velopack.dll', 'Newtonsoft.Json.dll']) await copyFile(path.join(host, file), path.join(app, file));
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
execFileSync(compiler, ['/nologo', '/utf8output', `/out:${path.join(app, 'UpdateIntegration.exe')}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', `/reference:${path.join(app, 'Velopack.dll')}`, path.resolve('src/Updates.cs'), path.resolve('tests/UpdateIntegration.cs')], { stdio: 'inherit' });
const vpk = path.resolve('.tools/vpk/vpk.exe');
for (const version of ['0.1.0', '0.2.0']) execFileSync(vpk, ['pack', '--packId', 'DalbearUpdateTest', '--packVersion', version, '--packDir', app, '--mainExe', 'UpdateIntegration.exe', '--outputDir', feed, '--noInst', '--skip-updates', '--yes'], { stdio: 'inherit' });
const portable = path.join(root, 'portable');
// 최신 포터블에서 구버전 매니페스트를 조작하지 않고 실제 구버전 패키지로 시작한다.
const oldFeed = path.join(root, 'old-feed'); await mkdir(oldFeed);
execFileSync(vpk, ['pack', '--packId', 'DalbearUpdateTest', '--packVersion', '0.1.0', '--packDir', app, '--mainExe', 'UpdateIntegration.exe', '--outputDir', oldFeed, '--noInst', '--skip-updates', '--yes'], { stdio: 'inherit' });
const quote = value => `'${value.replaceAll("'", "''")}'`;
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${quote(path.join(oldFeed, 'DalbearUpdateTest-win-Portable.zip'))} -DestinationPath ${quote(portable)}`]);
const exe = path.join(portable, 'current/UpdateIntegration.exe'); await access(exe);
const result = path.join(root, 'result.txt'); await writeFile(result + '.settings', '저장된 세션 보존');
const env = { ...process.env, DALBEAR_UPDATE_TEST_FEED: feed, DALBEAR_UPDATE_TEST_RESULT: result };
for (const action of ['check', 'download', 'check']) execFileSync(exe, [], { env: { ...env, DALBEAR_UPDATE_TEST_ACTION: action }, stdio: 'inherit' });
const badFeed = path.join(root, 'bad-feed'); await mkdir(badFeed);
for (const file of await readdir(feed)) if (file.endsWith('.json') || file.endsWith('.nupkg')) await copyFile(path.join(feed, file), path.join(badFeed, file));
const badPackage = path.join(badFeed, 'DalbearUpdateTest-0.2.0-full.nupkg'); const bytes = await readFile(badPackage); bytes[100] ^= 255; await writeFile(badPackage, bytes);
// 캐시된 정상 패키지가 검증을 대신하지 않도록 별도의 구버전 포터블을 사용한다.
const badPortable = path.join(root, 'bad-portable');
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${quote(path.join(oldFeed, 'DalbearUpdateTest-win-Portable.zip'))} -DestinationPath ${quote(badPortable)}`]);
execFileSync(path.join(badPortable, 'current/UpdateIntegration.exe'), [], { env: { ...env, DALBEAR_UPDATE_TEST_FEED: badFeed, DALBEAR_UPDATE_TEST_ACTION: 'corrupt' }, stdio: 'inherit' });
execFileSync(exe, [], { env: { ...env, DALBEAR_UPDATE_TEST_ACTION: 'apply' }, stdio: 'inherit' });
const deadline = Date.now() + 30000;
while (true) {
  try { console.log(await readFile(result, 'utf8')); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (Date.now() > deadline) throw new Error('업데이트 후 재시작 검증 시간 초과');
  await new Promise(resolve => setTimeout(resolve, 100));
}
