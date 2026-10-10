// Screenshot image work with Electron's own nativeImage (PLAN S34): JPEG-encode images
// at their original resolution before they go to a model, and stitch captures that
// span several displays. It replaces sharp, so the package ships no libvips.
// nativeImage decodes PNG and JPEG, which is what the app's screenshots are (PLAN X6).
import type { NativeImage } from 'electron';

// Loaded on use: node unit tests import modules that import this one without Electron.
const nativeImages = (): typeof import('electron').nativeImage => require('electron').nativeImage;

export function decodeImage(bytes: Buffer): NativeImage {
  const image = nativeImages().createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('Unsupported or unreadable image');
  return image;
}

/** Encodes the image as JPEG at its original resolution (PLAN S34: no downscaling). */
export function toJpeg(bytes: Buffer, quality: number): Buffer {
  return decodeImage(bytes).toJPEG(quality);
}

export interface StitchPart {
  bytes: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Resizes every part to its target size and copies its pixels into one canvas of
 * `width` x `height`; uncovered pixels stay transparent. Returns PNG bytes.
 */
export function stitchPng(parts: StitchPart[], width: number, height: number): Buffer {
  const canvas = Buffer.alloc(width * height * 4);
  for (const part of parts) {
    const resized = decodeImage(part.bytes).resize({ width: part.width, height: part.height, quality: 'best' });
    const { width: partWidth, height: partHeight } = resized.getSize();
    const bitmap = resized.toBitmap();
    const x0 = Math.max(0, part.left);
    const x1 = Math.min(width, part.left + partWidth);
    if (x1 <= x0) continue;
    for (let y = Math.max(0, part.top); y < Math.min(height, part.top + partHeight); y++) {
      const row = (y - part.top) * partWidth;
      bitmap.copy(canvas, (y * width + x0) * 4, (row + x0 - part.left) * 4, (row + x1 - part.left) * 4);
    }
  }
  return nativeImages().createFromBitmap(canvas, { width, height }).toPNG();
}
