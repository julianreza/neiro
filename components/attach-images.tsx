"use client";

import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/attachments";
import type { ImageAttachment } from "@/lib/types";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/** Turns picked, pasted or dropped files into checked image attachments. */
export async function filesToImages(files: File[], have: number): Promise<ImageAttachment[]> {
  const out: ImageAttachment[] = [];
  for (const file of files) {
    if (have + out.length >= MAX_IMAGES) {
      toast.error(`Attach at most ${MAX_IMAGES} images`);
      break;
    }
    if (!IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number])) {
      toast.error(`${file.name}: only PNG, JPEG, WebP and GIF`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(`${file.name} is larger than 2 MB`);
      continue;
    }
    out.push({ name: file.name || "screenshot.png", dataUrl: await readAsDataUrl(file) });
  }
  return out;
}

/** Paste/drop handlers to put on the text box next to the attach button. */
export function useImageDrop(images: ImageAttachment[], onChange: (next: ImageAttachment[]) => void) {
  const add = async (files: File[]) => {
    if (files.length === 0) return;
    const more = await filesToImages(files, images.length);
    if (more.length) onChange([...images, ...more]);
  };
  return {
    onPaste: (event: ClipboardEvent) => {
      const files = [...event.clipboardData.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        event.preventDefault();
        void add(files);
      }
    },
    onDrop: (event: DragEvent) => {
      const files = [...event.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        event.preventDefault();
        void add(files);
      }
    },
    onDragOver: (event: DragEvent) => {
      if ([...event.dataTransfer.items].some((i) => i.kind === "file")) event.preventDefault();
    },
  };
}

/** A paperclip button plus the thumbnails of what is attached. */
export function AttachImages({
  images,
  onChange,
  disabled = false,
}: {
  images: ImageAttachment[];
  onChange: (next: ImageAttachment[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="attach-images">
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        hidden
        onChange={async (event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          setBusy(true);
          const more = await filesToImages(files, images.length);
          setBusy(false);
          if (more.length) onChange([...images, ...more]);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9"
        aria-label={`Attach images (${images.length} of ${MAX_IMAGES})`}
        title="Attach screenshots: PNG, JPEG, WebP or GIF, up to 2 MB each. You can also paste or drop them."
        disabled={disabled || busy || images.length >= MAX_IMAGES}
        onClick={() => input.current?.click()}
      >
        <ImagePlus aria-hidden="true" />
      </Button>
      {images.length > 0 && (
        <ul className="attach-thumbs" aria-label="Attached images">
          {images.map((img, i) => (
            <li key={`${img.name}-${i}`} className="attach-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL preview */}
              <img src={img.dataUrl} alt={img.name} />
              <button
                type="button"
                aria-label={`Remove ${img.name}`}
                onClick={() => onChange(images.filter((_, j) => j !== i))}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
