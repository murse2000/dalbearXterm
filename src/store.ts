import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { profileSchema, type Profile } from './model';

const fileSchema = z.object({ version: z.literal(1), profiles: z.array(profileSchema).max(1000), knownHosts: z.record(z.string(), z.string()) });
type Settings = z.infer<typeof fileSchema>;
export class Store {
  private settings: Settings = { version: 1, profiles: [], knownHosts: {} };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}
  async load(): Promise<void> {
    try { this.settings = fileSchema.parse(JSON.parse(await readFile(path.join(this.directory, 'settings.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('설정 파일을 읽지 못했습니다. 원본을 보존한 상태로 파일 형식과 권한을 확인하세요.', { cause: error }); }
  }
  profiles(): Profile[] { return structuredClone(this.settings.profiles); }
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
}
