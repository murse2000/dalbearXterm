const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function save(page) {
  await page.locator('#home-appearance-save').click(); await page.waitForSelector('#home-appearance-dialog:not([open])', { state: 'attached' });
}
async function configureHome(page, run, screenshots) {
  const originalBackground = await page.locator('#empty').evaluate(node => getComputedStyle(node).backgroundColor);
  const sidebar = await page.locator('.sidebar').evaluate(node => getComputedStyle(node).backgroundColor);
  await page.locator('#customize-home').click(); await page.locator('#home-background').fill('#17304a');
  assert.equal(await page.locator('#home-preview').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(23, 48, 74)');
  assert.equal(await page.locator('#empty').evaluate(node => getComputedStyle(node).backgroundColor), originalBackground, '저장 전에는 실제 홈 배경을 바꾸면 안 됩니다.');
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256; const context = canvas.getContext('2d');
    context.fillStyle = '#e7b75b'; context.fillRect(0, 0, 512, 256); context.fillStyle = '#17304a'; context.fillRect(80, 60, 352, 136);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const source = path.join(run, 'home-logo-source.png'); await fs.writeFile(source, Buffer.from(data, 'base64'));
  await page.locator('#home-logo-file').setInputFiles(source); await page.waitForFunction(() => document.querySelector('#home-logo-status').textContent === '사용자 로고' && !document.querySelector('#home-appearance-save').disabled);
  await page.screenshot({ path: path.join(screenshots, 'home-customize-preview.png') }); await save(page); await fs.unlink(source);
  await assertRestoredHome(page);
  assert.equal(await page.locator('.sidebar').evaluate(node => getComputedStyle(node).backgroundColor), sidebar);
  assert.ok((await page.locator('.brand-mark').getAttribute('src')).endsWith('icon.svg'));
  await page.screenshot({ path: path.join(screenshots, 'home-customized.png') });
}
async function assertRestoredHome(page) {
  const appearance = await page.evaluate(() => window.terminal.homeAppearance());
  assert.equal(appearance.background, '#17304a'); assert.ok(appearance.logoDataUrl.startsWith('data:image/png;base64,'));
  assert.equal(await page.locator('#home-logo').getAttribute('src'), appearance.logoDataUrl);
  await page.waitForFunction(() => document.querySelector('#home-logo').naturalWidth === 256 && document.querySelector('#home-logo').naturalHeight === 128);
  assert.equal(await page.locator('#empty').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(23, 48, 74)');
  assert.equal(await page.locator('.home-brand').evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)');
}
async function checkEditingAndReset(page) {
  const before = await page.evaluate(() => window.terminal.homeAppearance());
  await page.locator('#customize-home').click(); await page.locator('#home-background').fill('#fff000'); await page.locator('#home-logo-default').click(); await page.locator('#home-appearance-cancel').click();
  assert.deepEqual(await page.evaluate(() => window.terminal.homeAppearance()), before); await assertRestoredHome(page);
  await page.locator('#customize-home').click();
  for (const [name, mimeType, buffer, message] of [
    ['invalid.png', 'image/png', Buffer.from('잘못된 이미지'), '이미지를 읽지 못했습니다'],
    ['invalid.svg', 'image/svg+xml', Buffer.from('<svg/>'), 'PNG·JPG·WebP'],
    ['large.png', 'image/png', Buffer.alloc(5 * 1024 * 1024 + 1), '5MB 이하']
  ]) {
    await page.locator('#home-logo-file').setInputFiles({ name, mimeType, buffer }); await page.waitForFunction(message => document.querySelector('#home-appearance-error').textContent.includes(message) && !document.querySelector('#home-appearance-save').disabled, message);
    assert.deepEqual(await page.evaluate(() => window.terminal.homeAppearance()), before);
  }
  for (const mimeType of ['image/jpeg', 'image/webp']) {
    const data = await page.evaluate(type => { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 32; canvas.getContext('2d').fillRect(0, 0, 64, 32); return canvas.toDataURL(type).split(',')[1]; }, mimeType);
    await page.locator('#home-logo-file').setInputFiles({ name: mimeType === 'image/jpeg' ? 'logo.jpg' : 'logo.webp', mimeType, buffer: Buffer.from(data, 'base64') });
    await page.waitForFunction(() => !document.querySelector('#home-appearance-save').disabled && document.querySelector('#home-appearance-error').textContent === '');
    assert.ok((await page.locator('#home-logo-preview').getAttribute('src')).startsWith('data:image/png;base64,'));
  }
  await page.locator('#home-background-default').click(); await page.locator('#home-logo-default').click(); await save(page);
  assert.deepEqual(await page.evaluate(() => window.terminal.homeAppearance()), { background: null, logoDataUrl: null });
  assert.equal(await page.locator('#home-logo').getAttribute('src'), 'icon.svg');
  assert.equal(await page.locator('#empty').evaluate(node => getComputedStyle(node).backgroundColor), await page.locator('.sidebar').evaluate(node => getComputedStyle(node).backgroundColor));
}
module.exports = { configureHome, assertRestoredHome, checkEditingAndReset };
