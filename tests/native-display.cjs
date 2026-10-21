const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createFixture } = require('./fixture.cjs');

// 네이티브 배포본에서 글꼴·하이라이트 설정이 실제로 동작하고 저장되는지 확인한다.
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function openApp(settings) {
  const port = await freePort();
  const child = spawn(process.env.DALBEAR_NATIVE_EXE || path.resolve('release/native-win-x64/dalbearXterm.exe'), [], { env: { ...process.env, DALBEAR_TEST_DATA: settings, DALBEAR_TEST_CDP_PORT: String(port) }, stdio: 'ignore' });
  const endpoint = `http://127.0.0.1:${port}`;
  const start = performance.now();
  while (true) {
    if (child.exitCode !== null) throw new Error(`앱 조기 종료: ${child.exitCode}`);
    try { const response = await fetch(`${endpoint}/json/version`); if (response.ok) break; } catch {}
    if (performance.now() - start > 20000) throw new Error('네이티브 앱 시작 시간 초과');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const browser = await chromium.connectOverCDP(endpoint);
  let page;
  while (!page) {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('app.dalbear.invalid'));
    if (!page) await new Promise(resolve => setTimeout(resolve, 25));
  }
  return { child, browser, page };
}
(async () => {
  const root = path.resolve('test-results/native-display'); await fs.mkdir(root, { recursive: true });
  const run = await fs.mkdtemp(path.join(root, 'run-'));
  const settings = path.join(run, 'settings'); await fs.mkdir(settings);
  const fixture = await createFixture(run);
  await fs.writeFile(path.join(settings, 'settings.json'), JSON.stringify({ version: 1, profiles: [], knownHosts: { [JSON.stringify(['127.0.0.1', fixture.port])]: fixture.fingerprint } }));
  const errors = [];
  let app;
  try {
    // 1회차: 연결 후 글꼴·하이라이트를 저장한다.
    app = await openApp(settings);
    const page = app.page;
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.home-brand');
    await page.waitForFunction(() => document.querySelector('#ports .port, #ports .profile-empty'));
    await page.locator('#new-ssh').click();
    await page.locator('#session-name').fill('네이티브 표시 검증');
    await page.locator('#ssh-host').fill('127.0.0.1'); await page.locator('#ssh-port').fill(String(fixture.port)); await page.locator('#ssh-user').fill('tester');
    await page.locator('#ssh-auth').selectOption('password'); await page.locator('#ssh-password').fill('test-fixture-password');
    await page.locator('#connect-button').click();
    await page.waitForFunction(() => document.querySelector('.session-message')?.textContent === '연결됨');
    await page.locator('.session-toolbar').getByRole('button', { name: '송신', exact: true }).click();
    await page.locator('.sendbar select').nth(1).selectOption('lf');
    await page.locator('.sendbar input').fill('ERROR_CODE_1');
    await page.locator('.sendbar button[type=submit]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some(row => row.textContent.includes('ERROR_CODE_1')));
    await page.locator('#open-display-settings').click();
    await page.waitForSelector('#terminal-settings-dialog[open]');
    await page.waitForFunction(() => document.getElementById('display-size').value !== '');
    await page.locator('#display-size').fill('20');
    await page.locator('#highlight-pattern').fill('ERROR');
    await page.locator('#highlight-color').fill('#ff6b6b');
    await page.locator('#highlight-apply').click();
    await page.locator('#terminal-settings-save').click();
    await page.waitForFunction(() => !document.getElementById('terminal-settings-dialog').open);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.xterm-rows')).fontSize === '20px');
    await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows span')].some(span => getComputedStyle(span).color === 'rgb(255, 107, 107)'), null, { timeout: 10000 });
    await page.screenshot({ path: path.join(root, 'native-highlight.png') });
    assert.deepEqual(errors, []);
    app.browser.close(); app.child.kill(); await once(app.child, 'exit').catch(() => undefined);

    // 2회차: 저장된 설정이 복원된다.
    app = await openApp(settings);
    const restarted = app.page;
    const restartedErrors = []; restarted.on('pageerror', error => restartedErrors.push(error.message));
    await restarted.waitForSelector('.home-brand');
    assert.equal(await restarted.evaluate(() => window.terminal.display().then(display => display.fontSize)), 20);
    const stored = await restarted.evaluate(() => window.terminal.highlights());
    assert.equal(stored.length, 1);
    assert.equal(stored[0].pattern, 'ERROR');
    assert.deepEqual(restartedErrors, []);
    await restarted.screenshot({ path: path.join(root, 'native-restored.png') });
    console.log(JSON.stringify({ passed: true, checks: ['네이티브 글꼴 적용', '네이티브 하이라이트 색상', '재실행 복원', '페이지 오류 없음'], screenshots: root }, null, 2));
  } finally {
    if (app) { try { await app.browser.close(); } catch {} try { app.child.kill(); } catch {} }
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
