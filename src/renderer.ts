import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { HexHistory } from './hex-history';
import { terminalThemes } from './theme';
import { homeTextColor, readHomeLogo } from './home-appearance';
import { encodeSend, profileSchema, type Api, type AppEvent, type Credentials, type Profile, type ConnectionState, type PortInfo, type Theme, type HomeAppearance } from './model';

declare global { interface Window { terminal: Api } }
const api = window.terminal;
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const value = (id: string) => (element(id) as HTMLInputElement | HTMLSelectElement).value;
const set = (id: string, val: unknown) => { (element(id) as HTMLInputElement | HTMLSelectElement).value = String(val); };
let profiles: Profile[] = [];
let ports: PortInfo[] = [];
let activeId: string | undefined;
let secondaryId: string | undefined;
let filesId: string | undefined;
let homeSelected = true;
let toastTimer: ReturnType<typeof setTimeout>;
interface View {
  id: string; profile: Profile; state: ConnectionState; term: Terminal; fit: FitAddon; search: SearchAddon;
  pane: HTMLElement; message: HTMLElement; hex: HTMLElement; hexMode: boolean; hexHistory: HexHistory; hexFrame?: number;
  log: boolean; logButton: HTMLButtonElement; connectButton: HTMLButtonElement; observer: ResizeObserver;
}
const views = new Map<string, View>();
let theme: Theme = 'light';
let homeAppearance: HomeAppearance = { background: null, logoDataUrl: null };
let homeDraft = { ...homeAppearance };
let homeLogoRequest = 0;
let homeSaving = false;
function applyTheme(next: Theme): void {
  theme = next; document.documentElement.dataset.theme = next; set('theme-select', next);
  for (const view of views.values()) view.term.options.theme = { ...terminalThemes[next] };
  if (element<HTMLDialogElement>('home-appearance-dialog').open) renderHomePreview();
}
async function changeTheme(next: Theme): Promise<void> {
  const select = element<HTMLSelectElement>('theme-select'); select.disabled = true;
  try { applyTheme(await api.setTheme(next)); } finally { select.value = theme; select.disabled = false; }
}
function homeBackground(target: HTMLElement, background: string | null): void {
  const foreground = background ? homeTextColor(background) : '';
  target.style.setProperty('--home-background', background || ''); target.style.setProperty('--home-text', foreground);
  target.style.setProperty('--home-border', foreground ? `${foreground}44` : '');
}
function applyHomeAppearance(appearance: HomeAppearance): void {
  homeAppearance = appearance; homeBackground(element('empty'), appearance.background);
  const logo = element<HTMLImageElement>('home-logo'); logo.src = appearance.logoDataUrl || 'icon.svg'; logo.alt = appearance.logoDataUrl ? '사용자 지정 홈 로고' : '달곰 터미널';
  element<HTMLButtonElement>('customize-home').disabled = false;
}
function renderHomePreview(): void {
  homeBackground(element('home-preview'), homeDraft.background);
  set('home-background', homeDraft.background || getComputedStyle(element('empty')).getPropertyValue('--surface').trim());
  element('home-background-value').textContent = homeDraft.background?.toUpperCase() || '테마 기본색';
  element<HTMLImageElement>('home-logo-preview').src = homeDraft.logoDataUrl || 'icon.svg';
  element('home-logo-status').textContent = homeDraft.logoDataUrl ? '사용자 로고' : '기본 로고';
}
function homeBusy(busy: boolean): void {
  for (const control of element('home-appearance-form').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) {
    control.disabled = busy && (homeSaving || !['home-appearance-close', 'home-appearance-cancel'].includes(control.id));
  }
}
function showHomeAppearance(): void {
  homeDraft = { ...homeAppearance }; homeLogoRequest++; homeBusy(false); input('home-logo-file').value = ''; element('home-appearance-error').textContent = '';
  renderHomePreview(); element<HTMLDialogElement>('home-appearance-dialog').showModal(); element('home-background').focus();
}
function toast(message: string): void { element('toast').textContent = message; element('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { element('toast').hidden = true; }, 7000); }
async function run(action: () => Promise<unknown>): Promise<void> { try { await action(); } catch (error) { toast((error as Error).message); } }
function button(text: string, action: () => unknown, title = text): HTMLButtonElement {
  const result = document.createElement('button'); result.type = 'button'; result.textContent = text; result.title = title; result.addEventListener('click', () => { void run(async () => { await action(); }); }); return result;
}
function description(profile: Profile): string {
  if (profile.kind === 'serial') return `${profile.path} · ${profile.baudRate} · ${profile.dataBits}${profile.parity[0].toUpperCase()}${profile.stopBits}`;
  return profile.kind === 'ssh' ? `${profile.username}@${profile.host}:${profile.port}` : 'PowerShell';
}
function renderProfiles(): void {
  const list = element('profiles'); list.replaceChildren();
  element('profile-count').textContent = String(profiles.length);
  const filtered = profiles.filter(profile => `${profile.name} ${description(profile)}`.toLowerCase().includes(value('profile-filter').toLowerCase()));
  if (!filtered.length) { const text = document.createElement('div'); text.className = 'profile-empty'; text.textContent = profiles.length ? '검색 결과가 없습니다.' : '자주 사용하는 연결을 저장하면\n여기에서 다시 열 수 있습니다.'; list.append(text); }
  for (const profile of filtered) {
    const row = document.createElement('div'); row.className = 'profile';
    const open = button('', () => profile.kind === 'local' ? connect(profile, {}) : showDialog(profile.kind, profile)); open.className = 'profile-open';
    const icon = document.createElement('span'); icon.className = 'kind-icon'; icon.textContent = profile.kind === 'serial' ? '↔' : profile.kind === 'ssh' ? '›_' : '⌘';
    const content = document.createElement('div'); const title = document.createElement('strong'); title.textContent = profile.name; const detail = document.createElement('small'); detail.textContent = description(profile); content.append(title, detail); open.append(icon, content);
    const remove = button('×', async () => { if (confirm(`저장된 세션 "${profile.name}"을 삭제할까요?`)) { profiles = await api.deleteProfile(profile.id); renderProfiles(); } }, '저장된 세션 삭제'); remove.className = 'icon-button';
    row.append(open, remove); list.append(row);
  }
  const home = element('home-sessions'); home.replaceChildren();
  for (const profile of profiles) {
    const open = button(profile.name, () => profile.kind === 'local' ? connect(profile, {}) : showDialog(profile.kind, profile));
    const detail = document.createElement('small'); detail.textContent = description(profile); open.append(detail); home.append(open);
  }
  if (!profiles.length) { const text = document.createElement('div'); text.className = 'profile-empty'; text.textContent = '저장된 세션이 없습니다. 새 연결을 만들고 세션을 저장하세요.'; home.append(text); }
}
async function refreshPorts(): Promise<void> {
  ports = await api.ports();
  const list = element('ports'); list.replaceChildren();
  if (!ports.length) { const text = document.createElement('div'); text.className = 'profile-empty'; text.textContent = '사용 가능한 포트가 없습니다.'; list.append(text); }
  for (const port of ports) {
    const item = document.createElement('div'); item.className = 'port'; item.tabIndex = 0; item.role = 'button';
    const dot = document.createElement('span'); dot.className = 'port-indicator'; const title = document.createElement('div'); title.textContent = port.path;
    const detail = document.createElement('small'); detail.textContent = port.manufacturer || '시리얼 장치'; title.append(detail); item.append(dot, title);
    const open = () => { showDialog('serial'); set('serial-port', port.path); set('session-name', `${port.path} 콘솔`); };
    item.addEventListener('click', open); item.addEventListener('keydown', event => { if (event.key === 'Enter') open(); }); list.append(item);
  }
  populatePorts();
}
function populatePorts(selected = value('serial-port')): void {
  const select = element<HTMLSelectElement>('serial-port'); select.replaceChildren();
  for (const port of ports) select.add(new Option(`${port.path}${port.manufacturer ? ` · ${port.manufacturer}` : ''}`, port.path));
  if (selected && !ports.some(port => port.path === selected)) select.add(new Option(`${selected} (현재 감지되지 않음)`, selected));
  if (!select.options.length) select.add(new Option('포트를 연결하고 새로고침하세요', ''));
  if (selected) select.value = selected;
}
function showDialog(kind: 'serial' | 'ssh', profile?: Profile): void {
  element<HTMLFormElement>('connection-form').reset();
  set('profile-id', profile?.id || crypto.randomUUID()); set('connection-kind', kind); set('session-name', profile?.name || (kind === 'serial' ? '시리얼 콘솔' : 'SSH 서버'));
  element('dialog-title').textContent = kind === 'serial' ? '시리얼 연결' : 'SSH 연결';
  element('serial-fields').hidden = kind !== 'serial'; element('ssh-fields').hidden = kind !== 'ssh';
  element<HTMLSelectElement>('serial-port').required = kind === 'serial'; input('baud-rate').required = kind === 'serial';
  for (const name of ['ssh-host', 'ssh-user']) input(name).required = kind === 'ssh';
  if (kind === 'serial') {
    populatePorts(profile?.kind === 'serial' ? profile.path : ports[0]?.path);
    if (profile?.kind === 'serial') { set('baud-rate', profile.baudRate); set('data-bits', profile.dataBits); set('stop-bits', profile.stopBits); set('parity', profile.parity); set('flow-control', profile.flowControl); set('eol', profile.eol); input('local-echo').checked = profile.localEcho; }
  }
  if (profile?.kind === 'ssh') { set('ssh-host', profile.host); set('ssh-port', profile.port); set('ssh-user', profile.username); set('ssh-auth', profile.auth); set('ssh-key', profile.privateKeyPath); }
  authFields(); element('form-error').textContent = ''; element<HTMLDialogElement>('connection-dialog').showModal(); input('session-name').focus();
}
function authFields(): void { const key = value('ssh-auth') === 'key'; element('key-fields').hidden = !key; element('password-field').hidden = key; input('ssh-key').required = value('connection-kind') === 'ssh' && key; input('ssh-password').required = value('connection-kind') === 'ssh' && !key; }
function readProfile(): Profile {
  const base = { id: value('profile-id'), name: value('session-name').trim() };
  if (value('connection-kind') === 'serial') return profileSchema.parse({ ...base, kind: 'serial', path: value('serial-port'), baudRate: Number(value('baud-rate')), dataBits: Number(value('data-bits')), stopBits: Number(value('stop-bits')), parity: value('parity'), flowControl: value('flow-control'), eol: value('eol'), localEcho: input('local-echo').checked });
  return profileSchema.parse({ ...base, kind: 'ssh', host: value('ssh-host'), port: Number(value('ssh-port')), username: value('ssh-user'), auth: value('ssh-auth'), privateKeyPath: value('ssh-key') });
}
async function submit(connectNow: boolean): Promise<void> {
  try {
    if (!element<HTMLFormElement>('connection-form').reportValidity()) return;
    const profile = readProfile();
    const credentials: Credentials = { password: value('ssh-password') || undefined, passphrase: value('ssh-passphrase') || undefined };
    if (!connectNow || input('save-session').checked) { profiles = await api.saveProfile(profile); renderProfiles(); }
    input('ssh-password').value = ''; input('ssh-passphrase').value = '';
    element<HTMLDialogElement>('connection-dialog').close();
    if (connectNow) await connect(profile, credentials);
  } catch (error) { if (element<HTMLDialogElement>('connection-dialog').open) element('form-error').textContent = (error as Error).message; else toast((error as Error).message); }
}
function fit(view: View): void {
  if (view.pane.hidden || !view.pane.clientWidth) return;
  view.fit.fit();
  if (view.state === 'connected') void run(() => api.resize(view.id, view.term.cols, view.term.rows));
}
async function send(view: View, bytes: Uint8Array): Promise<void> {
  if (view.state !== 'connected') { toast('먼저 세션을 연결하세요.'); return; }
  // 큰 붙여넣기도 IPC 메시지 한도를 넘지 않도록 순서대로 보낸다.
  for (let offset = 0; offset < bytes.length; offset += 32768) await api.write(view.id, bytes.slice(offset, offset + 32768));
}
async function connect(profile: Profile, credentials: Credentials): Promise<void> {
  if (views.size === 0) sidebarExpanded(false);
  const id = crypto.randomUUID();
  const term = new Terminal({ cursorBlink: true, fontFamily: 'Cascadia Mono, Consolas, "Malgun Gothic", monospace', fontSize: 13, lineHeight: 1.15, scrollback: 5000, theme: { ...terminalThemes[theme] } });
  const fitAddon = new FitAddon(); const search = new SearchAddon(); term.loadAddon(fitAddon); term.loadAddon(search);
  const pane = document.createElement('article'); pane.className = 'session-pane'; pane.dataset.sessionId = id;
  const toolbar = document.createElement('div'); toolbar.className = 'session-toolbar';
  const detail = document.createElement('span'); detail.className = 'details'; detail.textContent = description(profile); detail.title = detail.textContent;
  const logButton = button('○ 로그', async () => view.log ? api.logStop(id) : api.logStart(id), '원본 바이트 및 타임스탬프 로그 저장');
  const reconnectButton = button('연결 종료', async () => { if (view.state === 'connected' || view.state === 'connecting') await api.disconnect(id); else { if (profile.kind === 'local') await connect(profile, {}); else showDialog(profile.kind, profile); } });
  const searchBox = document.createElement('input'); searchBox.className = 'search-box'; searchBox.placeholder = '출력 검색'; searchBox.ariaLabel = '터미널 출력 검색'; searchBox.addEventListener('keydown', event => { if (event.key === 'Enter') search.findNext(searchBox.value); });
  const wrap = document.createElement('div'); wrap.className = 'terminal-wrap'; const host = document.createElement('div'); host.className = 'terminal-host'; const hex = document.createElement('pre'); hex.className = 'hex-view'; hex.hidden = true; wrap.append(host, hex);
  const message = document.createElement('div'); message.className = 'session-message'; message.textContent = '연결 준비 중';
  const sendbar = document.createElement('form'); sendbar.className = 'sendbar'; sendbar.hidden = profile.kind !== 'serial';
  const view: View = { id, profile, state: 'connecting', term, fit: fitAddon, search, pane, message, hex, hexMode: false, hexHistory: new HexHistory(), log: false, logButton, connectButton: reconnectButton, observer: new ResizeObserver(() => fit(view)) };
  toolbar.append(detail, searchBox, button('HEX', () => { view.hexMode = !view.hexMode; hex.hidden = !view.hexMode; scheduleHex(view); }), button('지우기', () => { term.clear(); view.hexHistory.clear(); hex.textContent = ''; }), logButton);
  if (profile.kind === 'ssh') toolbar.append(button('SFTP', () => showFiles(view)));
  const sendToggle = button('송신', () => { sendbar.hidden = !sendbar.hidden; sendToggle.setAttribute('aria-pressed', String(!sendbar.hidden)); if (!sendbar.hidden) sendbar.querySelector('input')?.focus(); else term.focus(); });
  sendToggle.title = 'TEXT/HEX 송신줄 표시'; sendToggle.setAttribute('aria-pressed', String(!sendbar.hidden)); toolbar.append(sendToggle, reconnectButton); pane.append(toolbar, wrap);
  if (profile.kind === 'serial') {
    const signals = document.createElement('div'); signals.className = 'signals'; signals.hidden = true; const boxes: HTMLInputElement[] = [];
    const signalToggle = button('신호', () => { signals.hidden = !signals.hidden; signalToggle.setAttribute('aria-pressed', String(!signals.hidden)); });
    signalToggle.title = 'DTR/RTS/BREAK 제어 표시'; signalToggle.setAttribute('aria-pressed', 'false'); toolbar.insertBefore(signalToggle, reconnectButton);
    for (const name of ['DTR', 'RTS', 'BREAK']) { const label = document.createElement('label'); const box = document.createElement('input'); box.type = 'checkbox'; boxes.push(box); label.append(box, document.createTextNode(name)); signals.append(label); }
    signals.append(button('신호 적용', () => api.serialSignals(id, boxes[0].checked, boxes[1].checked, boxes[2].checked)), document.createTextNode('연결 시 신호 상태는 드라이버 기본값입니다.')); pane.append(signals);
  }
  const mode = document.createElement('select'); mode.add(new Option('TEXT', 'text')); mode.add(new Option('HEX', 'hex'));
  const command = document.createElement('input'); command.placeholder = '송신할 내용 · Enter로 전송'; command.ariaLabel = '송신 내용'; command.autocomplete = 'off';
  const eol = document.createElement('select'); for (const [label, name] of [['CR', 'cr'], ['LF', 'lf'], ['CR+LF', 'crlf'], ['없음', 'none']]) eol.add(new Option(label, name)); eol.value = profile.kind === 'serial' ? profile.eol : 'cr';
  const sendButton = document.createElement('button'); sendButton.textContent = '전송 →'; sendButton.type = 'submit'; sendbar.append(mode, command, eol, sendButton);
  let sending = false;
  sendbar.addEventListener('submit', event => { event.preventDefault(); if (sending) return; const bytes = (() => { try { return encodeSend(command.value, mode.value as 'text' | 'hex', eol.value); } catch (error) { toast((error as Error).message); return null; } })(); if (!bytes?.length) return; sending = true; sendButton.disabled = true; void run(async () => { await send(view, bytes); command.value = ''; }).finally(() => { sending = false; sendButton.disabled = false; }); });
  pane.append(sendbar, message); element('workspace').append(pane); views.set(id, view); activeId = id; homeSelected = false; renderWorkspace(); term.open(host); view.observer.observe(wrap); fit(view);
  // 전송 순서를 유지하고 실패한 명령을 재연결 후 재전송하지 않는다.
  let writes: Promise<void> = Promise.resolve();
  term.onData(data => { const bytes = profile.kind === 'serial' && data === '\r' ? encodeSend('', 'text', profile.eol) : new TextEncoder().encode(data); if (!bytes.length) return; writes = writes.then(() => send(view, bytes)).catch(error => toast((error as Error).message)); });
  term.attachCustomKeyEventHandler(event => {
    if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.code === 'KeyC') { void run(() => navigator.clipboard.writeText(term.getSelection())); return false; }
    if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.code === 'KeyV') { void run(async () => { const text = await navigator.clipboard.readText(); if (!/[\r\n]/.test(text) || confirm('여러 줄을 터미널에 붙여넣을까요? 줄 끝 문자는 명령을 실행할 수 있습니다.')) term.paste(text); }); return false; }
    return true;
  });
  term.focus();
  try { await api.connect(id, profile, credentials, term.cols, term.rows); }
  finally { delete credentials.password; delete credentials.passphrase; }
}
async function closeView(id: string): Promise<void> {
  const view = views.get(id); if (!view) return;
  await api.disconnect(id); view.observer.disconnect(); if (view.hexFrame !== undefined) cancelAnimationFrame(view.hexFrame); view.term.dispose(); view.pane.remove(); views.delete(id);
  if (filesId === id) { filesId = undefined; sidebarMode('sessions'); }
  if (activeId === id) activeId = [...views.keys()].at(-1);
  if (secondaryId === id) secondaryId = undefined;
  renderWorkspace();
}
function renderWorkspace(): void {
  const home = homeSelected || views.size === 0;
  element('empty').hidden = !home; element('workspace').hidden = home;
  element('home-tab').classList.toggle('active', home);
  element<HTMLButtonElement>('split').disabled = views.size < 2;
  const current = activeId ? views.get(activeId) : undefined;
  element<HTMLButtonElement>('toolbar-files').disabled = home || current?.profile.kind !== 'ssh' || current?.state !== 'connected';
  element<HTMLButtonElement>('toolbar-log').disabled = home || current?.state !== 'connected';
  if (secondaryId === activeId) secondaryId = undefined;
  document.body.classList.toggle('split', !!secondaryId);
  const tabs = element('tabs'); tabs.replaceChildren();
  for (const view of views.values()) {
    view.pane.hidden = home || (view.id !== activeId && view.id !== secondaryId);
    scheduleHex(view);
    const tab = button('', () => { activeId = view.id; homeSelected = false; renderWorkspace(); view.term.focus(); }); tab.className = `tab${view.id === activeId && !home ? ' active' : ''}`; tab.title = `${view.profile.name} · ${description(view.profile)}`;
    const dot = document.createElement('span'); dot.className = `state-dot ${view.state}`; const name = document.createElement('span'); name.className = 'tab-name'; name.textContent = view.profile.name;
    const close = document.createElement('span'); close.textContent = '×'; close.className = 'close'; close.title = '세션 닫기'; close.addEventListener('click', event => { event.stopPropagation(); void run(() => closeView(view.id)); }); tab.append(dot, name, close); tabs.append(tab);
  }
  element('session-count').textContent = `활성 연결 ${[...views.values()].filter(view => view.state === 'connected').length}`;
  requestAnimationFrame(() => { for (const view of views.values()) fit(view); });
}
function sidebarExpanded(expanded: boolean): void {
  document.body.classList.toggle('sidebar-collapsed', !expanded);
  element('show-sessions').setAttribute('aria-expanded', String(expanded));
}
function toggleSessions(): void {
  const expanded = !document.body.classList.contains('sidebar-collapsed') && !element('sidebar-content').hidden;
  sidebarMode('sessions'); sidebarExpanded(!expanded);
}
function sidebarMode(mode: 'sessions' | 'files'): void {
  sidebarExpanded(true);
  element('sidebar-content').hidden = mode !== 'sessions'; element('files-panel').hidden = mode !== 'files';
  element('rail-sessions').classList.toggle('selected', mode === 'sessions'); element('rail-files').classList.toggle('selected', mode === 'files');
}
async function showFiles(view = activeId ? views.get(activeId) : undefined): Promise<void> {
  if (!view || view.profile.kind !== 'ssh' || view.state !== 'connected') throw new Error('먼저 SSH 세션을 연결하세요.');
  filesId = view.id; sidebarMode('files'); element('files-session').textContent = `${view.profile.username}@${view.profile.host}`; await loadFiles('.');
}
function local(): Promise<void> { return connect({ id: crypto.randomUUID(), name: '로컬 PowerShell', kind: 'local' }, {}); }
function split(): void { if (views.size < 2) return; homeSelected = false; secondaryId = secondaryId ? undefined : [...views.keys()].find(id => id !== activeId); renderWorkspace(); }
let filesRequest = 0;
async function loadFiles(directory: string): Promise<void> {
  if (!filesId) return;
  const id = filesId; const request = ++filesRequest;
  const result = await api.listFiles(id, directory);
  if (filesId !== id || request !== filesRequest) return;
  set('remote-path', result.path); const list = element('file-list'); list.replaceChildren();
  for (const file of result.entries) {
    const remote = `${result.path.replace(/\/$/, '')}/${file.name}`; const row = document.createElement('div'); row.className = `file-row${file.directory ? ' directory' : ''}`;
    const symbol = document.createElement('span'); symbol.textContent = file.directory ? '▱' : '▫'; const name = document.createElement('span'); name.className = 'file-name'; name.textContent = file.name; name.title = file.name;
    const size = document.createElement('span'); size.className = 'file-size'; size.textContent = file.directory ? '' : file.size.toLocaleString(); row.append(symbol, name, size);
    if (file.directory) { row.tabIndex = 0; row.addEventListener('dblclick', () => { void run(() => loadFiles(remote)); }); row.addEventListener('keydown', event => { if (event.key === 'Enter') void run(() => loadFiles(remote)); }); }
    else row.append(button('↓', () => api.download(id, remote), '다운로드'));
    list.append(row);
  }
  if (!result.entries.length) list.textContent = '빈 디렉터리입니다.';
}
function scheduleHex(view: View): void {
  if (!view.hexMode || view.pane.hidden || view.hexFrame !== undefined) return;
  // HEX 화면이 보일 때만 프레임당 한 번 변환하고 그린다.
  view.hexFrame = requestAnimationFrame(() => {
    view.hexFrame = undefined;
    if (!view.hexMode || view.pane.hidden) return;
    view.hex.textContent = view.hexHistory.format();
    view.hex.scrollTop = view.hex.scrollHeight;
  });
}
function onEvent(event: AppEvent): void {
  const view = views.get(event.id);
  if (!view) { if (event.type === 'data') api.ack(event.id, event.bytes.length); return; }
  if (event.type === 'data') {
    const bytes = new Uint8Array(event.bytes); view.term.write(bytes, () => api.ack(event.id, bytes.length));
    view.hexHistory.append(bytes);
    scheduleHex(view);
  } else if (event.type === 'state') {
    view.state = event.state; view.message.textContent = event.message; view.message.hidden = event.state === 'connected'; view.message.classList.toggle('error', event.state === 'error'); view.connectButton.textContent = event.state === 'connected' || event.state === 'connecting' ? '연결 종료' : '다시 연결'; view.logButton.disabled = event.state !== 'connected';
    element('status').textContent = `${view.profile.name} · ${event.message}`; renderWorkspace();
  } else if (event.type === 'log') {
    view.log = event.active; view.logButton.textContent = event.active ? '● 로그 종료' : '○ 로그'; view.logButton.classList.toggle('recording', event.active); view.logButton.title = event.message; view.message.textContent = event.message; view.message.hidden = event.active || event.message === '로그 저장 종료';
    if (!event.active && event.message.includes('실패')) toast(event.message);
  } else {
    let row = document.getElementById(`transfer-${event.transferId}`);
    if (!row) { row = document.createElement('div'); row.id = `transfer-${event.transferId}`; row.className = 'transfer'; element('transfers').prepend(row); }
    row.replaceChildren(); const text = document.createElement('span'); text.textContent = `${event.message} · ${event.bytes.toLocaleString()} / ${event.total.toLocaleString()} bytes`; row.append(text);
    if (event.state === 'running') { row.append(button('취소', () => api.cancelTransfer(event.transferId))); const progress = document.createElement('progress'); progress.max = event.total || 1; progress.value = event.bytes; row.append(progress); }
    else { if (event.state === 'completed' && filesId === event.id) void run(() => loadFiles(value('remote-path'))); if (event.state === 'error') toast(event.message); }
    while (element('transfers').childElementCount > 30) element('transfers').lastElementChild?.remove();
  }
}
api.onEvent(onEvent);
api.onTheme(applyTheme);
element('customize-home').addEventListener('click', showHomeAppearance);
for (const id of ['home-appearance-close', 'home-appearance-cancel']) element(id).addEventListener('click', () => { if (!homeSaving) element<HTMLDialogElement>('home-appearance-dialog').close(); });
element('home-appearance-dialog').addEventListener('cancel', event => { if (homeSaving) event.preventDefault(); });
element('home-appearance-dialog').addEventListener('close', () => { homeLogoRequest++; input('home-logo-file').value = ''; homeBusy(false); });
input('home-background').addEventListener('input', () => { homeDraft.background = value('home-background'); renderHomePreview(); });
element('home-background-default').addEventListener('click', () => { homeDraft.background = null; renderHomePreview(); });
element('home-logo-default').addEventListener('click', () => { homeDraft.logoDataUrl = null; element('home-appearance-error').textContent = ''; renderHomePreview(); });
element('home-logo-choose').addEventListener('click', () => input('home-logo-file').click());
input('home-logo-file').addEventListener('change', () => {
  const file = input('home-logo-file').files?.[0]; if (!file) return;
  const request = ++homeLogoRequest; homeBusy(true); element('home-appearance-error').textContent = '';
  void (async () => {
    try { const logo = await readHomeLogo(file); if (request === homeLogoRequest) { homeDraft.logoDataUrl = logo; renderHomePreview(); } }
    catch (error) { if (request === homeLogoRequest) element('home-appearance-error').textContent = (error as Error).message; }
    finally { if (request === homeLogoRequest) { input('home-logo-file').value = ''; homeBusy(false); } }
  })();
});
element('home-appearance-form').addEventListener('submit', event => {
  event.preventDefault(); if (homeSaving) return; homeSaving = true; homeBusy(true); element('home-appearance-error').textContent = '';
  void (async () => {
    try { applyHomeAppearance(await api.setHomeAppearance(homeDraft)); element<HTMLDialogElement>('home-appearance-dialog').close(); }
    catch (error) { element('home-appearance-error').textContent = (error as Error).message; }
    finally { homeSaving = false; homeBusy(false); }
  })();
});
element('theme-select').addEventListener('change', () => { void run(() => changeTheme(value('theme-select') as Theme)); });
for (const id of ['new-serial', 'empty-serial']) element(id).addEventListener('click', () => showDialog('serial'));
for (const id of ['new-ssh', 'empty-ssh']) element(id).addEventListener('click', () => showDialog('ssh'));
element('new-local').addEventListener('click', () => { void run(local); });
element('empty-local').addEventListener('click', () => { void run(local); });
element('tab-add').addEventListener('click', () => showDialog('serial'));
element('show-sessions').addEventListener('click', toggleSessions);
element('rail-sessions').addEventListener('click', toggleSessions);
element('rail-files').addEventListener('click', () => { void run(() => showFiles()); });
element('rail-ports').addEventListener('click', () => { sidebarMode('sessions'); element('ports').scrollIntoView(); });
element('toolbar-files').addEventListener('click', () => { void run(() => showFiles()); });
element('toolbar-log').addEventListener('click', () => { const view = activeId ? views.get(activeId) : undefined; if (view) view.logButton.click(); });
element('home-tab').addEventListener('click', () => { homeSelected = true; sidebarExpanded(true); renderWorkspace(); });
element('refresh-ports').addEventListener('click', () => { void run(refreshPorts); });
input('profile-filter').addEventListener('input', renderProfiles);
element('dialog-close').addEventListener('click', () => element<HTMLDialogElement>('connection-dialog').close());
element<HTMLDialogElement>('connection-dialog').addEventListener('close', () => { input('ssh-password').value = ''; input('ssh-passphrase').value = ''; });
element('ssh-auth').addEventListener('change', authFields);
element('choose-key').addEventListener('click', () => { void run(async () => { const key = await api.chooseKey(); if (key) set('ssh-key', key); }); });
element('connection-form').addEventListener('submit', event => { event.preventDefault(); void submit(true); });
element('save-only').addEventListener('click', () => { void submit(false); });
element('split').addEventListener('click', split);
element('files-close').addEventListener('click', () => { sidebarMode('sessions'); sidebarExpanded(false); filesId = undefined; });
element('files-form').addEventListener('submit', event => { event.preventDefault(); void run(() => loadFiles(value('remote-path'))); });
element('files-refresh').addEventListener('click', () => { void run(() => loadFiles(value('remote-path'))); });
element('files-up').addEventListener('click', () => { void run(() => loadFiles(`${value('remote-path')}/..`)); });
element('files-upload').addEventListener('click', () => { if (filesId) void run(() => api.upload(filesId!, value('remote-path'))); });
api.onMenu(action => {
  const current = activeId ? views.get(activeId) : undefined;
  const controls = { serial: 'new-serial', ssh: 'new-ssh', local: 'new-local', home: 'home-tab', sessions: 'show-sessions', split: 'split', files: 'toolbar-files', log: 'toolbar-log', refresh: 'refresh-ports' };
  if (action in controls) element(controls[action as keyof typeof controls]).click();
  else if (action === 'disconnect' && current) void run(() => api.disconnect(current.id));
  else if (action === 'clear' && current) current.term.clear();
  else if (action === 'search' && current) current.pane.querySelector<HTMLInputElement>('.search-box')?.focus();
  else if (action === 'theme-light' || action === 'theme-dark') void run(() => changeTheme(action === 'theme-dark' ? 'dark' : 'light'));
});
// 작은 도구 아이콘은 자체 SVG로 만들고 MobaXterm 자산을 포함하지 않는다.
const icons: Record<string, { color: string; body: string }> = {
  serial: { color: '#cf964c', body: '<rect x="6" y="7" width="20" height="15" rx="3"/><path d="M10 7V3m6 4V3m6 4V3M10 22v5m6-5v5m6-5v5"/><path d="M10 12h12M10 17h12" stroke="#fff"/>' },
  ssh: { color: '#65a261', body: '<rect x="3" y="4" width="26" height="20" rx="2"/><path d="M8 10l5 4-5 4m9 0h6" stroke="#fff"/><path d="M11 28h10m-5-4v4"/>' },
  terminal: { color: '#5b91bd', body: '<rect x="2" y="4" width="28" height="20" rx="2"/><path d="M7 11l5 4-5 4m10 0h6" stroke="#fff"/><path d="M10 28h12m-6-4v4"/>' },
  sessions: { color: '#d7ac39', body: '<path d="M16 2l4 9 10 1-8 7 2 10-8-5-8 5 2-10-8-7 10-1z"/>' },
  split: { color: '#4d9fbb', body: '<rect x="2" y="5" width="28" height="20" rx="1"/><path d="M16 5v20M2 11h28" stroke="#fff"/>' },
  files: { color: '#bd9455', body: '<path d="M2 8V5h11l3 4h14v18H2z"/><path d="M3 12h26M16 15v8m-4-4l4 4 4-4" stroke="#fff"/>' },
  log: { color: '#9a7ca9', body: '<path d="M6 2h14l6 6v21H6z"/><path d="M20 2v7h6M10 14h12m-12 5h12m-12 5h8" stroke="#fff"/>' },
  refresh: { color: '#5c9eaf', body: '<path d="M26 11a11 11 0 10 0 12" fill="none" stroke-width="4"/><path d="M22 3l7 10-12-1z"/>' }
};
for (const tool of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  const icon = icons[tool.dataset.icon!]; const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('fill', icon.color); svg.setAttribute('stroke', icon.color); svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true'); svg.innerHTML = icon.body; tool.prepend(svg);
}
void run(async () => { const [currentTheme, appearance] = await Promise.all([api.theme(), api.homeAppearance()]); applyTheme(currentTheme); applyHomeAppearance(appearance); profiles = await api.profiles(); renderProfiles(); await refreshPorts(); renderWorkspace(); });
