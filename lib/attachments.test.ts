import assert from "node:assert/strict";
import { test } from "node:test";
import { base64Bytes, MAX_IMAGE_BYTES, validateAttachments } from "./attachments";

const png = (bytes = 3) => `data:image/png;base64,${"A".repeat(Math.ceil((bytes * 4) / 3 / 4) * 4)}`;

test("valid images pass, names are kept or made up", () => {
  const r = validateAttachments([{ name: " shot.png ", dataUrl: png() }, { dataUrl: "data:image/webp;base64,QUJD" }]);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.images.map((i) => i.name), ["shot.png", "image-2"]);
  assert.deepEqual(validateAttachments(undefined), { ok: true, images: [] });
});

test("too many, wrong type, too big or broken images are refused", () => {
  assert.equal(validateAttachments(Array.from({ length: 5 }, () => ({ dataUrl: png() }))).ok, false);
  assert.equal(validateAttachments([{ dataUrl: "data:image/svg+xml;base64,QUJD" }]).ok, false);
  assert.equal(validateAttachments([{ dataUrl: "data:text/html;base64,QUJD" }]).ok, false);
  assert.equal(validateAttachments([{ dataUrl: "https://example.com/a.png" }]).ok, false);
  assert.equal(validateAttachments([{ dataUrl: "data:image/png;base64,@@@" }]).ok, false);
  assert.equal(validateAttachments([{ dataUrl: png(MAX_IMAGE_BYTES + 10) }]).ok, false);
  assert.equal(validateAttachments("nope").ok, false);
});

test("base64 size ignores padding", () => {
  assert.equal(base64Bytes("QUJD"), 3);
  assert.equal(base64Bytes("QUI="), 2);
  assert.equal(base64Bytes("QQ=="), 1);
});
