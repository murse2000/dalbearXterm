import { EventEmitter } from 'node:events';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { stat, rename, unlink, copyFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { SFTPWrapper } from 'ssh2';
import type { AppEvent, RemoteEntry } from './model';

export class Transfers extends EventEmitter {
  private running = new Map<string, { id: string; controller: AbortController; settled: Promise<void> }>();
  async list(sftp: SFTPWrapper, directory: string): Promise<{ path: string; entries: RemoteEntry[] }> {
    const resolved = await new Promise<string>((resolve, reject) => sftp.realpath(directory, (error, value) => error ? reject(error) : resolve(value)));
    const entries = await new Promise<RemoteEntry[]>((resolve, reject) => sftp.readdir(resolved, (error, files) => error ? reject(error) : resolve(files.map(file => ({ name: file.filename, directory: file.attrs.isDirectory(), size: file.attrs.size, modified: file.attrs.mtime })))));
    entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return { path: resolved, entries };
  }
  cancel(transferId: string): void { this.running.get(transferId)?.controller.abort(); }
  cancelSession(id: string): void { for (const transfer of this.running.values()) if (transfer.id === id) transfer.controller.abort(); }
  async closeSession(id?: string): Promise<void> {
    const entries = [...this.running.values()].filter(entry => id === undefined || entry.id === id);
    for (const entry of entries) entry.controller.abort();
    await Promise.all(entries.map(entry => entry.settled));
  }
  async transfer(id: string, sftp: SFTPWrapper, direction: 'upload' | 'download', local: string, remote: string, overwrite: boolean): Promise<string> {
    const transferId = randomUUID();
    const controller = new AbortController();
    let settle!: () => void;
    const settled = new Promise<void>(resolve => { settle = resolve; });
    this.running.set(transferId, { id, controller, settled });
    let bytes = 0;
    let total = 0;
    let lastReport = 0;
    const temporary = `${direction === 'upload' ? remote : local}.dalbear-${transferId}.part`;
    const publish = (state: 'running' | 'completed' | 'cancelled' | 'error', message: string) => this.emit('event', { type: 'transfer', id, transferId, bytes, total, state, message } satisfies AppEvent);
    try {
      total = direction === 'upload' ? (await stat(local)).size : await new Promise<number>((resolve, reject) => sftp.stat(remote, (error, attrs) => error ? reject(error) : resolve(attrs.size)));
      publish('running', direction === 'upload' ? `업로드: ${remote}` : `다운로드: ${remote}`);
      const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; if (Date.now() - lastReport > 100) { lastReport = Date.now(); publish('running', '전송 중'); } callback(null, chunk); } });
      if (direction === 'upload') {
        await pipeline(createReadStream(local), meter, sftp.createWriteStream(temporary, { flags: 'wx' }), { signal: controller.signal });
        controller.signal.throwIfAborted();
        // OpenSSH 확장으로 기존 파일 교체를 원자적으로 수행한다.
        await new Promise<void>((resolve, reject) => {
          const done = (error?: Error | null) => error ? reject(error) : resolve();
          if (overwrite) sftp.ext_openssh_rename(temporary, remote, done);
          else sftp.rename(temporary, remote, done);
        });
      } else {
        await pipeline(sftp.createReadStream(remote), meter, createWriteStream(temporary, { flags: 'wx' }), { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (overwrite) await rename(temporary, local);
        else { await copyFile(temporary, local, constants.COPYFILE_EXCL); await unlink(temporary); }
      }
      publish('completed', '전송 완료');
    } catch (error) {
      let cleanupError = '';
      try {
        if (direction === 'upload') await new Promise<void>((resolve, reject) => sftp.unlink(temporary, err => err && (err as Error & { code?: number }).code !== 2 ? reject(err) : resolve()));
        else await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } catch { cleanupError = ` 미완료 파일을 직접 확인하세요: ${temporary}`; }
      publish(controller.signal.aborted ? 'cancelled' : 'error', `${controller.signal.aborted ? '전송 취소' : (error as Error).message}${cleanupError}`);
    } finally { this.running.delete(transferId); settle(); }
    return transferId;
  }
}
