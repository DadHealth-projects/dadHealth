import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyHappeningImageInput,
  getHappeningOutputDimensions,
  HAPPENING_IMAGE_ASPECT,
} from "../src/lib/happeningImageProcessing.ts";

test("accepts standard and iPhone image source types", () => {
  assert.equal(classifyHappeningImageInput({ name: "photo.jpg", type: "image/jpeg" }), "standard");
  assert.equal(classifyHappeningImageInput({ name: "photo.PNG", type: "image/png" }), "standard");
  assert.equal(classifyHappeningImageInput({ name: "photo.webp", type: "image/webp" }), "standard");
  assert.equal(classifyHappeningImageInput({ name: "IMG_1001.HEIC", type: "" }), "heic");
  assert.equal(classifyHappeningImageInput({ name: "IMG_1001", type: "image/heif" }), "heic");
});

test("rejects unsupported source types", () => {
  assert.equal(classifyHappeningImageInput({ name: "image.gif", type: "image/gif" }), "unsupported");
  assert.equal(classifyHappeningImageInput({ name: "notes.txt", type: "text/plain" }), "unsupported");
});

test("caps output at 1600px and preserves homepage 8:5 ratio", () => {
  assert.deepEqual(getHappeningOutputDimensions(4000), { width: 1600, height: 1000 });
  assert.deepEqual(getHappeningOutputDimensions(800), { width: 800, height: 500 });
  assert.equal(HAPPENING_IMAGE_ASPECT, 8 / 5);
});
