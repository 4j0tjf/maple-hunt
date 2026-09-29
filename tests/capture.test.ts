import test from "node:test";
import assert from "node:assert/strict";
import { captureFrame } from "../src/services/browser";

test("capture reads the shared track without a video element and closes its bitmap", async () => {
  let closed = false, drawn = false;
  const track = { readyState: "live", muted: false } as MediaStreamTrack;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => { drawn = true; } }) };
  const originals = ["ImageCapture", "document"].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, "ImageCapture", { configurable: true, value: class {
    constructor(input: MediaStreamTrack) { assert.equal(input, track); }
    async grabFrame() { return { width: 1920, height: 1080, close: () => { closed = true; } }; }
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement(tag: string) { assert.equal(tag, "canvas"); return canvas; } } });
  try {
    assert.equal(await captureFrame(track), canvas);
    assert.equal(canvas.width, 1920); assert.equal(canvas.height, 1080);
    assert.ok(drawn && closed);
    await assert.rejects(captureFrame({ readyState: "ended" } as MediaStreamTrack), /공유 화면/);
    await assert.rejects(captureFrame({ readyState: "live", muted: true } as MediaStreamTrack), /공유 화면/);
  } finally {
    ["ImageCapture", "document"].forEach((key, i) => {
      if (originals[i]) Object.defineProperty(globalThis, key, originals[i]!); else Reflect.deleteProperty(globalThis, key);
    });
  }
});
