const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createFixture } = require('./fixture.cjs');

(async () => {
  const label = process.argv[2] || 'sample';
  const root = path.resolve('test-results/performance'); await fs.mkdir(root, { recursive: true });
  const data = await fs.mkdtemp(path.join(root, `${label}-`));
  const env = { ...process.env, DALBEAR_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const report = { label, executable: process.env.DALBEAR_EXE || 'source', startup: [], uiClickMs: [], output: {} };
  const launches = Number(process.env.DALBEAR_LAUNCHES || (process.env.DALBEAR_PROFILE_MODULES ? 1 : 3));
  for (let index = 0; index < launches; index++) {
    if (process.env.DALBEAR_PROFILE_MODULES) env.DALBEAR_MODULE_PROFILE = path.join(root, 'startup-modules.json');
    const start = performance.now();
    const application = await electron.launch({ executablePath: process.env.DALBEAR_EXE || require('electron'), args: process.env.DALBEAR_EXE ? [] : [process.env.DALBEAR_PROFILE_MODULES ? 'tests/profile-launcher.cjs' : '.'], env, cwd: path.resolve('.'), timeout: 30000 });
    try {
      const page = await application.firstWindow(); await page.waitForSelector('.home-brand');
      const visibleMs = performance.now() - start;
      await page.waitForFunction(() => document.querySelector('#profiles .profile-empty'));
      const profilesMs = performance.now() - start;
      await page.waitForFunction(() => document.querySelector('#ports .port, #ports .profile-empty'));
      const portsMs = performance.now() - start;
      report.startup.push({ visibleMs, profilesMs, portsMs, navigation: await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { domMs: n.domContentLoadedEventEnd, loadMs: n.loadEventEnd }; }) });
      for (let click = 0; click < 3; click++) {
        const started = performance.now(); await page.locator('#new-ssh').click(); await page.waitForFunction(() => document.querySelector('#connection-dialog').open); report.uiClickMs.push(performance.now() - started); await page.locator('#dialog-close').click();
      }
      if (index !== launches - 1 || process.env.DALBEAR_PROFILE_MODULES) continue;
      const line = Buffer.from('load 0123456789abcdef 0123456789abcdef 0123456789abcdef 0123456789abcdef\r\n');
      const payload = Buffer.concat(Array.from({ length: Math.ceil(2 * 1024 * 1024 / line.length) }, () => line));
      const fixture = await createFixture(data, { onShell(channel) {
        channel.on('data', async () => {
          for (let offset = 0; offset < payload.length; offset += 1024) if (!channel.write(payload.subarray(offset, offset + 1024))) await new Promise(resolve => channel.once('drain', resolve));
          channel.write('\r\nPERFORMANCE_OUTPUT_COMPLETE\r\n');
        });
      } });
      try {
        await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
        await page.locator('#new-ssh').click(); await page.locator('#session-name').fill('성능 측정'); await page.locator('#ssh-host').fill('127.0.0.1'); await page.locator('#ssh-port').fill(String(fixture.port)); await page.locator('#ssh-user').fill('tester'); await page.locator('#ssh-auth').selectOption('password'); await page.locator('#ssh-password').fill('test-fixture-password'); await page.locator('#connect-button').click(); await page.waitForFunction(() => document.querySelector('.session-message')?.textContent === '연결됨');
        const sendToggle = page.locator('.session-toolbar').getByRole('button', { name: '송신', exact: true });
        if (await sendToggle.count()) await sendToggle.click();
        await page.evaluate(() => {
          window.__perf = { bytes: 0, maxTimerDelayMs: 0, last: performance.now() };
          window.__perf.timer = setInterval(() => { const now = performance.now(); window.__perf.maxTimerDelayMs = Math.max(window.__perf.maxTimerDelayMs, now - window.__perf.last - 16); window.__perf.last = now; }, 16);
          window.terminal.onEvent(event => { if (event.type === 'data') window.__perf.bytes += event.bytes.length; });
        });
        const cdp = await page.context().newCDPSession(page);
        if (!process.env.DALBEAR_NO_CPU_PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
        const started = performance.now();
        await page.locator('.sendbar input').fill('BENCH'); await page.locator('.sendbar button').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some(rows => rows.textContent.includes('PERFORMANCE_OUTPUT_COMPLETE')), { timeout: 60000 });
        const outputMs = performance.now() - started;
        const profile = process.env.DALBEAR_NO_CPU_PROFILE ? { nodes: [], samples: [] } : (await cdp.send('Profiler.stop')).profile;
        if (!process.env.DALBEAR_NO_CPU_PROFILE) await fs.writeFile(path.join(root, `${label}.cpuprofile`), JSON.stringify(profile));
        const observed = await page.evaluate(() => { clearInterval(window.__perf.timer); return { bytes: window.__perf.bytes, maxTimerDelayMs: window.__perf.maxTimerDelayMs }; });
        const samples = new Map(); for (const id of profile.samples || []) samples.set(id, (samples.get(id) || 0) + 1);
        report.output = { ...observed, ms: outputMs, MiBPerSecond: observed.bytes / (1024 * 1024) / (outputMs / 1000), topFunctions: profile.nodes.map(node => ({ name: node.callFrame.functionName, samples: samples.get(node.id) || 0, line: node.callFrame.lineNumber })).sort((a, b) => b.samples - a.samples).slice(0, 12) };
      } finally { await fixture.close(); }
    } finally { await application.close(); }
  }
  await fs.writeFile(path.join(root, `${label}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
