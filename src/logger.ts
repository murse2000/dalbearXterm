import { createWriteStream, type WriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { stripVTControlCharacters, TextDecoder } from 'node:util';

export class SessionLog {
  private raw: WriteStream;
  private text: WriteStream;
  private decoder = new TextDecoder('utf-8');
  private lineStart = true;
  private failed = false;
  private pending = 0;
  private ended = false;
  readonly ready: Promise<void>;
  constructor(file: string, private onError: (message: string) => void) {
    this.raw = createWriteStream(file, { flags: 'wx' });
    this.text = createWriteStream(`${file}.txt`, { flags: 'wx' });
    const streams = [this.raw, this.text];
    this.ready = Promise.all(streams.map(stream => new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve());
      stream.once('error', reject);
    }))).then(() => undefined);
    for (const stream of streams) stream.on('error', error => this.fail(`로그 저장 실패: ${error.message}`));
  }
  private fail(message: string): void {
    if (this.failed) return;
    this.failed = true;
    this.raw.destroy(); this.text.destroy();
    this.onError(message);
  }
  write(bytes: Buffer): void {
    if (this.failed || this.ended) return;
    // 느린 디스크가 수신 버퍼를 무한히 늘리지 않도록 명시적으로 중단한다.
    if (this.pending + bytes.length > 8 * 1024 * 1024) { this.fail('로그 디스크가 수신 속도를 따라가지 못해 로그 저장을 중단했습니다.'); return; }
    this.pending += bytes.length;
    this.raw.write(bytes, () => { this.pending -= bytes.length; });
    const decoded = stripVTControlCharacters(this.decoder.decode(bytes, { stream: true }));
    let result = '';
    for (const char of decoded) {
      if (this.lineStart) { result += `[${new Date().toISOString()}] `; this.lineStart = false; }
      result += char;
      if (char === '\n') this.lineStart = true;
    }
    if (this.text.writableLength > 8 * 1024 * 1024) { this.fail('텍스트 로그 버퍼가 가득 차 로그 저장을 중단했습니다.'); return; }
    this.text.write(result);
  }
  async close(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (!this.failed) { this.text.write(this.decoder.decode()); this.raw.end(); this.text.end(); }
    const results = await Promise.allSettled([finished(this.raw), finished(this.text)]);
    if (results.some(result => result.status === 'rejected') && !this.failed) this.fail('로그 파일 마무리에 실패했습니다.');
  }
}
