const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

// 명령 팔레트·라이브러리 다이얼로그의 실제 렌더링을 캡처해 육안 검증한다.
(async () => {
  const root = path.resolve('test-results/visual');
  await fs.mkdir(root, { recursive: true });
  const run = await fs.mkdtemp(path.join(root, 'run-'));
  const env = { ...process.env, DALBEAR_TEST_DATA: path.join(run, 'settings') };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: path.resolve('.'), env, timeout: 30000 });
  try {
    const page = await application.firstWindow();
    await page.waitForSelector('#empty:not([hidden])');
    // 일반 테마 홈 화면 (진입점 확인)
    await page.screenshot({ path: path.join(root, '01-home-light.png') });
    // 명령 2개를 미리 저장
    await page.evaluate(async () => {
      await window.terminal.saveCommand({ id: crypto.randomUUID(), name: '부트 중단', body: 'AA 1B', mode: 'hex', eol: 'none' });
      await window.terminal.saveCommand({ id: crypto.randomUUID(), name: '재부팅', body: 'reboot', mode: 'text', eol: 'lf' });
    });
    await page.locator('#empty-palette').click();
    await page.waitForSelector('#command-palette-dialog[open]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(root, '02-palette-light.png') });
    const paletteBox = await page.locator('#command-palette-dialog').boundingBox();
    const paletteMetrics = await page.evaluate(() => {
      const dialog = document.getElementById('command-palette-dialog');
      const scroll = dialog.scrollWidth > dialog.clientWidth;
      const note = dialog.querySelector('.form-note');
      const heading = dialog.querySelector('.dialog-heading');
      return {
        dialogWidth: dialog.getBoundingClientRect().width,
        horizontalOverflow: scroll,
        noteDecoration: getComputedStyle(note).textDecorationLine,
        eyebrowDecoration: getComputedStyle(dialog.querySelector('.eyebrow')).textDecorationLine,
        headingMargin: getComputedStyle(heading).margin,
      };
    });
    await page.locator('#command-palette-manage').click();
    await page.waitForSelector('#command-library-dialog[open]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(root, '03-library-light.png') });
    const libraryMetrics = await page.evaluate(() => {
      const dialog = document.getElementById('command-library-dialog');
      const heading = dialog.querySelector(':scope > .dialog-heading');
      return {
        dialogWidth: dialog.getBoundingClientRect().width,
        horizontalOverflow: dialog.scrollWidth > dialog.clientWidth,
        scrollHeightClipped: dialog.scrollHeight > dialog.clientHeight,
        headingMargin: getComputedStyle(heading).margin,
        headingTop: heading.getBoundingClientRect().top,
        dialogTop: dialog.getBoundingClientRect().top,
      };
    });
    await page.locator('#command-library-close').click();
    // 다크 테마에서도 확인
    await page.locator('#theme-select').selectOption('dark');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.locator('#empty-palette').click();
    await page.waitForSelector('#command-palette-dialog[open]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(root, '04-palette-dark.png') });
    await page.locator('#command-palette-manage').click();
    await page.waitForSelector('#command-library-dialog[open]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(root, '05-library-dark.png') });
    console.log(JSON.stringify({ root, paletteBox, paletteMetrics, libraryMetrics }, null, 2));
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
