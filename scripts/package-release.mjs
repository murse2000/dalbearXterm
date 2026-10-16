import { readFile, readdir, access, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const version = manifest.version;
const output = path.resolve('release/github');
const vpk = path.resolve('.tools/vpk/vpk.exe');
try { await access(vpk); } catch { execFileSync('dotnet', ['tool', 'install', 'vpk', '--tool-path', '.tools/vpk', '--version', '1.2.0'], { stdio: 'inherit' }); }
execFileSync(process.execPath, ['scripts/build-native.mjs'], { stdio: 'inherit' });
execFileSync(vpk, ['pack', '--packId', 'DalbearXterm', '--packVersion', version, '--packDir', path.resolve('release/native-win-x64'), '--mainExe', 'dalbearXterm.exe', '--packTitle', 'dalbearXterm', '--packAuthors', 'murse2000', '--icon', path.resolve('assets/icon.ico'), '--releaseNotes', path.resolve(`release-notes/${version}.md`), '--runtime', 'win-x64', '--framework', 'net48,webview2', '--outputDir', output, '--skip-updates', '--yes'], { stdio: 'inherit' });
const sums = [];
for (const name of (await readdir(output)).sort()) if (name !== 'SHA256SUMS') sums.push(`${createHash('sha256').update(await readFile(path.join(output, name))).digest('hex')}  ${name}`);
await writeFile(path.join(output, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(`릴리즈 패키지 완료: ${output}`);
