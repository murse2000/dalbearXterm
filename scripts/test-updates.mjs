import { execFileSync } from 'node:child_process';
import path from 'node:path';
const output = path.resolve('.tools/native-host-build');
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
execFileSync(compiler, ['/nologo', '/utf8output', `/out:${path.join(output, 'UpdateConsentTests.exe')}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', `/reference:${path.join(output, 'Velopack.dll')}`, path.resolve('src/Updates.cs'), path.resolve('tests/UpdateConsentTests.cs')], { stdio: 'inherit' });
execFileSync(path.join(output, 'UpdateConsentTests.exe'), [], { stdio: 'inherit' });
