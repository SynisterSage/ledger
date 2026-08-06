export const AVATAR_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_MAX_SOURCE_DIMENSION = 12_000;
export const AVATAR_TARGET_BYTES = 300 * 1024;
export const AVATAR_MAX_OUTPUT_BYTES = 500 * 1024;
export const AVATAR_START_QUALITY = 0.82;
export const AVATAR_MIN_QUALITY = 0.65;
export const AVATAR_QUALITY_STEP = 0.05;
export const AVATAR_ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const extensionType = (name: string) => {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return null;
};

export type AvatarCrop = { x: number; y: number; width: number; height: number };
export type NormalizedAvatar = {
  blob: Blob;
  width: 512;
  height: 512;
  mimeType: 'image/webp';
  byteSize: number;
};

export const validateAvatarSource = (file: File): string | null => {
  if (file.size > AVATAR_MAX_SOURCE_BYTES) return 'Choose an image smaller than 10 MB.';
  const type = file.type || extensionType(file.name);
  if (!type || !AVATAR_ACCEPTED_MIME_TYPES.includes(type as (typeof AVATAR_ACCEPTED_MIME_TYPES)[number])) {
    return 'Choose a JPG, PNG, or WebP image.';
  }
  return null;
};

const decodeSource = async (source: Blob): Promise<ImageBitmap | HTMLImageElement> => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
      if (bitmap.width > AVATAR_MAX_SOURCE_DIMENSION || bitmap.height > AVATAR_MAX_SOURCE_DIMENSION || bitmap.width * bitmap.height > 100_000_000) {
        bitmap.close();
        throw new Error('This image is too large to process safely.');
      }
      return bitmap;
    } catch (error) {
      // Fall through to the browser decoder for older WebViews.
      if (error instanceof Error && error.message.includes('too large')) throw error;
    }
  }
  const objectUrl = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This image appears to be corrupted.'));
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('This image could not be read.');
    if (image.naturalWidth > AVATAR_MAX_SOURCE_DIMENSION || image.naturalHeight > AVATAR_MAX_SOURCE_DIMENSION || image.naturalWidth * image.naturalHeight > 100_000_000) throw new Error('This image is too large to process safely.');
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const toWebp = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare this image.')), 'image/webp', quality);
});

export const normalizeAvatar = async (source: Blob, crop: AvatarCrop): Promise<NormalizedAvatar> => {
  const image = await decodeSource(source);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Avatar processing is unavailable in this browser.');

  // A neutral opaque base prevents transparent source pixels from varying by theme.
  context.fillStyle = '#F3F4F6';
  context.fillRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  if ('close' in image && typeof image.close === 'function') image.close();

  let best: Blob | null = null;
  for (let quality = AVATAR_START_QUALITY; quality >= AVATAR_MIN_QUALITY - 0.001; quality -= AVATAR_QUALITY_STEP) {
    const blob = await toWebp(canvas, Math.max(AVATAR_MIN_QUALITY, Number(quality.toFixed(2))));
    best = blob;
    if (blob.size < AVATAR_TARGET_BYTES) break;
  }
  if (!best || best.size > AVATAR_MAX_OUTPUT_BYTES) {
    throw new Error('This image could not be compressed below the 500 KB limit. Try a simpler image.');
  }
  return { blob: best, width: AVATAR_OUTPUT_SIZE, height: AVATAR_OUTPUT_SIZE, mimeType: 'image/webp', byteSize: best.size };
};

export const loadAvatarImage = async (file: File): Promise<string> => {
  const validationError = validateAvatarSource(file);
  if (validationError) throw new Error(validationError);
  if ((file.type === 'image/webp' || extensionType(file.name) === 'image/webp')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ascii = new TextDecoder().decode(bytes);
    if (ascii.includes('ANIM') || ascii.includes('ANMF')) throw new Error('Animated avatars are not supported.');
  }
  const image = await decodeSource(file);
  const objectUrl = URL.createObjectURL(file);
  if ('close' in image && typeof image.close === 'function') image.close();
  return objectUrl;
};
