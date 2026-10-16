import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store';
import { homeTextColor } from '../src/home-appearance';

test('홈 배경·로고는 기존 설정과 호환되고 재실행·동시 저장·기본값 복원 후 보존된다', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dalbear-home-'));
  t.after(async () => { if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('dalbear-home-')) throw new Error('테스트 경로 범위 오류'); await rm(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'settings.json'); const profile = { id: randomUUID(), kind: 'local', name: '보존할 세션' };
  await writeFile(file, JSON.stringify({ version: 1, profiles: [profile], knownHosts: { '["tester",22]': 'SHA256:preserve' }, theme: 'dark' }));
  const store = new Store(directory); await store.load(); assert.deepEqual(store.homeAppearance(), { background: null, logoDataUrl: null });
  const appearance = { background: '#17304a', logoDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=' };
  await Promise.all([store.setHomeAppearance(appearance), store.save({ ...profile, name: '변경된 세션' }), store.setTheme('light')]);
  const restored = new Store(directory); await restored.load();
  assert.deepEqual(restored.homeAppearance(), appearance); assert.equal(restored.profiles()[0].name, '변경된 세션'); assert.equal(restored.theme(), 'light'); assert.equal(restored.hostKey('tester', 22), 'SHA256:preserve');
  const before = await readFile(file, 'utf8');
  for (const background of ['red', '#fff', 'url(https://example.com)', '#GG0000']) await assert.rejects(restored.setHomeAppearance({ ...appearance, background }));
  for (const logoDataUrl of ['https://example.com/logo.png', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,' + 'A'.repeat(400000)]) await assert.rejects(restored.setHomeAppearance({ ...appearance, logoDataUrl }));
  assert.equal(await readFile(file, 'utf8'), before);
  await restored.setHomeAppearance({ background: null, logoDataUrl: null }); const reset = new Store(directory); await reset.load();
  assert.deepEqual(reset.homeAppearance(), { background: null, logoDataUrl: null }); assert.equal(reset.profiles().length, 1);
});

test('홈 배경색의 자동 글자색은 회색·원색에서 대비 4.5 이상을 유지한다', () => {
  function luminance(hex: string): number {
    const rgb = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff', '#ffff00', '#17304a'];
  for (let value = 0; value < 256; value++) colors.push('#' + value.toString(16).padStart(2, '0').repeat(3));
  for (const background of colors) {
    const values = [luminance(background), luminance(homeTextColor(background))].sort((a, b) => a - b);
    assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5, background);
  }
});
