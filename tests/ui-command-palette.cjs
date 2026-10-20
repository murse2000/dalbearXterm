const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createFixture } = require('./fixture.cjs');

// 명령 팔레트와 라이브러리 다이얼로그의 UI 흐름을 검증한다.
// 새 다이얼로그와 단축키, 저장/편집/삭제, Enter 실행, 화살표 선택을 모두 다룬다.
(async () => {
  const root = path.resolve('test-results/ui-command-palette');
  await fs.mkdir(root, { recursive: true });
  const run = await fs.mkdtemp(path.join(root, 'run-'));
  const fixture = await createFixture(run);
  const env = { ...process.env, DALBEAR_TEST_DATA: path.join(run, 'settings') };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ executablePath: process.env.DALBEAR_EXE || require('electron'), args: process.env.DALBEAR_EXE ? [] : ['.'], cwd: path.resolve('.'), env, timeout: 30000 });
  const errors = [];
  try {
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#empty:not([hidden])');
    // 시작 화면의 '명령 팔레트' 버튼이 보이고 클릭으로 연다.
    assert.equal(await page.locator('#empty-palette').count(), 1);
    await page.locator('#empty-palette').click();
    await page.waitForSelector('#command-palette-dialog[open]');
    assert.equal(await page.locator('#command-palette-filter').evaluate(input => input === document.activeElement), true, '필터 입력에 포커스');
    await page.locator('#command-palette-cancel').click();
    await page.waitForFunction(() => !document.getElementById('command-palette-dialog').open);
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await page.evaluate(() => { window.__received = ''; window.terminal.onEvent(event => { if (event.type === 'data') window.__received += new TextDecoder().decode(event.bytes); }); });
    await page.locator('#new-ssh').click();
    await page.locator('#session-name').fill('명령 팔레트 검증');
    await page.locator('#ssh-host').fill('127.0.0.1'); await page.locator('#ssh-port').fill(String(fixture.port)); await page.locator('#ssh-user').fill('tester'); await page.locator('#ssh-auth').selectOption('password'); await page.locator('#ssh-password').fill('test-fixture-password');
    await page.locator('#connect-button').click();
    await page.waitForFunction(() => document.querySelector('.session-message')?.textContent === '연결됨');
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('#command-palette-dialog[open]');
    assert.equal(await page.locator('#command-palette-filter').evaluate(input => input === document.activeElement), true, '첫 번째 입력에 포커스가 있어야 함');
    assert.equal(await page.locator('#command-palette-list .profile-empty').textContent(), '저장된 명령이 없습니다. 라이브러리에서 추가하세요.');
    // 라이브러리에서 새 명령 추가
    await page.locator('#command-palette-manage').click();
    await page.waitForSelector('#command-library-dialog[open]');
    await page.locator('#command-name').fill('검증 명령');
    await page.locator('#command-mode').selectOption('text');
    await page.locator('#command-eol').selectOption('crlf');
    await page.locator('#command-body').fill('DALBEAR_PALETTE_OK');
    await page.locator('#command-library-save').click();
    await page.waitForFunction(() => !document.getElementById('command-library-dialog').open);
    const commands = await page.evaluate(() => window.terminal.commands());
    assert.equal(commands.length, 1);
    assert.equal(commands[0].name, '검증 명령');
    assert.equal(commands[0].body, 'DALBEAR_PALETTE_OK');
    // 팔레트가 라이브러리 변경을 반영하고, 검색 필터가 동작한다.
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('#command-palette-dialog[open]');
    const visibleRows = () => page.locator('#command-palette-list .command-palette-row');
    assert.equal(await visibleRows().count(), 1);
    await page.locator('#command-palette-filter').fill('없는이름');
    assert.equal(await page.locator('#command-palette-list .profile-empty').textContent(), '검색 결과가 없습니다.');
    await page.locator('#command-palette-filter').fill('');
    assert.equal(await visibleRows().count(), 1);
    // 화살표로 이동 + Enter로 실행
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('command-palette-dialog').open);
    await page.waitForFunction(() => window.__received.includes('수신: DALBEAR_PALETTE_OK'));
    // 라이브러리에서 편집과 삭제
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('#command-palette-dialog[open]');
    await page.locator('#command-palette-manage').click();
    await page.waitForSelector('#command-library-dialog[open]');
    await page.getByRole('button', { name: '편집', exact: true }).first().click();
    assert.equal(await page.locator('#command-library-form-title').textContent(), '명령 편집');
    await page.locator('#command-name').fill('수정된 명령');
    await page.locator('#command-library-save').click();
    await page.waitForFunction(() => !document.getElementById('command-library-dialog').open);
    const updated = await page.evaluate(() => window.terminal.commands());
    assert.equal(updated[0].name, '수정된 명령');
    // 편집 모드에서 폼 안의 '삭제' 버튼은 confirm 승인 시 다이얼로그까지 닫는다.
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('#command-palette-dialog[open]');
    await page.locator('#command-palette-manage').click();
    await page.waitForSelector('#command-library-dialog[open]');
    await page.getByRole('button', { name: '편집', exact: true }).first().click();
    await page.evaluate(() => { window.confirm = () => true; });
    await page.locator('#command-library-delete').click();
    await page.waitForFunction(() => !document.getElementById('command-library-dialog').open);
    const empty = await page.evaluate(() => window.terminal.commands());
    assert.equal(empty.length, 0);
    // 연결되지 않은 활성 세션이 없을 때 Enter가 안전하게 거부되는지 확인
    // 1) 명령을 다시 추가해 팔레트에 보이는 상태를 만든다.
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('#command-palette-dialog[open]');
    await page.locator('#command-palette-manage').click();
    await page.waitForSelector('#command-library-dialog[open]');
    await page.locator('#command-name').fill('잠금 명령');
    await page.locator('#command-body').fill('LOCK');
    await page.locator('#command-library-save').click();
    await page.waitForFunction(() => !document.getElementById('command-library-dialog').open);
    // 2) 활성 세션을 닫고 홈으로 돌아가면 Enter가 거부된다.
    await page.locator('.tab .close').first().click();
    await page.waitForSelector('.session-pane', { state: 'detached' });
    await page.locator('#home-tab').click();
    await page.waitForSelector('#empty:not([hidden])');
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('#command-palette-dialog[open]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#toast:not([hidden])');
    assert.ok((await page.locator('#toast').textContent()).includes('먼저 세션을 연결하세요'));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, 'command-palette.png') });
    console.log(JSON.stringify({ passed: true, checks: ['Ctrl+Shift+P 열기', '시작 화면 버튼 열기', '검색 필터', '화살표 + Enter 실행', '라이브러리 저장', '라이브러리 편집', '라이브러리 삭제', '비활성 세션 거부'], screenshots: root }, null, 2));
  } catch (error) {
    const pages = application.windows(); if (pages[0]) { await pages[0].screenshot({ path: path.join(root, 'failure.png') }); console.error(await pages[0].locator('body').innerText()); }
    throw error;
  } finally { await application.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });