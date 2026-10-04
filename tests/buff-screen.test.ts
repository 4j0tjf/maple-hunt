import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { findIcons, findMapHeader, readBuffMinutes, type Pixels } from "../src/services/scanner";
import { createSearchState, locateMapHeader } from "../src/services/pixel-analysis";
import { PotionDetector } from "../src/services/domain";

// 실제 화면에서 UI 부분만 잘랐다. 캐릭터·채팅·계정 정보는 포함하지 않는다.
const fixture = (name: string, width: number, height: number) => ({ width, height,
  data: new Uint8ClampedArray(gunzipSync(readFileSync(new URL(`./fixtures/${name}.rgba.gz`, import.meta.url)))) });

test("live buff panel finds only the small potion despite overlapping minute digits", () => {
  const frame = fixture("buffs", 442, 130);
  const area = { x: 0, y: 0, w: frame.width, h: frame.height };
  const small = findIcons(frame, fixture("small", 27, 27), area, [.75, 1, 1.25, 1.5, 2, 2.5], [], 3, 34);
  assert.equal(small.length, 1);
  assert.equal(small[0].x, 100);
  assert.equal(small[0].y, 82);
  assert.equal(readBuffMinutes(frame, small[0], "small"), 28 * 60_000);
  assert.deepEqual(findIcons(frame, fixture("large", 32, 32), area, [.75, 1, 1.25, 1.5, 2, 2.5], [], 3, 34), []);
  assert.deepEqual(findIcons(frame, fixture("small", 27, 27), area, [1], [small[0]], 3, 34), []);
});

const LIVE_HEADER = { icon: { x: 8, y: 33, w: 35, h: 32 }, street: { x: 44, y: 28, w: 57, h: 24 }, name: { x: 44, y: 46, w: 96, h: 24 } };
test("live minimap finds both lines independently of buff or inventory visibility", () => {
  assert.deepEqual(findMapHeader(fixture("minimap", 300, 120)), LIVE_HEADER);
});

const screen = (width: number, height: number, gray: number): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4).fill(gray);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
};
const paste = (frame: Pixels, piece: Pixels, x: number, y: number) => {
  for (let dy = 0; dy < piece.height; dy++) frame.data.set(piece.data.subarray(dy * piece.width * 4, (dy + 1) * piece.width * 4), ((y + dy) * frame.width + x) * 4);
  return frame;
};
const shift = (box: { x: number; y: number; w: number; h: number }, x: number, y: number) => ({ ...box, x: box.x + x, y: box.y + y });
test("live minimap is found when its header background shows brighter than the captured sample", () => {
  // 머리글 바탕(어두운 픽셀)만 밝은 색과 섞는다. 글자·아이콘 테두리는 그대로다.
  for (const [alpha, color] of [[.25, [255, 255, 255]], [.35, [255, 255, 255]], [.3, [250, 175, 205]]] as const) {
    const frame = fixture("minimap", 300, 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 186; x++) {
      const i = (y * 300 + x) * 4;
      if (Math.max(frame.data[i], frame.data[i + 1], frame.data[i + 2]) < 120) for (let c = 0; c < 3; c++) frame.data[i + c] = Math.round(frame.data[i + c] * (1 - alpha) + color[c] * alpha);
    }
    const found = findMapHeader(frame)!;
    assert.deepEqual([found.street, found.name], [LIVE_HEADER.street, LIVE_HEADER.name], `background +${alpha * 100}%`);
  }
});
test("live minimap is found when the game window is not at the top-left of a whole-monitor capture", () => {
  const frame = paste(screen(2560, 1440, 30), fixture("minimap", 300, 120), 320, 180);
  assert.equal(findMapHeader(frame), null, "the fixed top-left area alone misses it");
  const state = createSearchState();
  const found = locateMapHeader(frame, state)!;
  assert.deepEqual(found.name, shift(LIVE_HEADER.name, 320, 180));
  assert.deepEqual(found.street, shift(LIVE_HEADER.street, 320, 180));
  assert.deepEqual(state.mapIcon, shift(LIVE_HEADER.icon, 320, 180), "the next scan starts from the found position");
  assert.deepEqual(locateMapHeader(frame, state)?.name, found.name);
  assert.equal(locateMapHeader(screen(2560, 1440, 30), state), null, "a hidden minimap is not invented");
  assert.equal(state.mapIcon, null);
});
test("the wide minimap search ignores the live buff panel and stays bounded on busy screens", () => {
  const frame = paste(screen(1920, 1080, 40), fixture("buffs", 442, 130), 1478, 0);
  assert.equal(locateMapHeader(frame, createSearchState()), null);
  // 밝은 무늬로 가득한 화면(눈 맵 등)에서도 확인할 후보 수에 한도가 있어 오래 걸리지 않는다.
  const busy = screen(1920, 1080, 0);
  for (let y = 0; y < 1080; y++) for (let x = 0; x < 1920; x++) if ((Math.floor(x / 9) + Math.floor(y / 40)) % 2) busy.data.set([235, 238, 240], (y * 1920 + x) * 4);
  const started = performance.now();
  assert.equal(locateMapHeader(busy, createSearchState()), null);
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)}ms`);
});

test("minute countdown does not start an existing buff, but a new full countdown does", () => {
  const detector = new PotionDetector();
  assert.equal(detector.read(true, 28 * 60_000, 0), null);
  assert.equal(detector.read(true, 28 * 60_000, 2500), null);
  assert.equal(detector.read(true, 30 * 60_000, 5000), null);
  assert.equal(detector.read(true, 30 * 60_000, 7500), "small");
  assert.equal(detector.read(true, 30 * 60_000, 10000), null);
});
