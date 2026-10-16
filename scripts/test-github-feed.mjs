import { execFileSync } from 'node:child_process';
import { readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const output = path.resolve('.tools/native-host-build');
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
execFileSync(compiler, ['/nologo', '/utf8output', `/out:${path.join(output, 'GithubFeedProbe.exe')}`, `/reference:${path.join(output, 'Velopack.dll')}`, path.resolve('tests/GithubFeedProbe.cs')], { stdio: 'inherit' });
await copyFile(path.join(output, 'dalbearXterm.exe.config'), path.join(output, 'GithubFeedProbe.exe.config'));
execFileSync(path.join(output, 'GithubFeedProbe.exe'), [version], { stdio: 'inherit' });
