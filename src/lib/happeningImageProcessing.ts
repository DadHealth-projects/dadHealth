export const HAPPENING_IMAGE_ASPECT = 8 / 5;
export const HAPPENING_IMAGE_MAX_WIDTH = 1600;
export const HAPPENING_IMAGE_TARGET_BYTES = 1024 * 1024;

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const STANDARD_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);
const STANDARD_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export type HappeningImageKind = "standard" | "heic" | "unsupported";

export class HappeningImageError extends Error {
  readonly code: "unsupported" | "heic-read" | "processing" | "too-large";

  constructor(code: "unsupported" | "heic-read" | "processing" | "too-large") {
    const messages = {
      unsupported: "Unsupported image type. Use JPEG, PNG, WebP, HEIC or HEIF.",
      "heic-read": "We couldn't read this HEIC photo. Try exporting it as JPEG.",
      processing: "Image processing failed. Please try another photo.",
      "too-large": "Processed image is still too large.",
    } as const;
    super(messages[code]);
    this.code = code;
    this.name = "HappeningImageError";
  }
}

export function classifyHappeningImageInput(file: Pick<File, "name" | "type">): HappeningImageKind {
  const type = file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (HEIC_TYPES.has(type) || HEIC_EXTENSIONS.has(extension)) return "heic";
  if (STANDARD_TYPES.has(type) || STANDARD_EXTENSIONS.has(extension)) return "standard";
  return "unsupported";
}

export function getHappeningOutputDimensions(cropWidth: number) {
  const width = Math.max(1, Math.min(HAPPENING_IMAGE_MAX_WIDTH, Math.round(cropWidth)));
  return { width, height: Math.max(1, Math.round(width / HAPPENING_IMAGE_ASPECT)) };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function canDecode(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    return image.naturalWidth > 0 && image.naturalHeight > 0;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareHappeningImageSource(file: File) {
  const kind = classifyHappeningImageInput(file);
  if (kind === "unsupported") throw new HappeningImageError("unsupported");
  if (!file.size) throw new HappeningImageError("processing");

  let blob: Blob = file;
  if (kind === "heic") {
    try {
      const { heicTo, isHeic } = await import("heic-to/csp");
      if (!(await isHeic(file))) throw new HappeningImageError("heic-read");
      blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
    } catch (error) {
      if (error instanceof HappeningImageError) throw error;
      throw new HappeningImageError("heic-read");
    }
  }

  if (!(await canDecode(blob))) {
    throw new HappeningImageError(kind === "heic" ? "heic-read" : "processing");
  }

  return { url: URL.createObjectURL(blob), name: file.name };
}

function canvasBlob(canvas: HTMLCanvasElement, type: "image/webp" | "image/jpeg", quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encodeCanvas(canvas: HTMLCanvasElement, quality: number) {
  const webp = await canvasBlob(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return webp;
  return canvasBlob(canvas, "image/jpeg", quality);
}

export interface HappeningCropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function createCroppedHappeningImage(
  sourceUrl: string,
  crop: HappeningCropArea,
  sourceName: string,
) {
  try {
    const image = await loadImage(sourceUrl);
    let { width, height } = getHappeningOutputDimensions(crop.width);
    let quality = 0.88;
    let blob: Blob | null = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new HappeningImageError("processing");
      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      blob = await encodeCanvas(canvas, quality);
      if (!blob) throw new HappeningImageError("processing");
      if (blob.size <= HAPPENING_IMAGE_TARGET_BYTES) break;

      if (quality > 0.64) {
        quality = Math.max(0.64, quality - 0.06);
      } else {
        width = Math.max(640, Math.round(width * 0.85));
        height = Math.max(400, Math.round(width / HAPPENING_IMAGE_ASPECT));
        quality = 0.76;
      }
    }

    if (!blob || blob.size > HAPPENING_IMAGE_TARGET_BYTES) {
      throw new HappeningImageError("too-large");
    }

    const extension = blob.type === "image/webp" ? "webp" : "jpg";
    const base = sourceName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "happening";
    return new File([blob], `${base}-cropped.${extension}`, { type: blob.type, lastModified: Date.now() });
  } catch (error) {
    if (error instanceof HappeningImageError) throw error;
    throw new HappeningImageError("processing");
  }
}
