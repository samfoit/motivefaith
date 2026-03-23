/**
 * Compress an image file client-side using canvas.
 * Resizes to max dimension and converts to WebP.
 */
const COMPRESS_TIMEOUT_MS = 30_000;

export async function compressImage(
  file: File,
  maxSize = 1200,
  quality = 0.8,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const timer = setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image compression timed out"));
    }, COMPRESS_TIMEOUT_MS);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;

      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height / width) * maxSize);
          width = maxSize;
        } else {
          width = Math.round((width / height) * maxSize);
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        clearTimeout(timer);
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Canvas not supported"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          clearTimeout(timer);
          URL.revokeObjectURL(objectUrl);
          if (blob) resolve(blob);
          else reject(new Error("Compression failed"));
        },
        "image/webp",
        quality,
      );
    };
    img.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };
    img.src = objectUrl;
  });
}
