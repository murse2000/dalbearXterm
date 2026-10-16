import { createInterface } from 'node:readline';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { z } from 'zod';
import { SerialPort } from 'serialport';
import { Store } from './store';
import { Connections } from './connections';
import { Transfers } from './transfers';
import { credentialsSchema, homeAppearanceSchema, idSchema, profileSchema, sizeSchema, themeSchema, type AppEvent } from './model';

const dataDirectory = process.env.DALBEAR_TEST_DATA || path.join(process.env.APPDATA!, 'dalbear-xterm');
const dialogs = new Map<number, (result: unknown) => void>();
let dialogSequence = 0;
let closing = false;
function send(message: unknown): void { process.stdout.write(`${JSON.stringify(message)}\n`); }
function dialog<T>(method: string, options: Record<string, unknown>): Promise<T> {
  return new Promise(resolve => { const dialogId = ++dialogSequence; dialogs.set(dialogId, resolve as (result: unknown) => void); send({ kind: 'dialog', dialogId, method, options }); });
}
async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function main(): Promise<void> {
  const store = new Store(dataDirectory); await store.load();
  send({ kind: 'theme', theme: store.theme() });
  const transfers = new Transfers();
  const connections = new Connections(store, question => dialog<boolean>('confirm', { title: question.previous ? 'SSH 호스트 키 변경' : 'SSH 서버 확인', message: `${question.previous ? '저장된 호스트 키와 다릅니다. 서버 관리자가 확인한 경우에만 승인하세요.' : '처음 연결하는 서버입니다. 지문을 확인하세요.'}\n\n${question.host}:${question.port}\n새 지문: ${question.fingerprint}${question.previous ? `\n기존 지문: ${question.previous}` : ''}` }));
  const output = new Map<string, Buffer[]>();
  let outputTask: NodeJS.Immediate | undefined;
  function flushOutput(): void {
    if (outputTask) clearImmediate(outputTask); outputTask = undefined;
    for (const [id, chunks] of output) {
      const bytes = Buffer.concat(chunks);
      for (let offset = 0; offset < bytes.length; offset += 32768) send({ kind: 'event', event: { type: 'data', id, base64: bytes.subarray(offset, offset + 32768).toString('base64') } });
    }
    output.clear();
  }
  const publish = (event: AppEvent) => {
    if (event.type === 'state' && (event.state === 'disconnected' || event.state === 'error')) transfers.cancelSession(event.id);
    if (event.type === 'data') {
      // 같은 이벤트 루프에서 받은 작은 청크를 합쳐 네이티브 중계 호출 수를 줄인다.
      const chunks = output.get(event.id) || []; chunks.push(Buffer.from(event.bytes)); output.set(event.id, chunks);
      outputTask ??= setImmediate(flushOutput);
    } else { flushOutput(); send({ kind: 'event', event }); }
  };
  connections.on('event', publish); transfers.on('event', publish);
  const idBody = z.object({ id: idSchema }); const remoteBody = idBody.extend({ path: z.string().min(1).max(4096) });
  const actions = new Map<string, (body: unknown) => unknown>();
  function handle<T>(action: string, schema: z.ZodType<T>, handler: (body: T) => unknown): void { actions.set(action, body => handler(schema.parse(body))); }
  handle('profiles', z.undefined(), () => store.profiles());
  handle('theme', z.undefined(), () => store.theme());
  handle('home-appearance', z.undefined(), () => store.homeAppearance());
  handle('home-appearance-set', homeAppearanceSchema, appearance => store.setHomeAppearance(appearance));
  handle('theme-set', themeSchema, async theme => { await store.setTheme(theme); send({ kind: 'theme', theme }); return theme; });
  handle('profile-save', profileSchema, profile => store.save(profile)); handle('profile-delete', idBody, body => store.remove(body.id));
  handle('ports', z.undefined(), () => SerialPort.list());
  handle('connect', idBody.extend({ profile: profileSchema, credentials: credentialsSchema, ...sizeSchema.shape }), body => connections.connect(body.id, body.profile, body.credentials, body.cols, body.rows));
  handle('disconnect', idBody, async body => { await transfers.closeSession(body.id); await connections.disconnect(body.id); });
  handle('write', idBody.extend({ bytes: z.array(z.number().int().min(0).max(255)).min(1).max(65536) }), body => connections.write(body.id, Uint8Array.from(body.bytes)));
  handle('resize', idBody.extend(sizeSchema.shape), body => connections.resize(body.id, body.cols, body.rows));
  handle('ack', idBody.extend({ count: z.number().int().min(1).max(4 * 1024 * 1024) }), body => connections.ack(body.id, body.count));
  handle('signals', idBody.extend({ dtr: z.boolean(), rts: z.boolean(), brk: z.boolean() }), body => connections.signals(body.id, body.dtr, body.rts, body.brk));
  handle('choose-key', z.undefined(), () => dialog<string | null>('open', { title: 'SSH 개인키 선택', directory: path.join(process.env.USERPROFILE!, '.ssh') }));
  handle('log-start', idBody, async body => {
    const file = await dialog<string | null>('save', { title: '원본 수신 로그 저장', name: `${new Date().toISOString().replace(/[:.]/g, '-')}.bin` });
    if (!file) return null;
    if (await exists(file) || await exists(`${file}.txt`)) throw new Error('원본 로그 보존을 위해 새 파일명을 선택하세요.');
    await connections.startLog(body.id, file); return file;
  });
  handle('log-stop', idBody, body => connections.stopLog(body.id));
  handle('files', remoteBody, async body => transfers.list(await connections.sftp(body.id), body.path));
  handle('upload', remoteBody, async body => {
    const local = await dialog<string | null>('open', { title: '업로드 파일 선택' }); if (!local) return null;
    const remote = path.posix.join(body.path, path.basename(local)); const sftp = await connections.sftp(body.id);
    const present = await new Promise<boolean>((resolve, reject) => sftp.stat(remote, error => error ? (error as Error & { code?: number }).code === 2 ? resolve(false) : reject(error) : resolve(true)));
    if (present && !await dialog<boolean>('confirm', { title: '파일 교체 확인', message: `같은 이름의 원격 파일을 교체할까요?\n${remote}` })) return null;
    await transfers.transfer(body.id, sftp, 'upload', local, remote, present); return remote;
  });
  handle('download', remoteBody, async body => {
    const file = await dialog<string | null>('save', { title: '다운로드 위치 선택', name: path.posix.basename(body.path) }); if (!file) return null;
    await transfers.transfer(body.id, await connections.sftp(body.id), 'download', file, body.path, await exists(file)); return file;
  });
  handle('transfer-cancel', z.object({ transferId: idSchema }), body => transfers.cancel(body.transferId));
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  async function shutdown(): Promise<void> { if (closing) return; closing = true; await transfers.closeSession(); await connections.closeAll(); reader.close(); process.stdin.pause(); }
  reader.on('close', () => { void shutdown(); });
  reader.on('line', line => {
    void (async () => {
      let request: { kind?: string; requestId?: number; dialogId?: number; result?: unknown; action?: string; body?: unknown } = {};
      try {
        request = JSON.parse(line);
        if (request.kind === 'dialog-reply') { const resolve = dialogs.get(request.dialogId!); dialogs.delete(request.dialogId!); resolve?.(request.result); return; }
        if (request.action === 'shutdown') { await shutdown(); send({ kind: 'reply', requestId: request.requestId, ok: true }); return; }
        if (closing) throw new Error('앱 종료 중입니다.');
        const action = actions.get(request.action!); if (!action) throw new Error('지원하지 않는 요청입니다.');
        const value = await action(request.body);
        if (request.requestId !== undefined) send({ kind: 'reply', requestId: request.requestId, ok: true, value });
      } catch (error) {
        if (request.requestId !== undefined) send({ kind: 'reply', requestId: request.requestId, ok: false, error: error instanceof z.ZodError ? '입력값을 확인하세요.' : (error as Error).message });
      }
    })();
  });
}
void main().catch(error => { send({ kind: 'fatal', message: (error as Error).message }); process.exitCode = 1; });
