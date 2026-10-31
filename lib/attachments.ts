import type { ImageAttachment } from "@/lib/types";

/**
 * Images attached to a mission or a chat message, as data: URLs. Used in the
 * browser (before sending) and again on the server (never trusted).
 */

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const NAME_MAX = 120;

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Decoded size of a base64 payload, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export type AttachmentResult = { ok: true; images: ImageAttachment[] } | { ok: false; error: string };

export function validateAttachments(input: unknown): AttachmentResult {
  if (input === undefined || input === null) return { ok: true, images: [] };
  if (!Array.isArray(input)) return { ok: false, error: "attachments must be a list" };
  if (input.length > MAX_IMAGES) return { ok: false, error: `Attach at most ${MAX_IMAGES} images` };
  const images: ImageAttachment[] = [];
  for (const [i, raw] of input.entries()) {
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const dataUrl = typeof item?.dataUrl === "string" ? item.dataUrl : "";
    const match = DATA_URL.exec(dataUrl);
    if (!match) return { ok: false, error: `Image ${i + 1} is not a valid image` };
    if (!IMAGE_TYPES.includes(match[1] as (typeof IMAGE_TYPES)[number])) {
      return { ok: false, error: `Image ${i + 1}: only PNG, JPEG, WebP and GIF are allowed` };
    }
    if (base64Bytes(match[2]) > MAX_IMAGE_BYTES) {
      return { ok: false, error: `Image ${i + 1} is larger than 2 MB` };
    }
    const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim() : `image-${i + 1}`;
    images.push({ name: name.slice(0, NAME_MAX), dataUrl });
  }
  return { ok: true, images };
}
