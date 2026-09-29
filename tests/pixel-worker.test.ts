import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildSync } from "esbuild";
import type { PixelResult } from "../src/services/pixel-analysis";

test("bundled pixel worker analyzes a transferred screen and returns only detection data", async () => {
  const bundle = buildSync({ entryPoints: ["src/services/pixel.worker.ts"], bundle: true, write: false, platform: "browser", format: "iife", target: "es2020" }).outputFiles[0].text;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=value=>parentPort.postMessage(value);${bundle}\nparentPort.on('message',data=>self.onmessage({data}));`, { eval: true });
  const fixture = (name: string, width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(gunzipSync(readFileSync(new URL(`./fixtures/${name}.rgba.gz`, import.meta.url)))) });
  const crop = fixture("buffs", 442, 130);
  // 자동 탐색은 게임 창 위쪽 30%를 보므로 잘라낸 버프 아래에 여백을 복원한다.
  const pixels = { width: 442, height: 500, data: new Uint8ClampedArray(442 * 500 * 4) };
  pixels.data.set(crop.data);
  const blank = { width: 20, height: 20, data: new Uint8ClampedArray(1600) };
  try {
    const response = new Promise<{ result: PixelResult; error?: string }>((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    worker.postMessage({ pixels, icons: { small: fixture("small", 27, 27), large: fixture("large", 32, 32), meso: blank, point: blank, fragment: blank } }, [pixels.data.buffer]);
    assert.equal(pixels.data.byteLength, 0, "frame ownership moves to the worker instead of copying it");
    const reply = await response;
    assert.equal(reply.error, undefined);
    assert.equal(reply.result.buff?.kind, "small");
    assert.equal(reply.result.minuteTimer, 28 * 60_000);
    assert.equal(reply.result.layout, null);
  } finally { await worker.terminate(); }
});
