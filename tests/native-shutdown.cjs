const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const root = path.resolve('release/native-win-x64');
const child = spawn(path.join(root, 'runtime/node.exe'), ['backend.cjs'], { cwd: root, env: { ...process.env, DALBEAR_TEST_DATA: path.resolve('test-results/native-shutdown') }, stdio: ['pipe', 'pipe', 'inherit'] });
let sequence = 0; const pending = new Map();
function invoke(action, body) { return new Promise((resolve, reject) => { const requestId = ++sequence; pending.set(requestId, { resolve, reject }); child.stdin.write(JSON.stringify({ kind: 'invoke', requestId, action, body }) + '\n'); }); }
createInterface({ input: child.stdout }).on('line', line => {
  const message = JSON.parse(line);
  if (message.kind === 'reply') { const request = pending.get(message.requestId); pending.delete(message.requestId); message.ok ? request.resolve(message.value) : request.reject(new Error(message.error)); }
  if (message.event?.type === 'data') child.stdin.write(JSON.stringify({ kind: 'invoke', action: 'ack', body: { id: message.event.id, count: Buffer.from(message.event.base64, 'base64').length } }) + '\n');
});
(async () => {
  const id = randomUUID(); await invoke('connect', { id, profile: { id, name: '종료 검증', kind: 'local' }, credentials: {}, cols: 80, rows: 24 });
  await new Promise(resolve => setTimeout(resolve, 1000));
  const start = performance.now(); await invoke('shutdown'); child.stdin.end();
  const timeout = setTimeout(() => { child.kill(); console.error('통신 프로세스 종료 시간 초과'); process.exitCode = 1; }, 12000);
  child.once('exit', code => { clearTimeout(timeout); console.log(JSON.stringify({ shutdownMs: performance.now() - start, code })); });
})().catch(error => { console.error(error); child.kill(); process.exitCode = 1; });
