import sharp from 'sharp';

export const MAX_MEDIA_UPLOAD_BYTES = 12 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const responsiveWidths = [480, 960, 1600, 2200];

export interface ProcessedImage {
  width: number;
  height: number;
  variants: Record<string, Buffer>;
}

function matchesFileSignature(bytes: Buffer, contentType: string) {
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/webp') {
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  if (contentType === 'image/avif') {
    const fileTypeBox = bytes.toString('ascii', 4, Math.min(bytes.length, 64)).toLowerCase();
    return fileTypeBox.startsWith('ftyp') && (fileTypeBox.includes('avif') || fileTypeBox.includes('avis'));
  }
  return false;
}

export async function processImageUpload(file: File): Promise<ProcessedImage> {
  if (file.size < 1 || file.size > MAX_MEDIA_UPLOAD_BYTES || !allowedTypes.has(file.type)) {
    throw new Error('Choose a JPEG, PNG, WebP, or AVIF image no larger than 12 MB.');
  }

  const source = Buffer.from(await file.arrayBuffer());
  if (!matchesFileSignature(source, file.type)) throw new Error('The image file contents do not match its declared format.');

  let sourceWidth: number;
  try {
    const metadata = await sharp(source, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) throw new Error('The image has no valid dimensions.');
    sourceWidth = metadata.width;
  } catch {
    throw new Error('The image could not be decoded or exceeds the safe pixel limit.');
  }

  const targetWidths = [...new Set([...responsiveWidths.filter((width) => width < sourceWidth), Math.min(sourceWidth, 2200)])]
    .sort((a, b) => a - b);
  const variants: Record<string, Buffer> = {};
  let outputWidth = 0;
  let outputHeight = 0;

  for (const width of targetWidths) {
    const { data, info } = await sharp(source, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width, height: 2200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    if (data.byteLength > MAX_MEDIA_UPLOAD_BYTES) throw new Error('An optimized image variant exceeds the 12 MB storage limit.');
    variants[String(info.width)] = data;
    if (info.width > outputWidth) {
      outputWidth = info.width;
      outputHeight = info.height;
    }
  }

  if (!outputWidth || !outputHeight) throw new Error('The image could not be converted to WebP.');
  return { width: outputWidth, height: outputHeight, variants };
}
