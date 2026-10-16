const { chromium } = require('playwright');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const net = require('node:net');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createFixture } = require('./fixture.cjs');

async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
(async () => {
  const root = path.resolve('test-results/native'); await fs.mkdir(root, { recursive: true });
  const run = await fs.mkdtemp(path.join(root, 'run-'));
  const settings = path.join(run, 'settings'); await fs.mkdir(settings);
  await fs.writeFile(path.join(run, 'remote.txt'), 'SFTP 네이티브 UI 검증');
  const fixture = await createFixture(run);
  const line = Buffer.from('load 0123456789abcdef 0123456789abcdef 0123456789abcdef 0123456789abcdef\r\n');
  const payload = Buffer.concat(Array.from({ length: Math.ceil(2 * 1024 * 1024 / line.length) }, () => line));
  const load = await createFixture(run, { onShell(channel) {
    channel.on('data', async () => {
      for (let offset = 0; offset < payload.length; offset += 1024) if (!channel.write(payload.subarray(offset, offset + 1024))) await once(channel, 'drain');
      channel.write('\r\nPERFORMANCE_OUTPUT_COMPLETE\r\n');
    });
  } });
  const knownHosts = Object.fromEntries([fixture, load].map(server => [JSON.stringify(['127.0.0.1', server.port]), server.fingerprint]));
  await fs.writeFile(path.join(settings, 'settings.json'), JSON.stringify({ version: 1, profiles: [], knownHosts }));
  const report = { startupMs: [], shutdownMs: [], uiClickMs: [], output: {}, checks: [] };
  try {
    for (let index = 0; index < 3; index++) {
      const port = await freePort(); const started = performance.now();
      const child = spawn(process.env.DALBEAR_NATIVE_EXE || path.resolve('release/native-win-x64/dalbearXterm.exe'), [], { env: { ...process.env, DALBEAR_TEST_DATA: settings, DALBEAR_TEST_CDP_PORT: String(port) }, stdio: 'ignore' });
      const exited = once(child, 'exit'); let browser; let page;
      try {
        const endpoint = `http://127.0.0.1:${port}`;
        while (true) {
          if (child.exitCode !== null) throw new Error(`앱 조기 종료: ${child.exitCode}`);
          try { const response = await fetch(`${endpoint}/json/version`); if (response.ok) break; } catch {}
          if (performance.now() - started > 20000) throw new Error('네이티브 앱 시작 시간 초과');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        browser = await chromium.connectOverCDP(endpoint);
        while (!page) {
          page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('app.dalbear.invalid'));
          if (performance.now() - started > 20000) throw new Error('앱 화면 로드 시간 초과');
          if (!page) await new Promise(resolve => setTimeout(resolve, 25));
        }
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.waitForSelector('.home-brand');
        await page.waitForFunction(() => document.querySelector('#profiles .profile-empty'));
        await page.waitForFunction(() => document.querySelector('#ports .port, #ports .profile-empty'));
        report.startupMs.push(performance.now() - started);
        console.log(JSON.stringify({ launch: index + 1, startupMs: report.startupMs.at(-1) }));
        assert.equal(await page.locator('#theme-select').inputValue(), index === 1 ? 'dark' : 'light', '재실행한 앱은 저장된 테마를 복원해야 합니다.');
        async function selectTheme(theme) {
          await page.locator('#theme-select').selectOption(theme);
          await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && !document.querySelector('#theme-select').disabled, theme);
          assert.equal(await page.evaluate(() => window.terminal.theme()), theme);
          assert.equal(JSON.parse(await fs.readFile(path.join(settings, 'settings.json'), 'utf8')).theme, theme);
        }
        if (index === 0) {
          await selectTheme('dark'); await page.screenshot({ path: path.join(root, 'theme-dark-home.png') });
          await page.locator('#new-ssh').click(); await page.screenshot({ path: path.join(root, 'theme-dark-connection.png') }); await page.locator('#dialog-close').click();
          await page.locator('#new-local').click(); await page.waitForFunction(() => document.querySelector('#session-count').textContent.includes('1'));
          assert.equal(await page.locator('.xterm-rows').evaluate(node => getComputedStyle(node).color), 'rgb(220, 229, 239)', '다크 테마에서 새로 연 터미널도 같은 팔레트를 사용해야 합니다.');
        } else if (index === 1) await selectTheme('light');
        for (let click = 0; click < 3; click++) {
          const start = performance.now(); await page.locator('#new-ssh').click(); await page.waitForFunction(() => document.querySelector('#connection-dialog').open);
          report.uiClickMs.push(performance.now() - start); await page.locator('#dialog-close').click();
        }
        if (index < 2) continue;
        assert.equal(await page.evaluate(() => typeof require), 'undefined'); assert.equal(await page.evaluate(() => typeof process), 'undefined');
        await page.screenshot({ path: path.join(root, '01-workspace.png') });
        await page.locator('#new-serial').click(); await page.locator('#session-name').fill('네이티브 시리얼 저장');
        if (await page.locator('#serial-port option[value="COM3"]').count()) await page.locator('#serial-port').selectOption('COM3');
        await page.locator('#save-only').click();
        await page.waitForSelector('#connection-dialog:not([open])', { state: 'attached' });
        assert.ok((await page.evaluate(() => window.terminal.profiles())).some(profile => profile.name === '네이티브 시리얼 저장'));
        await page.evaluate(() => { window.__received = ''; window.terminal.onEvent(event => { if (event.type === 'data') window.__received += new TextDecoder().decode(event.bytes); }); });
        async function connect(server, name) {
          await page.locator('#new-ssh').click(); await page.locator('#session-name').fill(name); await page.locator('#ssh-host').fill('127.0.0.1'); await page.locator('#ssh-port').fill(String(server.port)); await page.locator('#ssh-user').fill('tester'); await page.locator('#ssh-auth').selectOption('password'); await page.locator('#ssh-password').fill('test-fixture-password'); await page.locator('#connect-button').click();
          await page.waitForSelector('#connection-dialog:not([open])', { state: 'attached' });
          await page.waitForFunction(() => [...document.querySelectorAll('.session-pane:not([hidden]) .session-message')].some(message => message.textContent === '연결됨'));
        }
        await connect(fixture, '네이티브 SSH 검증');
        const densityDirectory = path.resolve('test-results/density'); await fs.mkdir(densityDirectory, { recursive: true });
        const label = process.env.DALBEAR_DENSITY_LABEL || 'after';
        const density = await page.evaluate(() => {
          const rect = selector => { const box = document.querySelector(selector).getBoundingClientRect(); return { width: box.width, height: box.height }; };
          const terminal = rect('.terminal-wrap');
          return { viewport: { width: innerWidth, height: innerHeight }, header: rect('.app-header'), sidebar: rect('.sidebar'), terminal, terminalArea: terminal.width * terminal.height, rows: document.querySelector('.xterm-rows').childElementCount, fontSize: getComputedStyle(document.querySelector('.xterm-rows')).fontSize };
        });
        await fs.writeFile(path.join(densityDirectory, `${label}.json`), JSON.stringify(density, null, 2));
        await page.screenshot({ path: path.join(densityDirectory, `${label}.png`) });
        assert.equal(await page.locator('.sendbar').isVisible(), false);
        assert.equal(await page.locator('#show-sessions').getAttribute('aria-expanded'), 'false');
        await page.locator('#show-sessions').click(); assert.equal(await page.locator('#show-sessions').getAttribute('aria-expanded'), 'true');
        assert.ok(await page.locator('#profiles').isVisible()); await page.locator('#show-sessions').click();
        await page.locator('.session-toolbar').getByRole('button', { name: '송신', exact: true }).click();
        await page.locator('.sendbar input').fill('DALBEAR_NATIVE_SSH_OK'); await page.locator('.sendbar button').click();
        await page.waitForFunction(() => window.__received.includes('수신: DALBEAR_NATIVE_SSH_OK'));
        await page.locator('.session-toolbar').getByRole('button', { name: 'SFTP', exact: true }).click(); await page.waitForSelector('.file-name');
        assert.ok((await page.locator('#file-list').innerText()).includes('remote.txt'));
        await selectTheme('dark'); assert.equal(await page.locator('#files-panel').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(32, 40, 51)');
        await page.screenshot({ path: path.join(root, 'theme-dark-sftp.png') }); await selectTheme('light'); await page.locator('#files-close').click();
        await page.getByRole('button', { name: 'HEX', exact: true }).click(); await page.waitForFunction(() => /^00000000  /.test(document.querySelector('.hex-view').textContent)); await page.getByRole('button', { name: 'HEX', exact: true }).click();
        await page.locator('#new-local').click(); await page.waitForFunction(() => document.querySelector('#session-count').textContent.includes('2'));
        await page.locator('.session-pane:not([hidden]) .session-toolbar').getByRole('button', { name: '송신', exact: true }).click();
        await page.locator('.session-pane:not([hidden]) .sendbar input').fill('Write-Output DALBEAR_NATIVE_PTY_OK'); await page.locator('.session-pane:not([hidden]) .sendbar button').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some(rows => rows.textContent.includes('DALBEAR_NATIVE_PTY_OK')));
        await page.locator('#split').click(); assert.equal(await page.locator('.session-pane:not([hidden])').count(), 2);
        await page.evaluate(() => { window.__themeTerminals = [...document.querySelectorAll('.xterm')]; });
        for (const theme of ['dark', 'light']) {
          await selectTheme(theme);
          assert.ok(await page.evaluate(theme => {
            const terminals = [...document.querySelectorAll('.xterm')];
            const foreground = theme === 'dark' ? 'rgb(220, 229, 239)' : 'rgb(222, 222, 222)';
            const background = theme === 'dark' ? 'rgb(17, 21, 28)' : 'rgb(0, 0, 0)';
            return terminals.every((terminal, index) => terminal === window.__themeTerminals[index] && getComputedStyle(terminal.querySelector('.xterm-rows')).color === foreground)
              && [...document.querySelectorAll('.terminal-wrap, .hex-view')].every(node => getComputedStyle(node).backgroundColor === background)
              && document.querySelector('#session-count').textContent.includes('2')
              && document.querySelector('#workspace').textContent.includes('DALBEAR_NATIVE_PTY_OK');
          }, theme), '기존·분할 터미널의 색상이 함께 바뀌고 연결·출력 이력을 유지해야 합니다.');
          await page.screenshot({ path: path.join(root, `theme-${theme}-split.png`) });
        }
        await page.locator('.session-pane:not([hidden]) .sendbar input').first().fill('DALBEAR_THEME_SSH_OK'); await page.locator('.session-pane:not([hidden]) .sendbar button').first().click();
        await page.waitForFunction(() => window.__received.includes('수신: DALBEAR_THEME_SSH_OK'));
        const openToggles = page.locator('.session-pane:not([hidden]) .session-toolbar button[aria-pressed="true"]');
        while (await openToggles.count()) await openToggles.first().click();
        await page.setViewportSize({ width: 1024, height: 640 });
        assert.ok(await page.evaluate(() => [...document.querySelectorAll('.session-pane:not([hidden])')].every(pane => {
          const bounds = pane.getBoundingClientRect(); const toolbar = pane.querySelector('.session-toolbar');
          return toolbar.getBoundingClientRect().height <= 28 && [...toolbar.querySelectorAll('button')].every(button => button.getBoundingClientRect().right <= bounds.right);
        })), '작은 분할 화면에서도 도구가 잘리거나 두 줄을 차지하면 안 됩니다.');
        await page.screenshot({ path: path.join(root, '03-compact-small.png') });
        await page.setViewportSize(density.viewport);
        await page.screenshot({ path: path.join(root, '02-connected-split.png') }); await page.locator('#split').click();
        await connect(load, '연속 출력 측정');
        await page.locator('.session-pane:not([hidden]) .session-toolbar').getByRole('button', { name: '송신', exact: true }).click();
        await page.evaluate(() => {
          window.__perf = { bytes: 0, chunks: [], maxTimerDelayMs: 0, last: performance.now() };
          window.__perf.timer = setInterval(() => { const now = performance.now(); window.__perf.maxTimerDelayMs = Math.max(window.__perf.maxTimerDelayMs, now - window.__perf.last - 16); window.__perf.last = now; }, 16);
          window.terminal.onEvent(event => { if (event.type === 'data') { window.__perf.bytes += event.bytes.length; window.__perf.chunks.push(event.bytes); } });
        });
        const outputStart = performance.now();
        await page.locator('.session-pane:not([hidden]) .sendbar input').fill('BENCH'); await page.locator('.session-pane:not([hidden]) .sendbar button').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some(rows => rows.textContent.includes('PERFORMANCE_OUTPUT_COMPLETE')), null, { timeout: 60000 });
        const ms = performance.now() - outputStart;
        report.output = { ms, ...await page.evaluate(async () => {
          clearInterval(window.__perf.timer); const bytes = new Uint8Array(window.__perf.bytes); let offset = 0;
          for (const chunk of window.__perf.chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
          return { bytes: window.__perf.bytes, maxTimerDelayMs: window.__perf.maxTimerDelayMs, hash };
        }) };
        assert.equal(report.output.hash, createHash('sha256').update(payload).update('\r\nPERFORMANCE_OUTPUT_COMPLETE\r\n').digest('hex'));
        await page.locator('#new-serial').click(); await page.locator('#session-name').fill('시리얼 도구 검증');
        await page.locator('#serial-port').evaluate(select => select.add(new Option('시험용 미존재 포트', 'DALBEAR_MISSING_TEST_PORT')));
        await page.locator('#serial-port').selectOption('DALBEAR_MISSING_TEST_PORT'); await page.locator('#save-session').uncheck();
        await page.locator('#connect-button').click(); await page.waitForSelector('.session-pane:not([hidden]) .session-message.error');
        assert.ok(await page.locator('.session-pane:not([hidden]) .sendbar').isVisible());
        assert.equal(await page.locator('.session-pane:not([hidden]) .signals').isVisible(), false);
        await page.locator('.session-pane:not([hidden])').getByRole('button', { name: '신호', exact: true }).click();
        assert.ok(await page.locator('.session-pane:not([hidden]) .signals').isVisible());
        await page.locator('.session-pane:not([hidden])').getByRole('button', { name: '신호', exact: true }).click();
        assert.equal(await page.locator('.session-pane:not([hidden]) .signals').isVisible(), false);
        const stored = await fs.readFile(path.join(settings, 'settings.json'), 'utf8'); assert.ok(!stored.includes('test-fixture-password'));
        assert.deepEqual(errors, []);
        report.checks = ['화면·포트 준비', '렌더러 격리', '세션 저장', 'SSH 송수신', 'SFTP 목록', 'HEX 이력', '로컬 PowerShell', '분할 화면', '패널·송신줄 접기', '작은 창 도구 배치', '시리얼 신호 접기·오류 표시', '2MiB 연속 출력', '비밀번호 미저장'];
        report.checks.push('일반·다크 저장/재실행 복원', '기존·분할 터미널 동시 테마 전환', '테마 전환 후 연결·출력 유지');
        await fs.writeFile(path.join(root, 'performance.json'), JSON.stringify(report, null, 2));
      } catch (error) { console.error(error); if (page) { await page.screenshot({ path: path.join(root, 'failure.png') }); console.error(await page.locator('body').innerText()); } throw error; }
      finally {
        const shutdownStart = performance.now();
        if (child.exitCode === null) await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).CloseMainWindow()`]);
        await browser?.close();
        let timeout;
        const stopped = await Promise.race([exited.then(() => true), new Promise(resolve => { timeout = setTimeout(() => resolve(false), 5000); })]); clearTimeout(timeout);
        if (!stopped) { child.kill(); throw new Error('정상 종료 시간 초과'); }
        report.shutdownMs.push(performance.now() - shutdownStart);
      }
    }
  } finally { await fixture.close(); await load.close(); }
  await fs.writeFile(path.join(root, 'performance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
