import test from 'node:test';
import assert from 'node:assert/strict';
import { HexHistory } from '../src/hex-history';

test('HEX 보기를 나중에 열어도 분할 수신한 바이트와 순서가 보존된다', () => {
  const history = new HexHistory();
  history.append(new Uint8Array([0, 255])); history.append(new Uint8Array([65, 66, 10]));
  assert.match(history.format(), /^00000000  00 ff 41 42 0a\s+\.\.AB\.\n$/);
  history.clear(); history.append(new Uint8Array([67])); assert.ok(history.format().startsWith('00000005  43'));
});
test('연속 출력의 HEX 이력은 최근 데이터만 제한된 크기로 유지한다', () => {
  const history = new HexHistory(); history.append(new Uint8Array(1024 * 1024)); history.append(new Uint8Array([255, 254]));
  const text = history.format(); assert.ok(text.length <= 48000); assert.ok(text.includes('00 00 ff fe')); assert.ok(text.endsWith(`${'.'.repeat(16)}\n`)); assert.ok(!text.startsWith('00000000'));
});
