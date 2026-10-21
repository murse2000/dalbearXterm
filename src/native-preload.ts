import type { Api, AppEvent, MenuAction, SavedCommand, Theme } from './model';

const bridge = (window as unknown as { chrome: { webview: { postMessage(message: unknown): void; addEventListener(name: string, listener: (event: MessageEvent) => void): void } } }).chrome.webview;
let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const events = new Set<(event: AppEvent) => void>();
const menus = new Set<(action: MenuAction) => void>();
const themes = new Set<(theme: Theme) => void>();
function invoke<T>(action: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => { const requestId = ++sequence; pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject }); bridge.postMessage({ kind: 'invoke', requestId, action, body }); });
}
bridge.addEventListener('message', ({ data }) => {
  if (data.kind === 'reply') {
    const request = pending.get(data.requestId); if (!request) return; pending.delete(data.requestId);
    if (data.ok) request.resolve(data.value); else request.reject(new Error(data.error));
  } else if (data.kind === 'event') {
    const event = data.event;
    if (event.type === 'data') { const raw = atob(event.base64); event.bytes = Uint8Array.from(raw, char => char.charCodeAt(0)); delete event.base64; }
    for (const listener of events) listener(event);
  } else if (data.kind === 'menu') for (const listener of menus) listener(data.action);
  else if (data.kind === 'theme') for (const listener of themes) listener(data.theme);
});
const api: Api = {
  homeAppearance: () => invoke('home-appearance'), setHomeAppearance: appearance => invoke('home-appearance-set', appearance),
  theme: () => invoke('theme'), setTheme: theme => invoke('theme-set', theme),
  onTheme: listener => { themes.add(listener); return () => { themes.delete(listener); }; },
  profiles: () => invoke('profiles'), saveProfile: profile => invoke('profile-save', profile), deleteProfile: id => invoke('profile-delete', { id }), ports: () => invoke('ports'),
  connect: (id, profile, credentials, cols, rows) => invoke('connect', { id, profile, credentials, cols, rows }), disconnect: id => invoke('disconnect', { id }),
  write: (id, bytes) => invoke('write', { id, bytes: Array.from(bytes) }), resize: (id, cols, rows) => invoke('resize', { id, cols, rows }),
  ack: (id, count) => bridge.postMessage({ kind: 'invoke', action: 'ack', body: { id, count } }), serialSignals: (id, dtr, rts, brk) => invoke('signals', { id, dtr, rts, brk }),
  logStart: id => invoke('log-start', { id }), logStop: id => invoke('log-stop', { id }),
  listFiles: (id, path) => invoke('files', { id, path }), upload: (id, path) => invoke('upload', { id, path }), download: (id, path) => invoke('download', { id, path }),
  cancelTransfer: transferId => invoke('transfer-cancel', { transferId }), chooseKey: () => invoke('choose-key'),
  commands: () => invoke<SavedCommand[]>('commands'), saveCommand: command => invoke<SavedCommand[]>('command-save', command), deleteCommand: id => invoke<SavedCommand[]>('command-delete', { id }), runCommand: (commandId, targetId) => invoke('command-run', { id: targetId, commandId }),
  display: () => invoke('display'), setDisplay: display => invoke('display-set', display), highlights: () => invoke('highlights'), saveHighlight: highlight => invoke('highlight-save', highlight), deleteHighlight: id => invoke('highlight-delete', { id }),
  onEvent: listener => { events.add(listener); return () => { events.delete(listener); }; }, onMenu: listener => { menus.add(listener); return () => { menus.delete(listener); }; }
};
Object.defineProperty(window, 'terminal', { value: Object.freeze(api), writable: false });
