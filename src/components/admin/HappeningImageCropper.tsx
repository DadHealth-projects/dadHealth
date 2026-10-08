"use client";

import { useState } from "react";
import Cropper, {
  type Area,
  type Point,
} from "react-easy-crop";

import {
  createCroppedHappeningImage,
  HAPPENING_IMAGE_ASPECT,
  HappeningImageError,
} from "@/lib/happeningImageProcessing";

interface HappeningImageCropperProps {
  sourceUrl: string;
  sourceName: string;
  onCancel: () => void;
  onUse: (file: File) => Promise<void>;
}

export default function HappeningImageCropper({
  sourceUrl,
  sourceName,
  onCancel,
  onUse,
}: HappeningImageCropperProps) {
  const [crop, setCrop] = useState<Point>({
    x: 0,
    y: 0,
  });

  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUseImage = async () => {
    if (!area || processing) return;

    setProcessing(true);
    setError(null);

    try {
      const file = await createCroppedHappeningImage(
        sourceUrl,
        area,
        sourceName,
      );

      await onUse(file);
    } catch (caught) {
      setError(
        caught instanceof HappeningImageError
          ? caught.message
          : "Image processing failed. Please try another photo.",
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/70 p-2"
      role="dialog"
      aria-modal="true"
      aria-labelledby="happening-crop-title"
    >
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card p-1 sm:p-2 shadow-[0_0_28px_hsl(var(--primary)/0.10)]">
        <h3
          id="happening-crop-title"
          className="font-heading text-lg font-extrabold uppercase leading-none text-foreground sm:text-xl"
        >
          Position photo
        </h3>

        <p className="mt-0 text-xs leading-tight text-muted-foreground">
          Drag to reposition. Zoom until the important content fits inside the
          frame.
        </p>

        <div className="relative mt-1 h-[min(480px,56dvh)] w-full overflow-hidden rounded-xl border border-border bg-background">
          <Cropper
            image={sourceUrl}
            crop={crop}
            zoom={zoom}
            aspect={HAPPENING_IMAGE_ASPECT}
            minZoom={1}
            maxZoom={3}
            objectFit="contain"
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_percentage, pixels) => setArea(pixels)}
          />
        </div>

        <label
          className="mt-0 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
          htmlFor="happening-image-zoom"
        >
          Zoom
        </label>

        <input
          id="happening-image-zoom"
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="h-4 w-full accent-primary"
        />

        {error && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div className="mt-0 grid grid-cols-2 gap-2 border-t border-border pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="inline-flex min-h-8 items-center justify-center rounded-full border border-border px-4 text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => void handleUseImage()}
            disabled={!area || processing}
            className="inline-flex min-h-8 items-center justify-center rounded-full bg-primary px-4 text-xs font-bold uppercase tracking-wide text-primary-foreground transition-all hover:brightness-110 disabled:opacity-60"
          >
            {processing ? "Processing…" : "Use image"}
          </button>
        </div>
      </div>
    </div>
  );
}