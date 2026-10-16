import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { SerialPort } from 'serialport';
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import type { IPty } from 'node-pty';
import type { AppEvent, Credentials, Profile, SerialProfile, SSHProfile } from './model';
import { Store } from './store';
import { SessionLog } from './logger';

interface Entry {
  id: string; profile: Profile; connected: boolean; closed: boolean; pending: number;
  serial?: SerialPort; ssh?: Client; channel?: ClientChannel; pty?: IPty;
  log?: SessionLog; sftp?: Promise<SFTPWrapper>; finish?: (error?: Error) => void;
  ptyInput?: StringDecoder;
}
export interface HostQuestion { host: string; port: number; fingerprint: string; previous?: string; }
export class Connections extends EventEmitter {
  private entries = new Map<string, Entry>();
  constructor(private store: Store, private confirmHost: (question: HostQuestion) => Promise<boolean>, private serialFactory = (config: SerialProfile) => new SerialPort({ path: config.path, baudRate: config.baudRate, dataBits: config.dataBits, stopBits: config.stopBits, parity: config.parity, rtscts: config.flowControl === 'hardware', xon: config.flowControl === 'software', xoff: config.flowControl === 'software', autoOpen: false })) { super(); }
  private publish(event: AppEvent): void { this.emit('event', event); }
  private output(entry: Entry, data: Buffer, received = true): void {
    if (entry.closed) return;
    if (received) entry.log?.write(data);
    entry.pending += data.length;
    if (entry.pending > 4 * 1024 * 1024) { entry.finish?.(new Error('화면 처리 대기열 한도를 초과했습니다. 연결을 중단했습니다. 저장 중인 원본 로그를 확인하세요.')); return; }
    this.publish({ type: 'data', id: entry.id, bytes: data });
    if (entry.pending > 256 * 1024) { entry.serial?.pause(); entry.channel?.pause(); entry.pty?.pause(); }
  }
  ack(id: string, count: number): void {
    const entry = this.entries.get(id);
    if (!entry || entry.closed) return;
    entry.pending = Math.max(0, entry.pending - count);
    if (entry.pending < 64 * 1024) { entry.serial?.resume(); entry.channel?.resume(); entry.pty?.resume(); }
  }
  async connect(id: string, profile: Profile, credentials: Credentials, cols: number, rows: number): Promise<void> {
    if (this.entries.has(id)) throw new Error('이미 사용 중인 연결입니다.');
    const entry: Entry = { id, profile, connected: false, closed: false, pending: 0 };
    this.entries.set(id, entry);
    this.publish({ type: 'state', id, state: 'connecting', message: '연결 중' });
    await new Promise<void>((resolve, reject) => {
      entry.finish = (error?: Error) => {
        if (entry.closed) return;
        entry.closed = true;
        const wasConnected = entry.connected;
        entry.connected = false;
        entry.channel?.destroy(); entry.ssh?.destroy();
        if (entry.serial?.isOpen) entry.serial.close(() => undefined);
        else if (entry.serial) entry.serial.once('open', () => entry.serial?.close(() => undefined));
        entry.pty?.kill();
        void this.stopLogEntry(entry);
        this.entries.delete(id);
        this.publish({ type: 'state', id, state: error ? 'error' : 'disconnected', message: error?.message ?? '연결 종료' });
        if (!wasConnected) reject(error ?? new Error('연결이 취소되었습니다.'));
      };
      const ready = () => {
        if (entry.closed) return;
        entry.connected = true;
        this.publish({ type: 'state', id, state: 'connected', message: '연결됨' });
        resolve();
      };
      const fail = (error: unknown) => entry.finish?.(error instanceof Error ? error : new Error(String(error)));
      try {
        if (profile.kind === 'serial') {
          entry.serial = this.serialFactory(profile);
          entry.serial.on('data', data => this.output(entry, Buffer.from(data)));
          entry.serial.on('error', fail);
          entry.serial.on('close', (error?: Error) => entry.finish?.(error));
          entry.serial.open(error => error ? fail(error) : ready());
        } else if (profile.kind === 'ssh') {
          void this.openSSH(entry, profile, credentials, cols, rows, ready).catch(fail);
        } else {
          const pty = require('node-pty') as typeof import('node-pty');
          const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh');
          entry.pty = pty.spawn(shell, process.platform === 'win32' ? ['-NoLogo'] : [], { cols, rows, name: 'xterm-256color', cwd: process.env.USERPROFILE || process.env.HOME || process.cwd(), env: process.env });
          entry.ptyInput = new StringDecoder('utf8');
          entry.pty.onData(data => this.output(entry, Buffer.from(data, 'utf8')));
          entry.pty.onExit(({ exitCode }) => { entry.pty = undefined; entry.finish?.(exitCode ? new Error(`로컬 셸 종료 코드: ${exitCode}`) : undefined); });
          ready();
        }
      } catch (error) { fail(error); }
    });
  }
  private async openSSH(entry: Entry, profile: SSHProfile, credentials: Credentials, cols: number, rows: number, ready: () => void): Promise<void> {
    const privateKey = profile.auth === 'key' ? await readFile(profile.privateKeyPath) : undefined;
    if (entry.closed) return;
    const client = entry.ssh = new Client();
    client.on('error', error => entry.finish?.(error));
    client.on('close', () => entry.finish?.());
    client.on('ready', () => {
      if (entry.closed) return;
      client.shell({ term: 'xterm-256color', cols, rows }, (error, channel) => {
        if (error) { entry.finish?.(error); return; }
        if (entry.closed) { channel.destroy(); return; }
        entry.channel = channel;
        channel.on('data', (data: Buffer) => this.output(entry, Buffer.from(data)));
        channel.stderr.on('data', data => this.output(entry, Buffer.from(data)));
        channel.on('error', (error: Error) => entry.finish?.(error));
        channel.on('close', () => entry.finish?.());
        ready();
      });
    });
    client.connect({ host: profile.host, port: profile.port, username: profile.username, privateKey, passphrase: credentials.passphrase, password: profile.auth === 'password' ? credentials.password : undefined, readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, accept: (accepted: boolean) => void) => {
        const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
        const previous = this.store.hostKey(profile.host, profile.port);
        if (fingerprint === previous) { accept(true); return; }
        void this.confirmHost({ host: profile.host, port: profile.port, fingerprint, previous }).then(async approved => {
          if (!approved || entry.closed) { accept(false); return; }
          await this.store.trust(profile.host, profile.port, fingerprint);
          accept(!entry.closed);
        }).catch(error => { accept(false); entry.finish?.(error); });
      }
    });
  }
  private get(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry || !entry.connected || entry.closed) throw new Error('연결된 세션이 아닙니다.');
    return entry;
  }
  async write(id: string, bytes: Uint8Array): Promise<void> {
    const entry = this.get(id);
    const data = Buffer.from(bytes);
    if (entry.serial) {
      await new Promise<void>((resolve, reject) => entry.serial!.write(data, error => error ? reject(error) : resolve()));
      if (entry.profile.kind === 'serial' && entry.profile.localEcho) this.output(entry, data, false);
    } else if (entry.channel) {
      await new Promise<void>((resolve, reject) => entry.channel!.write(data, error => error ? reject(error) : resolve()));
    } else entry.pty!.write(entry.ptyInput!.write(data));
  }
  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id);
    if (!entry?.connected || entry.closed) return;
    entry.channel?.setWindow(rows, cols, 0, 0);
    entry.pty?.resize(cols, rows);
  }
  async signals(id: string, dtr: boolean, rts: boolean, brk: boolean): Promise<void> {
    const entry = this.get(id);
    if (!entry.serial) throw new Error('시리얼 세션에서만 사용할 수 있습니다.');
    await new Promise<void>((resolve, reject) => entry.serial!.set({ dtr, rts, brk }, error => error ? reject(error) : resolve()));
  }
  async startLog(id: string, file: string): Promise<void> {
    const entry = this.get(id);
    if (entry.log) throw new Error('이미 로그를 저장 중입니다.');
    const log = new SessionLog(file, message => {
      if (entry.log === log) entry.log = undefined;
      this.publish({ type: 'log', id, active: false, message });
      void log.close();
    });
    entry.log = log;
    try {
      await log.ready;
      if (entry.closed || entry.log !== log) { await log.close(); throw new Error('로그를 시작하기 전에 연결이 종료되었습니다.'); }
      this.publish({ type: 'log', id, active: true, message: file });
    } catch (error) { if (entry.log === log) entry.log = undefined; await log.close(); throw error; }
  }
  private async stopLogEntry(entry: Entry): Promise<void> {
    const log = entry.log;
    if (!log) return;
    entry.log = undefined;
    await log.close();
    this.publish({ type: 'log', id: entry.id, active: false, message: '로그 저장 종료' });
  }
  async stopLog(id: string): Promise<void> { const entry = this.entries.get(id); if (entry) await this.stopLogEntry(entry); }
  async disconnect(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    await this.stopLogEntry(entry);
    if (entry.serial?.isOpen) await new Promise<void>((resolve, reject) => entry.serial!.close(error => error ? reject(error) : resolve()));
    entry.finish?.();
  }
  async closeAll(): Promise<void> { await Promise.all([...this.entries.keys()].map(id => this.disconnect(id))); }
  async sftp(id: string): Promise<SFTPWrapper> {
    const entry = this.get(id);
    if (!entry.ssh) throw new Error('SFTP는 SSH 세션에서만 사용할 수 있습니다.');
    if (!entry.sftp) entry.sftp = new Promise<SFTPWrapper>((resolve, reject) => entry.ssh!.sftp((error, sftp) => error ? reject(error) : resolve(sftp))).catch(error => { entry.sftp = undefined; throw error; });
    return entry.sftp;
  }
}
