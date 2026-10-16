import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { SerialPort, SerialPortMock } from 'serialport';
import { Connections } from '../src/connections';
import { Store } from '../src/store';
import { Transfers } from '../src/transfers';
import { SessionLog } from '../src/logger';
import { encodeSend, parseHex, type SerialProfile, type SSHProfile, type AppEvent } from '../src/model';
const { createFixture } = require('./fixture.cjs');
async function folder(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dalbear-test-'));
  t.after(async () => { if (path.dirname(dir) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('dalbear-test-')) throw new Error('테스트 임시 경로 범위 오류'); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
async function waitFor(check: () => boolean): Promise<void> { const end = Date.now() + 5000; while (!check()) { if (Date.now() > end) throw new Error('이벤트 대기 시간 초과'); await new Promise(resolve => setTimeout(resolve, 10)); } }

test('송신 바이트: HEX 검증과 CR/LF 처리', () => {
  assert.deepEqual([...parseHex('00 0a FF')], [0, 10, 255]);
  for (const bad of ['', '0', '0Z', '123']) assert.throws(() => parseHex(bad));
  assert.equal(Buffer.from(encodeSend('한글', 'text', 'crlf')).toString(), '한글\r\n');
  assert.deepEqual([...encodeSend('00 ff', 'hex', 'crlf')], [0, 255]);
});
test('세션 저장은 자격 증명을 제거하고 재시작 후 복원한다', async t => {
  const dir = await folder(t); const store = new Store(dir); await store.load();
  const profile = { id: randomUUID(), kind: 'ssh', name: '검증', host: '127.0.0.1', port: 22, username: 'tester', auth: 'password', privateKeyPath: '', password: 'never-store-this', passphrase: 'nor-this' };
  await Promise.all([store.save(profile), store.trust('127.0.0.1', 22, 'SHA256:test')]);
  const saved = await readFile(path.join(dir, 'settings.json'), 'utf8'); assert.ok(!saved.includes('never-store-this')); assert.ok(!saved.includes('nor-this'));
  const restored = new Store(dir); await restored.load(); assert.equal(restored.profiles().length, 1); assert.equal(restored.hostKey('127.0.0.1', 22), 'SHA256:test');
  await writeFile(path.join(dir, 'settings.json'), '{invalid'); await assert.rejects(new Store(dir).load());
  assert.equal(await readFile(path.join(dir, 'settings.json'), 'utf8'), '{invalid');
});
test('로그는 분할 UTF-8와 바이너리 원본을 보존하고 기존 파일을 덮어쓰지 않는다', async t => {
  const dir = await folder(t); const file = path.join(dir, 'received.bin'); const errors: string[] = [];
  const log = new SessionLog(file, message => errors.push(message)); await log.ready;
  const data = Buffer.concat([Buffer.from('한글\r\n'), Buffer.from([0, 255, 1])]); log.write(data.subarray(0, 2)); log.write(data.subarray(2)); await log.close();
  assert.deepEqual(await readFile(file), data); assert.ok((await readFile(`${file}.txt`, 'utf8')).includes('한글')); assert.deepEqual(errors, []);
  const collision = new SessionLog(file, () => undefined); await assert.rejects(collision.ready); await collision.close(); assert.deepEqual(await readFile(file), data);
});
test('시리얼은 줄 끝 없는 수신·송신·분리·로그를 처리한다', async t => {
  const dir = await folder(t); const store = new Store(dir); await store.load();
  const portPath = `COM_TEST_${randomUUID()}`;
  SerialPortMock.binding.createPort(portPath, { echo: false, record: true });
  let mock: SerialPortMock;
  const manager = new Connections(store, async () => false, config => {
    mock = new SerialPortMock({ path: config.path, baudRate: config.baudRate, autoOpen: false }); return mock as unknown as SerialPort;
  });
  t.after(() => manager.closeAll());
  const profile: SerialProfile = { id: randomUUID(), name: '시리얼 검증', kind: 'serial', path: portPath, baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', eol: 'cr', localEcho: true };
  const id = randomUUID(); const received: Buffer[] = []; const states: string[] = [];
  manager.on('event', (event: AppEvent) => { if (event.type === 'data') { received.push(Buffer.from(event.bytes)); manager.ack(id, event.bytes.length); } if (event.type === 'state') states.push(event.state); });
  await manager.connect(id, profile, {}, 80, 24); const logFile = path.join(dir, 'serial.bin'); await manager.startLog(id, logFile);
  const bytes = Buffer.from([0, 255, 0xe9, 0x01]); mock!.port!.emitData(bytes); await waitFor(() => received.length > 0);
  await manager.write(id, new Uint8Array([65, 13])); assert.deepEqual(mock!.port!.recording, Buffer.from([65, 13]));
  await manager.stopLog(id); assert.deepEqual(await readFile(logFile), bytes);
  await manager.disconnect(id); assert.ok(states.includes('connected')); assert.equal(states.at(-1), 'disconnected');
  await assert.rejects(manager.write(id, new Uint8Array([1])));
  const reconnected = randomUUID(); await manager.connect(reconnected, profile, {}, 80, 24);
  mock!.emit('error', new Error('테스트 장비 분리')); assert.equal(states.at(-1), 'error'); await assert.rejects(manager.write(reconnected, new Uint8Array([1])));
});
test('SSH 호스트 키 확인·거부·변경과 실제 SFTP 왕복을 검증한다', { timeout: 20000 }, async t => {
  const dir = await folder(t); const remote = path.join(dir, 'remote'); const { mkdir } = await import('node:fs/promises'); await mkdir(remote);
  const fixture = await createFixture(remote); t.after(() => fixture.close());
  const store = new Store(path.join(dir, 'settings')); await store.load(); let allow = true; const questions: string[] = [];
  const manager = new Connections(store, async question => { questions.push(question.fingerprint); return allow; }); t.after(() => manager.closeAll());
  const profile: SSHProfile = { id: randomUUID(), name: 'SSH 검증', kind: 'ssh', host: '127.0.0.1', port: fixture.port, username: 'tester', auth: 'password', privateKeyPath: '' };
  const output: Buffer[] = []; manager.on('event', (event: AppEvent) => { if (event.type === 'data') { output.push(Buffer.from(event.bytes)); manager.ack(event.id, event.bytes.length); } });
  const id = randomUUID(); await manager.connect(id, profile, { password: 'test-fixture-password' }, 90, 30);
  await manager.write(id, Buffer.from('hello\r')); await waitFor(() => Buffer.concat(output).toString().includes('수신: hello'));
  assert.equal(questions.length, 1); manager.resize(id, 110, 40);
  const transfers = new Transfers(); const events: AppEvent[] = []; transfers.on('event', event => events.push(event));
  const local = path.join(dir, 'source.bin'); const data = Buffer.alloc(256 * 1024); for (let index = 0; index < data.length; index++) data[index] = index % 251; await writeFile(local, data);
  const sftp = await manager.sftp(id);
  await transfers.transfer(id, sftp, 'upload', local, '/file.bin', false);
  assert.deepEqual(await readFile(path.join(remote, 'file.bin')), data);
  const listed = await transfers.list(sftp, '/'); assert.ok(listed.entries.some(entry => entry.name === 'file.bin'));
  const downloaded = path.join(dir, 'download.bin'); await transfers.transfer(id, sftp, 'download', downloaded, '/file.bin', false);
  assert.equal(createHash('sha256').update(await readFile(downloaded)).digest('hex'), createHash('sha256').update(data).digest('hex'));
  assert.ok(!events.some(event => event.type === 'transfer' && event.state === 'error'));
  const collision = path.join(dir, 'existing.bin'); await writeFile(collision, '기존 파일');
  await transfers.transfer(id, sftp, 'download', collision, '/file.bin', false); assert.equal(await readFile(collision, 'utf8'), '기존 파일');
  const cancel = (event: AppEvent) => { if (event.type === 'transfer' && event.state === 'running') transfers.cancel(event.transferId); };
  transfers.on('event', cancel); await transfers.transfer(id, sftp, 'upload', local, '/cancelled.bin', false); transfers.off('event', cancel);
  assert.ok(events.some(event => event.type === 'transfer' && event.state === 'cancelled'));
  assert.ok(!(await readdir(remote)).includes('cancelled.bin'));
  const failed = await transfers.transfer(id, sftp, 'upload', local, '/file.bin', false); assert.ok(events.some(event => event.type === 'transfer' && event.transferId === failed && event.state === 'error'));
  assert.ok(!(await readdir(remote)).some(name => name.endsWith('.part')));
  await manager.disconnect(id);
  const next = randomUUID(); await manager.connect(next, profile, { password: 'test-fixture-password' }, 80, 24); assert.equal(questions.length, 1); await manager.disconnect(next);
  await store.trust(profile.host, profile.port, 'SHA256:changed'); allow = false;
  await assert.rejects(manager.connect(randomUUID(), profile, { password: 'test-fixture-password' }, 80, 24)); assert.equal(questions.length, 2);
});
