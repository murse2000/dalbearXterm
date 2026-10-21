const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createFixture } = require('./fixture.cjs');

// 탭 드래그 정렬·이름 변경, 출력 검색 옵션, 송신 기록을 실제 화면에서 검증한다.
(async () => {
  const root = path.resolve('test-results/ui-workspace');
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
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await page.locator('#new-ssh').click();
    await page.locator('#session-name').fill('검색·기록 검증');
    await page.locator('#ssh-host').fill('127.0.0.1'); await page.locator('#ssh-port').fill(String(fixture.port)); await page.locator('#ssh-user').fill('tester');
    await page.locator('#ssh-auth').selectOption('password'); await page.locator('#ssh-password').fill('test-fixture-password');
    await page.locator('#connect-button').click();
    await page.waitForFunction(() => document.querySelector('.session-message')?.textContent === '연결됨');
    await page.locator('.session-toolbar').getByRole('button', { name: '송신', exact: true }).click();
    // 기본 줄 끝은 CR 이라 응답이 한 줄을 덮어쓴다. 검색 검증을 위해 LF로 바꿔 줄을 나눈다.
    await page.locator('.sendbar select').nth(1).selectOption('lf');

    // --- 송신 기록: ↑/↓ 로 이전 송신 내용을 오간다.
    const send = async text => {
      const pane = page.locator('.session-pane:not([hidden])');
      await page.waitForFunction(() => !document.querySelector('.session-pane:not([hidden]) .sendbar button[type=submit]').disabled);
      await pane.locator('.sendbar input').fill(text);
      await pane.locator('.sendbar button[type=submit]').click();
      await page.waitForFunction(() => {
        const input = document.querySelector('.session-pane:not([hidden]) .sendbar input');
        const submit = document.querySelector('.session-pane:not([hidden]) .sendbar button[type=submit]');
        return input.value === '' && !submit.disabled;
      });
    };
    await send('FIRST_CMD'); await send('SECOND_CMD'); await send('SECOND_CMD');
    const command = page.locator('.session-pane:not([hidden]) .sendbar input');
    await command.focus();
    await command.press('ArrowUp'); assert.equal(await command.inputValue(), 'SECOND_CMD', '↑ 첫 번째는 마지막 송신');
    await command.press('ArrowUp'); assert.equal(await command.inputValue(), 'FIRST_CMD', '↑ 두 번째는 그 이전 송신');
    await command.press('ArrowDown'); assert.equal(await command.inputValue(), 'SECOND_CMD', '↓ 다음 송신');
    await command.press('ArrowDown'); assert.equal(await command.inputValue(), '', '↓ 마지막은 입력 중이던 내용');
    // 같은 내용을 연속 전송해도 기록은 하나만 남는다.
    assert.equal(await page.evaluate(() => document.querySelectorAll('.session-pane').length), 1);
    // 편집하면 기록 탐색이 초기화된다.
    await command.press('ArrowUp'); assert.equal(await command.inputValue(), 'SECOND_CMD');
    await command.fill('SECOND_CMD_EDIT');
    await command.press('ArrowUp'); assert.equal(await command.inputValue(), 'SECOND_CMD', '편집 후 ↑는 최신 기록부터');
    await command.fill('');

    // --- 출력 검색: 결과 개수, 대소문자 구분, 정규식, 이전/다음 이동
    await page.waitForFunction(() => {
      const text = [...document.querySelectorAll('.xterm-rows')].map(node => node.textContent).join('\n');
      return (text.match(/SECOND_CMD/g) || []).length >= 2;
    });
    const searchBox = page.locator('.session-pane:not([hidden]) .search-box');
    const count = page.locator('.session-pane:not([hidden]) .search-count');
    await searchBox.fill('SECOND_CMD');
    await page.waitForFunction(() => /^\d+\/\d+$/.test(document.querySelector('.session-pane:not([hidden]) .search-count').textContent));
    assert.match(await count.textContent(), /^1\/2$/, '두 번 수신한 줄에서 발견');
    await page.locator('.session-pane:not([hidden]) .search-bar button', { hasText: 'Aa' }).click();
    await searchBox.fill('second_cmd');
    await page.waitForFunction(() => document.querySelector('.session-pane:not([hidden]) .search-count').textContent === '없음');
    await page.locator('.session-pane:not([hidden]) .search-bar button', { hasText: 'Aa' }).click();
    await page.locator('.session-pane:not([hidden]) .search-bar button', { hasText: '.*' }).click();
    await searchBox.fill('SECOND_C(MD|XX)');
    await page.waitForFunction(() => /^[12]\/2$/.test(document.querySelector('.session-pane:not([hidden]) .search-count').textContent));
    // Enter/Shift+Enter 로 현재 결과가 이동하고 되돌아온다.
    const beforeMove = await count.textContent();
    await searchBox.press('Enter');
    await page.waitForFunction(previous => document.querySelector('.session-pane:not([hidden]) .search-count').textContent !== previous, beforeMove);
    const afterMove = await count.textContent();
    assert.notEqual(beforeMove, afterMove, 'Enter 로 다음 결과로 이동');
    await searchBox.press('Shift+Enter');
    await page.waitForFunction(previous => document.querySelector('.session-pane:not([hidden]) .search-count').textContent === previous, beforeMove);
    await searchBox.fill('NOT_PRESENT_ANYWHERE');
    await page.waitForFunction(() => document.querySelector('.session-pane:not([hidden]) .search-count').textContent === '없음');
    await searchBox.press('Escape');
    assert.equal(await count.textContent(), '', 'Escape는 강조와 개수를 지운다');

    // --- 탭 정렬: 두 번째 세션을 열고 드래그로 순서를 바꾼다.
    await page.locator('#new-local').click();
    await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2);
    const labels = () => page.$$eval('.tab .tab-name', nodes => nodes.map(node => node.textContent));
    assert.deepEqual(await labels(), ['검색·기록 검증', '로컬 PowerShell']);
    // 드롭 지점이 대상의 오른쪽 절반이면 그 뒤로 이동한다.
    const targetBox = await page.locator('.tab').nth(1).boundingBox();
    await page.locator('.tab').first().dragTo(page.locator('.tab').nth(1), { targetPosition: { x: targetBox.width - 6, y: 10 } });
    await page.waitForFunction(() => document.querySelectorAll('.tab')[0].textContent.includes('로컬 PowerShell'));
    assert.deepEqual(await labels(), ['로컬 PowerShell', '검색·기록 검증'], '드래그로 순서가 바뀐다');

    // --- 키보드로도 정렬: Alt+← 로 한 칸 이동
    await page.locator('.tab').nth(1).focus();
    await page.locator('.tab').nth(1).press('Alt+ArrowLeft');
    await page.waitForFunction(() => document.querySelectorAll('.tab')[0].textContent.includes('검색·기록 검증'));
    assert.deepEqual(await labels(), ['검색·기록 검증', '로컬 PowerShell'], 'Alt+← 로 제자리 복귀');

    // --- 이름 변경: F2 → 입력 → Enter
    await page.locator('.tab').first().press('F2');
    await page.locator('.tab-rename').fill('장비 A 콘솔');
    await page.locator('.tab-rename').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.tab')[0].textContent.includes('장비 A 콘솔'));
    assert.deepEqual(await labels(), ['장비 A 콘솔', '로컬 PowerShell']);
    // Escape 는 이름을 바꾸지 않는다.
    await page.locator('.tab').first().press('F2');
    await page.locator('.tab-rename').fill('버려질 이름');
    await page.locator('.tab-rename').press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('.tab')[0].textContent.includes('장비 A 콘솔'));
    assert.deepEqual(await labels(), ['장비 A 콘솔', '로컬 PowerShell'], 'Escape 는 이름을 유지한다');
    // 더블클릭으로도 편집기가 열린다.
    await page.locator('.tab').first().dblclick();
    await page.waitForSelector('.tab-rename');
    await page.locator('.tab-rename').press('Escape');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, 'workspace.png') });
    console.log(JSON.stringify({ passed: true, checks: ['송신 기록 ↑/↓', '검색 결과 개수', '대소문자 구분', '정규식 검색', '이전/다음 이동', 'Escape 초기화', '탭 드래그 정렬', 'Alt+← 정렬', 'F2 이름 변경', 'Escape 이름 취소', '더블클릭 이름 변경'], screenshots: root }, null, 2));
  } catch (error) {
    const pages = application.windows(); if (pages[0]) { await pages[0].screenshot({ path: path.join(root, 'failure.png') }); console.error(await pages[0].locator('body').innerText()); }
    throw error;
  } finally { await application.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
