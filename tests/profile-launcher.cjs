const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { app, contentTracing } = require('electron');
const original = Module._load;
const calls = [];
let depth = 0;
// 제품 코드에 계측을 넣지 않고 모듈 초기화 비용을 기록한다.
Module._load = function (request, parent, isMain) {
  const start = performance.now(); const level = depth++;
  try { return original.apply(this, arguments); }
  finally { depth--; calls.push({ request, depth: level, ms: performance.now() - start }); }
};
if (process.env.DALBEAR_PROFILE_NORMAL) app.on('ready', () => { void contentTracing.startRecording({ included_categories: ['devtools.timeline', 'v8', 'blink', 'loading'] }); });
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', async () => {
  fs.writeFileSync(process.env.DALBEAR_MODULE_PROFILE, JSON.stringify(calls.filter(call => call.depth <= 2).sort((a, b) => b.ms - a.ms), null, 2));
  if (process.env.DALBEAR_PROFILE_NORMAL) {
    const metrics = await contents.executeJavaScript(`({ elapsedMs: Date.now() - ${Number(process.env.DALBEAR_STARTED)}, uptimeMs: ${process.uptime() * 1000}, navigation: performance.getEntriesByType('navigation').map(n=>n.toJSON()), resources: performance.getEntriesByType('resource').map(r=>r.toJSON()), paints: performance.getEntriesByType('paint').map(p=>p.toJSON()) })`);
    fs.writeFileSync(path.resolve('test-results/performance/normal-before.json'), JSON.stringify(metrics, null, 2));
    await contentTracing.stopRecording(path.resolve('test-results/performance/startup-trace.json'));
    app.quit();
  }
}));
require(path.resolve('dist/main.js'));
