/**
 * Crop + upscale a screenshot data URL inside the page via canvas.
 * Zero extra deps — avoids pulling in sharp/jimp for the deep-locate path.
 *
 * Injected via `page.evaluate`; must be self-contained (no module scope, no
 * inner named functions).
 */

export interface CropArgs {
  dataUrl: string;
  /** crop rect in image px */
  left: number;
  top: number;
  width: number;
  height: number;
  /** upscale factor (e.g. 2) */
  scale: number;
}

export interface CropResult {
  dataUrl: string;
  width: number;
  height: number;
}

export function cropAndScaleDataUrl(arg: CropArgs): Promise<CropResult> {
  return new Promise<CropResult>((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => {
      const outW = Math.max(1, Math.round(arg.width * arg.scale));
      const outH = Math.max(1, Math.round(arg.height * arg.scale));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no 2d context"));
        return;
      }
      ctx.drawImage(img, arg.left, arg.top, arg.width, arg.height, 0, 0, outW, outH);
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.9), width: outW, height: outH });
    });
    img.addEventListener("error", () => reject(new Error("failed to decode screenshot for crop")));
    img.src = arg.dataUrl;
  });
}
