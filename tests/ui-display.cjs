const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createFixture } = require('./fixture.cjs');

// 터미널 글꼴·크기 설정과 키워드 하이라이트를 실제 화면에서 검증한다.
(async () => {
  const root = path.resolve('test-results/ui-display');
  await fs.mkdir(root, { recursive: true });
  const run = await fs.mkdtemp(path.join(root, 'run-'));
  const data = path.join(run, 'settings');
  const fixture = await createFixture(run);
  const launch = async () => {
    const env = { ...process.env, DALBEAR_TEST_DATA: data };
    delete env.ELECTRON_RUN_AS_NODE;
    return electron.launch({ executablePath: process.env.DALBEAR_EXE || require('electron'), args: process.env.DALBEAR_EXE ? [] : ['.'], cwd: path.resolve('.'), env, timeout: 30000 });
  };
  const errors = [];
  let application = await launch();
  try {
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#empty:not([hidden])');
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await page.locator('#new-ssh').click();
    await page.locator('#session-name').fill('표시 설정 검증');
    await page.locator('#ssh-host').fill('127.0.0.1'); await page.locator('#ssh-port').fill(String(fixture.port)); await page.locator('#ssh-user').fill('tester');
    await page.locator('#ssh-auth').selectOption('password'); await page.locator('#ssh-password').fill('test-fixture-password');
    await page.locator('#connect-button').click();
    await page.waitForFunction(() => document.querySelector('.session-message')?.textContent === '연결됨');
    await page.locator('.session-toolbar').getByRole('button', { name: '송신', exact: true }).click();
    await page.locator('.sendbar select').nth(1).selectOption('lf');
    await page.locator('.sendbar input').fill('ERROR_CODE_1');
    await page.locator('.sendbar button[type=submit]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some(row => row.textContent.includes('ERROR_CODE_1')));

    // --- 설정 창: 레이아웃이 넘치지 않고 글꼴·크기·줄 간격·커서·스크롤백을 바꾼다.
    await page.locator('#open-display-settings').click();
    await page.waitForSelector('#terminal-settings-dialog[open]');
    const layout = await page.evaluate(() => {
      const dialog = document.getElementById('terminal-settings-dialog');
      return { width: dialog.getBoundingClientRect().width, overflowX: dialog.scrollWidth > dialog.clientWidth };
    });
    assert.equal(layout.overflowX, false, '설정 창 가로 넘침 없음');
    assert.ok(layout.width >= 700, `설정 창 폭 ${layout.width}`);
    await page.locator('#display-font').fill('Consolas, monospace');
    await page.locator('#display-size').fill('20');
    await page.locator('#display-line-height').fill('1.3');
    await page.locator('#display-cursor').selectOption('bar');
    await page.locator('#display-scrollback').fill('12000');
    await page.locator('#highlight-pattern').fill('ERROR');
    await page.locator('#highlight-color').fill('#ff6b6b');
    await page.locator('#highlight-apply').click();
    await page.locator('#highlight-pattern').fill('^수신');
    await page.locator('#highlight-color').fill('#00c853');
    await page.locator('#highlight-regex').check();
    await page.locator('#highlight-apply').click();
    await page.waitForFunction(() => document.querySelectorAll('.highlight-row').length === 2);
    await page.screenshot({ path: path.join(root, 'settings.png') });
    await page.locator('#terminal-settings-save').click();
    await page.waitForFunction(() => !document.getElementById('terminal-settings-dialog').open);

    // 글꼴 크기가 실제 터미널에 적용된다.
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.xterm-rows')).fontSize === '20px');
    const families = await page.evaluate(() => `${getComputedStyle(document.querySelector('.xterm-rows')).fontFamily} ${getComputedStyle(document.querySelector('.xterm')).fontFamily}`);
    assert.ok(families.includes('Consolas'), '지정한 글꼴이 적용된다');

    // --- 하이라이트: 텍스트 하이라이트와 정규식 하이라이트가 각각 적용된다.
    const colorPresent = color => [...document.querySelectorAll('.xterm-rows span')].some(span => getComputedStyle(span).color === color);
    await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows span')].some(span => getComputedStyle(span).color === 'rgb(255, 107, 107)'), null, { timeout: 10000 });
    assert.equal(await page.evaluate(color => [...document.querySelectorAll('.xterm-rows span')].some(span => getComputedStyle(span).color === color), 'rgb(0, 200, 83)'), true, '정규식 하이라이트 적용');
    await page.screenshot({ path: path.join(root, 'highlight.png') });

    // 원본 데이터는 바뀌지 않는다(검색으로 확인).
    await page.locator('.search-box').fill('ERROR_CODE_1');
    await page.waitForFunction(() => /^\d+\/\d+$/.test(document.querySelector('.search-count').textContent));
    await page.locator('.search-box').press('Escape');

    // --- 사용 안 함으로 바꾸면 해당 색이 사라진다.
    await page.locator('#open-display-settings').click();
    await page.waitForSelector('#terminal-settings-dialog[open]');
    await page.locator('.highlight-row').first().locator('input[type=checkbox]').uncheck();
    await page.locator('#terminal-settings-save').click();
    await page.waitForFunction(() => !document.getElementById('terminal-settings-dialog').open);
    await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows span')].every(span => getComputedStyle(span).color !== 'rgb(255, 107, 107)'), null, { timeout: 10000 });
    assert.equal(await page.evaluate(color => [...document.querySelectorAll('.xterm-rows span')].some(span => getComputedStyle(span).color === color), 'rgb(0, 200, 83)'), true, '다른 하이라이트는 유지');
    assert.deepEqual(errors, []);

    // --- 설정은 재실행 후에도 복원된다.
    await application.close();
    application = await launch();
    const restarted = await application.firstWindow();
    await restarted.waitForSelector('#empty:not([hidden])');
    assert.equal(await restarted.evaluate(() => window.terminal.display().then(display => display.fontSize)), 20);
    const stored = await restarted.evaluate(() => window.terminal.highlights());
    assert.equal(stored.length, 2);
    assert.equal(stored.find(item => item.pattern === 'ERROR')?.enabled, false);
    await restarted.locator('#open-display-settings').click();
    await restarted.waitForSelector('#terminal-settings-dialog[open]');
    assert.equal(await restarted.locator('#display-size').inputValue(), '20');
    assert.equal(await restarted.locator('.highlight-row').count(), 2);
    await restarted.screenshot({ path: path.join(root, 'settings-restored.png') });
    console.log(JSON.stringify({ passed: true, checks: ['설정 창 레이아웃', '글꼴·크기 적용', '텍스트 하이라이트', '정규식 하이라이트', '원본 텍스트 보존', '사용 안 함 반영', '재실행 복원'], screenshots: root }, null, 2));
  } catch (error) {
    const pages = application.windows(); if (pages[0]) { await pages[0].screenshot({ path: path.join(root, 'failure.png') }); console.error(await pages[0].locator('body').innerText()); }
    throw error;
  } finally { await application.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
