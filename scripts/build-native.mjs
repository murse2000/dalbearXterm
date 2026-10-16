import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp, copyFile, access, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const output = path.resolve('release/native-win-x64');
const hostOutput = path.resolve('.tools/native-host-build');
const deps = path.resolve('.tools/native-backend');
await mkdir(deps, { recursive: true });
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(path.join(deps, 'package.json'), JSON.stringify({ private: true, dependencies: { serialport: manifest.dependencies.serialport, ssh2: manifest.dependencies.ssh2, 'node-pty': manifest.dependencies['node-pty'] }, allowScripts: manifest.allowScripts }, null, 2));
try { await access(path.join(deps, 'node_modules/node-pty/prebuilds/win32-x64/conpty.node')); }
catch {
  const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  await copyFile('scripts/native-backend-lock.json', path.join(deps, 'package-lock.json'));
  execFileSync(process.execPath, [npm, 'ci', '--prefix', deps, '--omit=dev'], { stdio: 'inherit' });
}
await import('./build-icon.mjs');
execFileSync('dotnet', ['restore', 'src/NativeHost.csproj', '--locked-mode', '--packages', '.tools/nuget'], { stdio: 'inherit' });
execFileSync('dotnet', ['build', 'src/NativeHost.csproj', '-c', 'Release', '--no-restore', `-p:Version=${manifest.version}`, '-o', hostOutput], { stdio: 'inherit' });
await mkdir(path.join(output, 'web'), { recursive: true }); await mkdir(path.join(output, 'runtime'), { recursive: true });
await build({ entryPoints: ['src/renderer.ts'], outfile: path.join(output, 'web/renderer.js'), bundle: true, platform: 'browser', minify: true });
await build({ entryPoints: ['src/native-preload.ts'], outfile: path.join(output, 'web/native-preload.js'), bundle: true, platform: 'browser', minify: true });
await build({ entryPoints: ['src/native-backend.ts'], outfile: path.join(output, 'backend.cjs'), bundle: true, platform: 'node', external: ['serialport', 'ssh2', 'node-pty'], minify: true });
const html = (await readFile('src/index.html', 'utf8')).replaceAll('__APP_VERSION__', manifest.version).replace('<script src="renderer.js"></script>', '<script src="native-preload.js"></script>\n  <script src="renderer.js"></script>');
await writeFile(path.join(output, 'web/index.html'), html); await copyFile('src/style.css', path.join(output, 'web/style.css'));
const packagedModules = path.join(output, 'node_modules');
if (!packagedModules.startsWith(root + path.sep)) throw new Error('배포 폴더가 작업 경로를 벗어났습니다.');
await rm(packagedModules, { recursive: true, force: true });
await cp(path.join(deps, 'node_modules'), packagedModules, { recursive: true, filter: file => !path.relative(path.join(deps, 'node_modules'), file).split(path.sep).some(part => ['test', 'tests', 'fixtures'].includes(part)) && !file.endsWith('.pdb') });
await copyFile(process.execPath, path.join(output, 'runtime/node.exe'));
for (const name of await readdir(hostOutput)) if (name.endsWith('.dll') || name === 'dalbearXterm.exe' || name === 'dalbearXterm.exe.config') await copyFile(path.join(hostOutput, name), path.join(output, name));
await copyFile('assets/icon.svg', path.join(output, 'web/icon.svg'));
const licenses = path.join(output, 'licenses'); await mkdir(licenses, { recursive: true });
for (const name of ['LICENSE.txt', 'NOTICE.txt']) await copyFile(path.join('.tools/nuget/microsoft.web.webview2/1.0.4258.31', name), path.join(licenses, `WebView2-${name}`));
await copyFile('.tools/nuget/newtonsoft.json/13.0.4/LICENSE.md', path.join(licenses, 'Newtonsoft.Json.txt'));
for (const [module, name] of [['@xterm/xterm', 'xterm'], ['@xterm/addon-fit', 'xterm-addon-fit'], ['@xterm/addon-search', 'xterm-addon-search'], ['zod', 'zod']]) await copyFile(path.join('node_modules', module, 'LICENSE'), path.join(licenses, `${name}.txt`));
const nodeLicense = path.join('.tools', `node-${process.version}-LICENSE.txt`);
try { await access(nodeLicense); } catch {
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!response.ok) throw new Error(`Node.js 라이선스 다운로드 실패: ${response.status}`);
  await writeFile(nodeLicense, await response.text());
}
await copyFile(nodeLicense, path.join(licenses, 'Node.js.txt'));
const veloLicense = path.join('.tools', 'velopack-1.2.0-LICENSE.txt');
try { await access(veloLicense); } catch {
  const response = await fetch('https://raw.githubusercontent.com/velopack/velopack/f2edcbcafb81da5b3c884aaea330e225ad91d8b6/LICENSE');
  if (!response.ok) throw new Error(`Velopack 라이선스 다운로드 실패: ${response.status}`);
  await writeFile(veloLicense, await response.text());
}
await copyFile(veloLicense, path.join(licenses, 'Velopack.txt'));
console.log(`Windows 네이티브 빌드 완료: ${output}`);
