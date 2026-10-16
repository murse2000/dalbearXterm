const hex = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

export class HexHistory {
  private bytes = new Uint8Array(16 * 1024);
  private length = 0;
  private received = 0;
  append(data: Uint8Array): void {
    this.received += data.length;
    if (data.length >= this.bytes.length) {
      this.bytes.set(data.subarray(data.length - this.bytes.length)); this.length = this.bytes.length;
    } else {
      const overflow = Math.max(0, this.length + data.length - this.bytes.length);
      if (overflow) { this.bytes.copyWithin(0, overflow, this.length); this.length -= overflow; }
      this.bytes.set(data, this.length); this.length += data.length;
    }
  }
  clear(): void { this.length = 0; }
  format(): string {
    const lines: string[] = [];
    const offset = this.received - this.length;
    for (let index = 0; index < this.length; index += 16) {
      let values = ''; let text = '';
      for (let item = index; item < Math.min(index + 16, this.length); item++) {
        const byte = this.bytes[item]; values += `${item === index ? '' : ' '}${hex[byte]}`;
        text += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.';
      }
      lines.push(`${(offset + index).toString(16).padStart(8, '0')}  ${values.padEnd(47)}  ${text}\n`);
    }
    return lines.join('').slice(-48000);
  }
}
