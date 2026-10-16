import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store';

test('기존 설정의 일반 테마와 테마 저장·재실행·동시 세션 저장을 검증한다', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dalbear-theme-'));
  t.after(async () => { if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('dalbear-theme-')) throw new Error('테스트 경로 범위 오류'); await rm(directory, { recursive: true, force: true }); });
  const profile = { id: randomUUID(), kind: 'local', name: '기존 세션' };
  const file = path.join(directory, 'settings.json');
  await writeFile(file, JSON.stringify({ version: 1, profiles: [profile], knownHosts: { '["tester",22]': 'SHA256:preserve' } }));
  const store = new Store(directory); await store.load(); assert.equal(store.theme(), 'light');
  await Promise.all([store.setTheme('dark'), store.save({ ...profile, name: '변경된 세션' })]);
  const restored = new Store(directory); await restored.load();
  assert.equal(restored.theme(), 'dark'); assert.equal(restored.profiles()[0].name, '변경된 세션'); assert.equal(restored.hostKey('tester', 22), 'SHA256:preserve');
  await assert.rejects(restored.setTheme('invalid' as 'light'));
  assert.equal(restored.theme(), 'dark');
  await Promise.all([restored.setTheme('light'), restored.setTheme('dark'), restored.setTheme('light')]);
  const final = new Store(directory); await final.load(); assert.equal(final.theme(), 'light');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).profiles.length, 1);
});
