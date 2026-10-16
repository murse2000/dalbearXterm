import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.ts', 'src/preload.ts'], outdir: 'dist', bundle: true, platform: 'node', format: 'cjs', packages: 'external', sourcemap: true });
await build({ entryPoints: ['src/renderer.ts'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', sourcemap: true });
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('dist/index.html', (await readFile('src/index.html', 'utf8')).replaceAll('__APP_VERSION__', manifest.version));
await Promise.all([copyFile('src/style.css', 'dist/style.css'), copyFile('assets/icon.svg', 'dist/icon.svg')]);
