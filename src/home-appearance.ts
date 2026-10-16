import { homeAppearanceSchema } from './model';

export function homeTextColor(background: string): string {
  const [red, green, blue] = background.slice(1).match(/../g)!.map(value => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

export async function readHomeLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG·JPG·WebP 이미지 파일을 선택하세요.');
  if (file.size > 5 * 1024 * 1024) throw new Error('로고 이미지는 5MB 이하로 선택하세요.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('이미지를 읽지 못했습니다. 정상적인 PNG·JPG·WebP 파일을 선택하세요.'); }
  try {
    const scale = Math.min(1, 256 / bitmap.width, 256 / bitmap.height);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d')!; context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // 작은 PNG로 저장해 원본 파일 위치와 무관하게 복원하고 중계 메시지 크기를 제한한다.
    return homeAppearanceSchema.shape.logoDataUrl.parse(canvas.toDataURL('image/png'))!;
  } finally { bitmap.close(); }
}
