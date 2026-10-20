import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { access, mkdir } from 'node:fs/promises';
import { SerialPort } from 'serialport';
import { z } from 'zod';
import { Store } from './store';
import { Connections } from './connections';
import { Transfers } from './transfers';
import { commandSchema, credentialsSchema, homeAppearanceSchema, idSchema, profileSchema, sizeSchema, themeSchema, type AppEvent, type MenuAction, type Theme } from './model';

if (process.env.DALBEAR_TEST_DATA) app.setPath('userData', process.env.DALBEAR_TEST_DATA);
app.setAppUserModelId('com.hrobotics.dalbearxterm');
let window: BrowserWindow;
let connections: Connections;
let quitting = false;
const transfers = new Transfers();
const entryFile = path.join(__dirname, 'index.html');
const idBody = z.object({ id: idSchema });
const remoteBody = idBody.extend({ path: z.string().min(1).max(4096) });

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
app.whenReady().then(async () => {
  const store = new Store(app.getPath('userData'));
  await store.load();
  nativeTheme.themeSource = store.theme();
  window = new BrowserWindow({ width: 1480, height: 920, minWidth: 1024, minHeight: 680, backgroundColor: store.theme() === 'dark' ? '#1c222b' : '#f3f3f3', title: 'dalbearXterm', webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const command = (label: string, action: MenuAction, accelerator?: string) => ({ label, accelerator, click: () => window.webContents.send('menu-action', action) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '터미널', submenu: [command('로컬 터미널 시작', 'local', 'Ctrl+Shift+T'), command('명령 팔레트', 'palette', 'Ctrl+Shift+P'), command('출력 지우기', 'clear'), command('출력 검색', 'search', 'Ctrl+Shift+F'), { type: 'separator' }, { role: 'quit', label: '종료' }] },
    { label: '세션', submenu: [command('새 시리얼 연결', 'serial', 'Ctrl+Shift+N'), command('새 SSH 연결', 'ssh'), command('저장된 세션', 'sessions'), { type: 'separator' }, command('현재 연결 종료', 'disconnect')] },
    { label: '보기', submenu: [command('시작 화면', 'home'), command('화면 분할', 'split'), command('SFTP 파일', 'files'), { label: '테마', submenu: (['light', 'dark'] as Theme[]).map(theme => ({ ...command(theme === 'dark' ? '다크' : '일반', `theme-${theme}`), id: `theme-${theme}`, type: 'radio' as const, checked: store.theme() === theme })) }, { type: 'separator' }, { role: 'togglefullscreen', label: '전체 화면' }] },
    { label: '도구', submenu: [command('포트 새로고침', 'refresh'), command('로그 저장 시작 / 종료', 'log')] },
    { label: '도움말', submenu: [{ label: 'dalbearXterm 정보', click: () => { void dialog.showMessageBox(window, { type: 'info', message: `dalbearXterm ${app.getVersion()}`, detail: '시리얼 · SSH · SFTP 장비 개발 터미널', buttons: ['확인'] }); } }] }
  ]));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  connections = new Connections(store, async question => {
    const result = await dialog.showMessageBox(window, { type: 'warning', title: question.previous ? 'SSH 호스트 키 변경' : 'SSH 서버 확인', message: question.previous ? '저장된 호스트 키와 다릅니다. 서버 관리자가 확인한 경우에만 변경하세요.' : '처음 연결하는 SSH 서버입니다. 지문을 확인하세요.', detail: `${question.host}:${question.port}\n새 지문: ${question.fingerprint}${question.previous ? `\n기존 지문: ${question.previous}` : ''}`, buttons: ['취소', '지문 확인 및 저장'], defaultId: 0, cancelId: 0, noLink: true });
    return result.response === 1;
  });
  const publish = (event: AppEvent) => {
    if (event.type === 'state' && (event.state === 'disconnected' || event.state === 'error')) transfers.cancelSession(event.id);
    if (!window.isDestroyed()) window.webContents.send('event', event);
  };
  connections.on('event', publish); transfers.on('event', publish);
  // 최상위 앱 화면에서 온 요청만 허용하고 작업별 입력을 검사한다.
  function handle<T>(name: string, schema: z.ZodType<T>, action: (body: T) => unknown): void {
    ipcMain.handle(name, async (event, raw: unknown) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(entryFile).href) throw new Error('허용되지 않은 요청입니다.');
      try { return { ok: true, value: await action(schema.parse(raw)) }; }
      catch (error) { return { ok: false, error: error instanceof z.ZodError ? '입력값을 확인하세요.' : (error as Error).message }; }
    });
  }
  handle('profiles', z.undefined(), () => store.profiles());
  handle('theme', z.undefined(), () => store.theme());
  handle('home-appearance', z.undefined(), () => store.homeAppearance());
  handle('home-appearance-set', homeAppearanceSchema, appearance => store.setHomeAppearance(appearance));
  handle('theme-set', themeSchema, async theme => {
    await store.setTheme(theme); nativeTheme.themeSource = theme; window.setBackgroundColor(theme === 'dark' ? '#1c222b' : '#f3f3f3');
    for (const name of ['light', 'dark']) { const item = Menu.getApplicationMenu()?.getMenuItemById(`theme-${name}`); if (item) item.checked = name === theme; }
    window.webContents.send('theme', theme); return theme;
  });
  handle('profile-save', profileSchema, body => store.save(body));
  handle('profile-delete', idBody, body => store.remove(body.id));
  handle('ports', z.undefined(), () => SerialPort.list());
  handle('connect', idBody.extend({ profile: profileSchema, credentials: credentialsSchema, ...sizeSchema.shape }), body => connections.connect(body.id, body.profile, body.credentials, body.cols, body.rows));
  handle('disconnect', idBody, async body => { await transfers.closeSession(body.id); await connections.disconnect(body.id); });
  handle('write', idBody.extend({ bytes: z.instanceof(Uint8Array).refine(bytes => bytes.length > 0 && bytes.length <= 65536) }), body => connections.write(body.id, body.bytes));
  handle('resize', idBody.extend(sizeSchema.shape), body => connections.resize(body.id, body.cols, body.rows));
  handle('signals', idBody.extend({ dtr: z.boolean(), rts: z.boolean(), brk: z.boolean() }), body => connections.signals(body.id, body.dtr, body.rts, body.brk));
  ipcMain.on('ack', (event, raw) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    const body = idBody.extend({ count: z.number().int().min(1).max(4 * 1024 * 1024) }).safeParse(raw);
    if (body.success) connections.ack(body.data.id, body.data.count);
  });
  handle('log-start', idBody, async body => {
    const logs = path.join(app.getPath('documents'), 'dalbearXterm logs');
    await mkdir(logs, { recursive: true });
    const result = await dialog.showSaveDialog(window, { title: '원본 수신 로그 저장', defaultPath: path.join(logs, `${new Date().toISOString().replace(/[:.]/g, '-')}.bin`) });
    if (result.canceled || !result.filePath) return null;
    if (await exists(result.filePath) || await exists(`${result.filePath}.txt`)) throw new Error('원본 로그 보존을 위해 새 파일명을 선택하세요.');
    await connections.startLog(body.id, result.filePath);
    return result.filePath;
  });
  handle('log-stop', idBody, body => connections.stopLog(body.id));
  handle('files', remoteBody, async body => transfers.list(await connections.sftp(body.id), body.path));
  handle('upload', remoteBody, async body => {
    const choice = await dialog.showOpenDialog(window, { title: '업로드 파일 선택', properties: ['openFile'] });
    if (choice.canceled) return null;
    const local = choice.filePaths[0];
    const remote = path.posix.join(body.path, path.basename(local));
    const sftp = await connections.sftp(body.id);
    const present = await new Promise<boolean>((resolve, reject) => sftp.stat(remote, error => error ? (error as Error & { code?: number }).code === 2 ? resolve(false) : reject(error) : resolve(true)));
    if (present) {
      const answer = await dialog.showMessageBox(window, { type: 'warning', message: '같은 이름의 원격 파일을 교체할까요?', detail: remote, buttons: ['취소', '교체'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) return null;
    }
    await transfers.transfer(body.id, sftp, 'upload', local, remote, present);
    return remote;
  });
  handle('download', remoteBody, async body => {
    const choice = await dialog.showSaveDialog(window, { title: '다운로드 위치 선택', defaultPath: path.posix.basename(body.path) });
    if (choice.canceled || !choice.filePath) return null;
    await transfers.transfer(body.id, await connections.sftp(body.id), 'download', choice.filePath, body.path, await exists(choice.filePath));
    return choice.filePath;
  });
  handle('transfer-cancel', z.object({ transferId: idSchema }), body => transfers.cancel(body.transferId));
  handle('choose-key', z.undefined(), async () => {
    const choice = await dialog.showOpenDialog(window, { title: 'SSH 개인키 선택', defaultPath: path.join(app.getPath('home'), '.ssh'), properties: ['openFile'] });
    return choice.canceled ? null : choice.filePaths[0];
  });
  handle('commands', z.undefined(), () => store.commands());
  handle('command-save', commandSchema, body => store.saveCommand(body));
  handle('command-delete', idBody, body => store.removeCommand(body.id));
  handle('command-run', idBody.extend({ commandId: idSchema }), async body => {
    const list = store.commands();
    const command = list.find(item => item.id === body.commandId);
    if (!command) throw new Error('저장된 명령이 없습니다. 명령 팔레트에서 다시 선택하세요.');
    await connections.runCommand(body.id, command);
  });
  window.on('close', event => { if (!quitting) { event.preventDefault(); void appQuit(); } });
  await window.loadFile(entryFile);
}).catch(error => { dialog.showErrorBox('dalbearXterm 시작 실패', (error as Error).message); app.exit(1); });
async function appQuit(): Promise<void> {
  if (quitting) return;
  quitting = true;
  try { await transfers.closeSession(); await connections?.closeAll(); } finally { app.quit(); }
}
app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void appQuit(); } });
app.on('window-all-closed', () => { if (!quitting) void appQuit(); });
