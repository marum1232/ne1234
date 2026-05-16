const MAX_DIMENSION = 1280;
const WEBP_QUALITY = 0.82;
const JPEG_QUALITY = 0.82;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size < 200 * 1024) return file;

  return new Promise<File>((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
        resolve(file);
        return;
      }
      const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);

      const supportsWebP = !!canvas.toDataURL("image/webp").startsWith("data:image/webp");

      if (supportsWebP) {
        canvas.toBlob(
          (webpBlob) => {
            if (webpBlob && webpBlob.size < file.size) {
              if (import.meta.env.DEV) {
                console.debug(`[imageUtils] compressed ${file.name}: ${(file.size / 1024).toFixed(1)}KB → ${(webpBlob.size / 1024).toFixed(1)}KB (webp)`);
              }
              resolve(new File([webpBlob], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" }));
            } else {
              canvas.toBlob(
                (jpegBlob) => {
                  if (!jpegBlob || jpegBlob.size >= file.size) { resolve(file); return; }
                  if (import.meta.env.DEV) {
                    console.debug(`[imageUtils] compressed ${file.name}: ${(file.size / 1024).toFixed(1)}KB → ${(jpegBlob.size / 1024).toFixed(1)}KB (jpeg fallback)`);
                  }
                  resolve(new File([jpegBlob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
                },
                "image/jpeg",
                JPEG_QUALITY,
              );
            }
          },
          "image/webp",
          WEBP_QUALITY,
        );
      } else {
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) { resolve(file); return; }
            if (import.meta.env.DEV) {
              console.debug(`[imageUtils] compressed ${file.name}: ${(file.size / 1024).toFixed(1)}KB → ${(blob.size / 1024).toFixed(1)}KB (jpeg)`);
            }
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
          },
          "image/jpeg",
          JPEG_QUALITY,
        );
      }
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}
