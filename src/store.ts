import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { commandSchema, displaySchema, highlightSchema, homeAppearanceSchema, profileSchema, themeSchema, DEFAULT_DISPLAY, type Display, type Highlight, type HomeAppearance, type Profile, type SavedCommand, type Theme } from './model';

const fileSchema = z.object({ version: z.literal(1), profiles: z.array(profileSchema).max(1000), knownHosts: z.record(z.string(), z.string()), theme: themeSchema.default('light'), home: homeAppearanceSchema.default({ background: null, logoDataUrl: null }), commands: z.array(commandSchema).max(500).default([]), display: displaySchema.default(DEFAULT_DISPLAY), highlights: z.array(highlightSchema).max(100).default([]) });
type Settings = z.infer<typeof fileSchema>;
export class Store {
  private settings: Settings = { version: 1, profiles: [], knownHosts: {}, theme: 'light', home: { background: null, logoDataUrl: null }, commands: [], display: { ...DEFAULT_DISPLAY }, highlights: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}
  async load(): Promise<void> {
    try { this.settings = fileSchema.parse(JSON.parse(await readFile(path.join(this.directory, 'settings.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('설정 파일을 읽지 못했습니다. 원본을 보존한 상태로 파일 형식과 권한을 확인하세요.', { cause: error }); }
  }
  profiles(): Profile[] { return structuredClone(this.settings.profiles); }
  theme(): Theme { return this.settings.theme; }
  homeAppearance(): HomeAppearance { return structuredClone(this.settings.home); }
  async setHomeAppearance(appearance: HomeAppearance): Promise<HomeAppearance> {
    const clean = homeAppearanceSchema.parse(appearance);
    await this.update(next => { next.home = clean; });
    return structuredClone(clean);
  }
  async setTheme(theme: Theme): Promise<Theme> {
    const clean = themeSchema.parse(theme);
    await this.update(next => { next.theme = clean; });
    return clean;
  }
  private update(change: (next: Settings) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.settings);
      change(next);
      await mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, 'settings.json');
      await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
      this.settings = next;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async save(profile: unknown): Promise<Profile[]> {
    // 스키마에 없는 자격 증명은 저장하지 않는다.
    const clean = profileSchema.parse(profile);
    await this.update(next => { next.profiles = [...next.profiles.filter(item => item.id !== clean.id), clean]; });
    return this.profiles();
  }
  async remove(id: string): Promise<Profile[]> {
    await this.update(next => { next.profiles = next.profiles.filter(item => item.id !== id); });
    return this.profiles();
  }
  hostKey(host: string, port: number): string | undefined { return this.settings.knownHosts[JSON.stringify([host.toLowerCase(), port])]; }
  async trust(host: string, port: number, fingerprint: string): Promise<void> {
    await this.update(next => { next.knownHosts[JSON.stringify([host.toLowerCase(), port])] = fingerprint; });
  }
  commands(): SavedCommand[] { return structuredClone(this.settings.commands); }
  async saveCommand(command: unknown): Promise<SavedCommand[]> {
    const clean = commandSchema.parse(command);
    await this.update(next => { next.commands = [...next.commands.filter(item => item.id !== clean.id), clean]; });
    return this.commands();
  }
  async removeCommand(id: string): Promise<SavedCommand[]> {
    await this.update(next => { next.commands = next.commands.filter(item => item.id !== id); });
    return this.commands();
  }
  display(): Display { return structuredClone(this.settings.display); }
  async setDisplay(display: unknown): Promise<Display> {
    const clean = displaySchema.parse(display);
    await this.update(next => { next.display = clean; });
    return structuredClone(clean);
  }
  highlights(): Highlight[] { return structuredClone(this.settings.highlights); }
  async saveHighlight(highlight: unknown): Promise<Highlight[]> {
    const clean = highlightSchema.parse(highlight);
    await this.update(next => { next.highlights = [...next.highlights.filter(item => item.id !== clean.id), clean]; });
    return this.highlights();
  }
  async removeHighlight(id: string): Promise<Highlight[]> {
    await this.update(next => { next.highlights = next.highlights.filter(item => item.id !== id); });
    return this.highlights();
  }
}
