import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { findIcons, findMapHeader, readBuffMinutes } from "../src/services/scanner";
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

test("live minimap finds both lines independently of buff or inventory visibility", () => {
  assert.deepEqual(findMapHeader(fixture("minimap", 300, 120)), {
    street: { x: 44, y: 28, w: 57, h: 24 }, name: { x: 44, y: 46, w: 96, h: 24 },
  });
});

test("minute countdown does not start an existing buff, but a new full countdown does", () => {
  const detector = new PotionDetector();
  assert.equal(detector.read(true, 28 * 60_000, 0), null);
  assert.equal(detector.read(true, 28 * 60_000, 2500), null);
  assert.equal(detector.read(true, 30 * 60_000, 5000), null);
  assert.equal(detector.read(true, 30 * 60_000, 7500), "small");
  assert.equal(detector.read(true, 30 * 60_000, 10000), null);
});
