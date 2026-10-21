const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createFixture } = require('./fixture.cjs');

// 다이얼로그 폭·오버플로·선택 행 대비를 실측해 시각적 회귀를 막는다.
async function layoutMetrics(page) {
  return page.evaluate(() => {
    const parse = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = rgb => {
      const channels = rgb.map(value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (a, b) => { const [x, y] = [luminance(parse(a)), luminance(parse(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const palette = document.getElementById('command-palette-dialog');
    const library = document.getElementById('command-library-dialog');
    const selected = palette.querySelector('.command-palette-row.selected');
    const style = selected ? getComputedStyle(selected) : undefined;
    return {
      paletteWidth: palette.getBoundingClientRect().width,
      paletteOverflowX: palette.scrollWidth > palette.clientWidth,
      paletteOverflowY: palette.scrollHeight > palette.clientHeight,
      headingDecoration: getComputedStyle(palette.querySelector('.eyebrow')).textDecorationLine,
      headingFits: (() => { const heading = palette.querySelector(':scope > .dialog-heading'); return heading.getBoundingClientRect().top >= palette.getBoundingClientRect().top; })(),
      selectedContrast: style ? contrast(style.color, style.backgroundColor) : null,
      libraryWidth: library.getBoundingClientRect().width,
      libraryOverflowX: library.scrollWidth > library.clientWidth,
      libraryHeadingFits: (() => { const box = library.getBoundingClientRect(); const heading = library.querySelector(':scope > .dialog-heading').getBoundingClientRect(); return heading.top >= box.top && heading.right <= box.right + 0.5 && heading.left >= box.left - 0.5; })(),
    };
  });
}

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
    await page.locator('#command-palette-cancel').click();
    await page.waitForFunction(() => !document.getElementById('command-palette-dialog').open);
    // 다이얼로그 폭·오버플로·선택 행 대비를 두 테마에서 실측한다.
    const checks = [];
    for (const theme of ['light', 'dark']) {
      await page.locator('#theme-select').selectOption(theme);
      await page.waitForFunction(name => document.documentElement.dataset.theme === name, theme);
      await page.keyboard.press('Control+Shift+P');
      await page.waitForSelector('#command-palette-dialog[open]');
      await page.waitForSelector('.command-palette-row.selected');
      const palette = await layoutMetrics(page);
      assert.equal(palette.paletteOverflowX, false, `${theme}: 팔레트 가로 넘침 없음`);
      assert.equal(palette.paletteOverflowY, false, `${theme}: 팔레트 세로 넘침 없음`);
      assert.equal(palette.headingDecoration, 'none', `${theme}: 헤더 장식선 없음`);
      assert.equal(palette.headingFits, true, `${theme}: 헤더가 다이얼로그 안에 있음`);
      assert.ok(palette.paletteWidth >= 520, `${theme}: 팔레트 폭 ${palette.paletteWidth}`);
      assert.ok(palette.selectedContrast >= 4.5, `${theme}: 선택 행 대비 ${palette.selectedContrast?.toFixed(2)}`);
      await page.locator('#command-palette-manage').click();
      await page.waitForSelector('#command-library-dialog[open]');
      const library = await layoutMetrics(page);
      assert.equal(library.libraryOverflowX, false, `${theme}: 라이브러리 가로 넘침 없음`);
      assert.equal(library.libraryHeadingFits, true, `${theme}: 라이브러리 헤더가 다이얼로그 안에 있음`);
      assert.ok(library.libraryWidth >= 760, `${theme}: 라이브러리 폭 ${library.libraryWidth}`);
      await page.locator('#command-library-close').click();
      checks.push({ theme, paletteWidth: palette.paletteWidth, selectedContrast: Number(palette.selectedContrast.toFixed(2)), libraryWidth: library.libraryWidth });
    }
    await page.locator('#theme-select').selectOption('light');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, 'command-palette.png') });
    console.log(JSON.stringify({ passed: true, checks: ['Ctrl+Shift+P 열기', '시작 화면 버튼 열기', '검색 필터', '화살표 + Enter 실행', '라이브러리 저장', '라이브러리 편집', '라이브러리 삭제', '비활성 세션 거부', '레이아웃·대비 실측'], layout: checks, screenshots: root }, null, 2));
  } catch (error) {
    const pages = application.windows(); if (pages[0]) { await pages[0].screenshot({ path: path.join(root, 'failure.png') }); console.error(await pages[0].locator('body').innerText()); }
    throw error;
  } finally { await application.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });