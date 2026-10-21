import { z } from 'zod';

const base = { id: z.uuid(), name: z.string().trim().min(1).max(100) };
export const profileSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('serial'), path: z.string().min(1).max(256), baudRate: z.number().int().min(50).max(4000000), dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]), stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]), parity: z.enum(['none', 'even', 'odd', 'mark', 'space']), flowControl: z.enum(['none', 'hardware', 'software']), localEcho: z.boolean(), eol: z.enum(['none', 'cr', 'lf', 'crlf']) }),
  z.object({ ...base, kind: z.literal('ssh'), host: z.string().trim().min(1).max(253), port: z.number().int().min(1).max(65535), username: z.string().min(1).max(128), auth: z.enum(['key', 'password']), privateKeyPath: z.string().max(4096) }),
  z.object({ ...base, kind: z.literal('local') })
]);
export type Profile = z.infer<typeof profileSchema>;
export type SerialProfile = Extract<Profile, { kind: 'serial' }>;
export type SSHProfile = Extract<Profile, { kind: 'ssh' }>;
export const credentialsSchema = z.object({ password: z.string().max(4096).optional(), passphrase: z.string().max(4096).optional() });
export type Credentials = z.infer<typeof credentialsSchema>;
export const sendModeSchema = z.enum(['text', 'hex']);
export const eolSchema = z.enum(['none', 'cr', 'lf', 'crlf']);
export const commandSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100), body: z.string().min(1).max(4096), mode: sendModeSchema, eol: eolSchema });
export type SavedCommand = z.infer<typeof commandSchema>;
export const idSchema = z.uuid();
export const sizeSchema = z.object({ cols: z.number().int().min(2).max(1000), rows: z.number().int().min(1).max(500) });
export const themeSchema = z.enum(['light', 'dark']);
export type Theme = z.infer<typeof themeSchema>;
export const homeAppearanceSchema = z.object({
  background: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
  logoDataUrl: z.string().max(400000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).nullable()
});
export type HomeAppearance = z.infer<typeof homeAppearanceSchema>;
export const DEFAULT_DISPLAY = {
  fontFamily: 'Cascadia Mono, Consolas, "Malgun Gothic", monospace',
  fontSize: 13,
  lineHeight: 1.15,
  cursorStyle: 'block' as const,
  cursorBlink: true,
  scrollback: 5000
};
export const displaySchema = z.object({
  fontFamily: z.string().trim().min(1).max(200),
  fontSize: z.number().int().min(8).max(32),
  lineHeight: z.number().min(1).max(2),
  cursorStyle: z.enum(['block', 'underline', 'bar']),
  cursorBlink: z.boolean(),
  scrollback: z.number().int().min(100).max(200000)
});
export type Display = z.infer<typeof displaySchema>;
export const highlightSchema = z.object({
  id: z.uuid(),
  pattern: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  caseSensitive: z.boolean(),
  regex: z.boolean(),
  enabled: z.boolean()
});
export type Highlight = z.infer<typeof highlightSchema>;
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';
export type AppEvent =
  | { type: 'data'; id: string; bytes: Uint8Array }
  | { type: 'state'; id: string; state: ConnectionState; message: string }
  | { type: 'log'; id: string; active: boolean; message: string }
  | { type: 'transfer'; id: string; transferId: string; bytes: number; total: number; state: 'running' | 'completed' | 'cancelled' | 'error'; message: string };
export interface RemoteEntry { name: string; directory: boolean; size: number; modified: number; }
export interface PortInfo { path: string; manufacturer?: string; serialNumber?: string; }
export type MenuAction = 'serial' | 'ssh' | 'local' | 'home' | 'sessions' | 'split' | 'files' | 'log' | 'refresh' | 'disconnect' | 'clear' | 'search' | 'palette' | 'display' | 'theme-light' | 'theme-dark';
export interface Api {
  homeAppearance(): Promise<HomeAppearance>;
  setHomeAppearance(appearance: HomeAppearance): Promise<HomeAppearance>;
  theme(): Promise<Theme>;
  setTheme(theme: Theme): Promise<Theme>;
  onTheme(listener: (theme: Theme) => void): () => void;
  display(): Promise<Display>;
  setDisplay(display: Display): Promise<Display>;
  highlights(): Promise<Highlight[]>;
  saveHighlight(highlight: Highlight): Promise<Highlight[]>;
  deleteHighlight(id: string): Promise<Highlight[]>;
  profiles(): Promise<Profile[]>;
  saveProfile(profile: Profile): Promise<Profile[]>;
  deleteProfile(id: string): Promise<Profile[]>;
  ports(): Promise<PortInfo[]>;
  connect(id: string, profile: Profile, credentials: Credentials, cols: number, rows: number): Promise<void>;
  disconnect(id: string): Promise<void>;
  write(id: string, bytes: Uint8Array): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  ack(id: string, count: number): void;
  serialSignals(id: string, dtr: boolean, rts: boolean, brk: boolean): Promise<void>;
  logStart(id: string): Promise<string | null>;
  logStop(id: string): Promise<void>;
  listFiles(id: string, path: string): Promise<{ path: string; entries: RemoteEntry[] }>;
  upload(id: string, path: string): Promise<string | null>;
  download(id: string, path: string): Promise<string | null>;
  cancelTransfer(transferId: string): Promise<void>;
  chooseKey(): Promise<string | null>;
  commands(): Promise<SavedCommand[]>;
  saveCommand(command: SavedCommand): Promise<SavedCommand[]>;
  deleteCommand(id: string): Promise<SavedCommand[]>;
  runCommand(commandId: string, targetId: string): Promise<void>;
  onEvent(listener: (event: AppEvent) => void): () => void;
  onMenu(listener: (action: MenuAction) => void): () => void;
}
export function parseHex(value: string): Uint8Array {
  const compact = value.replace(/\s/g, '');
  if (!compact || compact.length % 2 || !/^[0-9a-f]+$/i.test(compact)) throw new Error('HEX는 두 자리 바이트로 입력하세요. 예: 01 0A FF');
  return Uint8Array.from(compact.match(/../g)!, byte => Number.parseInt(byte, 16));
}
export function encodeSend(value: string, mode: 'text' | 'hex', eol: string): Uint8Array {
  if (mode === 'hex') return parseHex(value);
  return new TextEncoder().encode(value + ({ none: '', cr: '\r', lf: '\n', crlf: '\r\n' }[eol] ?? ''));
}
