import { contextBridge, ipcRenderer } from 'electron';
import type { Api, AppEvent, MenuAction, SavedCommand, Theme } from './model';
async function invoke<T>(action: string, body?: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(action, body);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api: Api = {
  homeAppearance: () => invoke('home-appearance'), setHomeAppearance: appearance => invoke('home-appearance-set', appearance),
  theme: () => invoke('theme'), setTheme: theme => invoke('theme-set', theme),
  onTheme: listener => {
    const handler = (_event: Electron.IpcRendererEvent, theme: Theme) => listener(theme);
    ipcRenderer.on('theme', handler); return () => ipcRenderer.removeListener('theme', handler);
  },
  profiles: () => invoke('profiles'),
  saveProfile: profile => invoke('profile-save', profile),
  deleteProfile: id => invoke('profile-delete', { id }),
  ports: () => invoke('ports'),
  connect: (id, profile, credentials, cols, rows) => invoke('connect', { id, profile, credentials, cols, rows }),
  disconnect: id => invoke('disconnect', { id }),
  write: (id, bytes) => invoke('write', { id, bytes }),
  resize: (id, cols, rows) => invoke('resize', { id, cols, rows }),
  ack: (id, count) => ipcRenderer.send('ack', { id, count }),
  serialSignals: (id, dtr, rts, brk) => invoke('signals', { id, dtr, rts, brk }),
  logStart: id => invoke('log-start', { id }),
  logStop: id => invoke('log-stop', { id }),
  listFiles: (id, path) => invoke('files', { id, path }),
  upload: (id, path) => invoke('upload', { id, path }),
  download: (id, path) => invoke('download', { id, path }),
  cancelTransfer: transferId => invoke('transfer-cancel', { transferId }),
  chooseKey: () => invoke('choose-key'),
  commands: () => invoke<SavedCommand[]>('commands'),
  saveCommand: command => invoke<SavedCommand[]>('command-save', command),
  deleteCommand: id => invoke<SavedCommand[]>('command-delete', { id }),
  runCommand: (commandId, targetId) => invoke('command-run', { id: targetId, commandId }),
  display: () => invoke('display'),
  setDisplay: display => invoke('display-set', display),
  highlights: () => invoke('highlights'),
  saveHighlight: highlight => invoke('highlight-save', highlight),
  deleteHighlight: id => invoke('highlight-delete', { id }),
  onMenu: listener => {
    const handler = (_event: Electron.IpcRendererEvent, action: MenuAction) => listener(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },
  onEvent: listener => {
    const handler = (_event: Electron.IpcRendererEvent, event: AppEvent) => listener(event);
    ipcRenderer.on('event', handler);
    return () => ipcRenderer.removeListener('event', handler);
  }
};
contextBridge.exposeInMainWorld('terminal', api);
