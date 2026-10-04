import test from "node:test";
import assert from "node:assert/strict";
import { analyzePixels, createSearchState } from "../src/services/pixel-analysis";
import { binarizeMapText, bounded, COUNT_DIGITS, countStacks, findIcons, findInventory, findMapHeader, readBuffTimer, readItemCount, type Pixels } from "../src/services/scanner";

const blank = (width: number, height: number, gray = 219): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4).fill(gray);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
};
const pattern = (seed: number, width = 12, height = 12): Pixels => {
  const icon = blank(width, height);
  for (let i = 0; i < icon.data.length; i += 4) icon.data.set([(i * seed + 40) % 256, (i * 7 + seed) % 256, (i * 3 + seed * 5) % 256], i);
  return icon;
};
const paste = (frame: Pixels, icon: Pixels, x: number, y: number) => {
  for (let dy = 0; dy < icon.height; dy++) for (let dx = 0; dx < icon.width; dx++) {
    const from = (dy * icon.width + dx) * 4; frame.data.set(icon.data.subarray(from, from + 4), ((y + dy) * frame.width + x + dx) * 4);
  }
};
test("inventory is the meso coin with the maple point icon on the same row", () => {
  const coin = pattern(13), point = pattern(29), frame = blank(1000, 800);
  paste(frame, coin, 150, 600);
  assert.equal(findInventory(frame, coin, point), null, "a coin alone may be a meso drop on the field");
  paste(frame, point, 331, 600);
  const found = findInventory(frame, coin, point)!;
  assert.deepEqual(found.amount, { x: 164, y: 596, w: 152, h: 20 });
  assert.deepEqual(found.panel, { x: 140, y: 205, w: 770, h: 390 });
  const far = blank(1000, 800); paste(far, coin, 150, 600); paste(far, point, 450, 600);
  assert.equal(findInventory(far, coin, point), null);
});

test("incremental inventory search revalidates cached positions and resets after resize", () => {
  const coin = pattern(13), point = pattern(29), frame = blank(1000, 800);
  const empty = { width: 20, height: 20, data: new Uint8ClampedArray(1600) };
  const icons = { meso: coin, point, small: empty, large: empty, fragment: empty };
  paste(frame, coin, 150, 600); paste(frame, point, 331, 600);
  const state = createSearchState();
  let found = false;
  for (let i = 0; i < 4; i++) if (analyzePixels({ pixels: frame, icons }, state).layout) found = true;
  assert.ok(found, "all inventory positions are searched within four scans");
  assert.ok(analyzePixels({ pixels: frame, icons }, state).layout, "cached position is verified immediately");
  assert.equal(analyzePixels({ pixels: blank(1000, 800), icons }, state).layout, null, "closed inventory must not reuse old values");
  analyzePixels({ pixels: blank(900, 700), icons }, state);
  assert.equal(state.width, 900); assert.equal(state.height, 700); assert.equal(state.layout, null);
});
/** 실제 인벤토리처럼 개수를 아이콘 칸 왼쪽 아래(아이콘보다 7px 왼쪽, 24px 아래)에 그린다. */
const count = (frame: Pixels, icon: { x: number; y: number }, text: string) => {
  let x = icon.x - 7;
  for (const digit of text) {
    COUNT_DIGITS[digit].forEach((row, dy) => [...row].forEach((tone, dx) => {
      if (tone !== ".") frame.data.set(tone === "#" ? [0, 0, 0] : [255, 255, 255], ((icon.y + 24 + dy) * frame.width + x + dx) * 4);
    }));
    x += COUNT_DIGITS[digit][0].length;
  }
  return frame;
};
test("item counts are read from the outlined digit font next to the icon", () => {
  const icon = { x: 60, y: 20, w: 30, h: 32 };
  for (const text of ["1", "42", "4432", "1910", "1257", "567890"]) assert.equal(readItemCount(count(blank(140, 80), icon, text), icon), Number(text), text);
  assert.equal(readItemCount(blank(140, 80), icon), null, "no digits is unknown, never zero");
  const noise = blank(140, 80); for (let i = 0; i < noise.data.length; i += 4) noise.data.set([(i * 37) % 256, (i * 11) % 256, (i * 5) % 256], i);
  assert.equal(readItemCount(noise, icon), null);
});
test("fragments split over several slots are added up, and one unreadable slot makes the total unknown", () => {
  const fragment = pattern(31, 30, 32), panel = { x: 0, y: 0, w: 400, h: 200 };
  const slots = [{ x: 20, y: 20 }, { x: 160, y: 20 }, { x: 67, y: 110 }];
  const frame = blank(400, 200);
  for (const [i, slot] of slots.entries()) { paste(frame, fragment, slot.x, slot.y); count(frame, slot, ["9999", "9999", "1234"][i]); }
  const all = countStacks(frame, fragment, panel, 1);
  assert.equal(all.stacks.length, 3); assert.deepEqual(all.counts, [9999, 9999, 1234]); assert.equal(all.total, 21232);
  const hidden = blank(400, 200);
  for (const [i, slot] of slots.entries()) { paste(hidden, fragment, slot.x, slot.y); if (i !== 1) count(hidden, slot, "10"); }
  assert.equal(countStacks(hidden, fragment, panel, 1).total, null, "never report 20 when one slot is unread");
  assert.equal(countStacks(blank(400, 200), fragment, panel, 1).total, null, "no fragment slot is unknown, not zero");
});
test("minimap header lines are found from pixels next to the map icon", () => {
  // 실제 미니맵 모양: 청회색 바탕, 밝은 2px 테두리의 36px 정사각형 아이콘, 그 오른쪽 밝은 글자 두 줄, 오른쪽 끝부터는 밝은 게임 화면.
  const draw = (titleBar: number) => {
    const frame = blank(320, 130 + titleBar, 0);
    const fill = (x: number, y: number, w: number, h: number, rgb: number[]) => {
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) frame.data.set(rgb, ((y + titleBar + dy) * frame.width + x + dx) * 4);
    };
    for (let i = 0; i < titleBar * frame.width; i++) frame.data.set([243, 243, 243], i * 4);
    fill(0, 0, 205, 130, [52, 70, 80]); fill(205, 0, 115, 130, [200, 230, 250]);
    fill(7, 29, 36, 36, [240, 240, 240]); fill(9, 31, 32, 32, [120, 90, 160]);
    for (let x = 51; x < 95; x += 3) fill(x, 32, 2, 10, [215, 226, 230]);
    for (let x = 51; x < 131; x += 3) fill(x, 50, 2, 10, [215, 226, 230]);
    return frame;
  };
  const plain = findMapHeader(draw(0))!;
  // 글자 획은 x 51~94(지역), 51~130(사냥터). 좌우 8·9px, 위아래 7·8px 여백을 둔다.
  assert.deepEqual(plain.street, { x: 43, y: 25, w: 60, h: 24 });
  assert.deepEqual(plain.name, { x: 43, y: 43, w: 96, h: 24 });
  const shared = findMapHeader(draw(31))!;
  assert.equal(shared.name.y, plain.name.y + 31, "a window title bar only shifts the lines");
  assert.equal(findMapHeader(blank(320, 130, 243)), null, "a solid bright bar is not the map icon");
});
test("map text binarization keeps the 140 cutoff on the usual dark header and follows a brighter one", () => {
  // 글자 1칸, 바탕 3칸. 글자는 검게(0), 바탕은 희게(255) 바뀐다.
  const pixels = (ground: number, text: number) => new Uint8ClampedArray([text, text, text, 255, ...[0, 1, 2].flatMap(() => [ground, ground, ground, 255])]);
  const dark = pixels(70, 150);
  assert.equal(binarizeMapText(dark), 140);
  assert.deepEqual([dark[0], dark[4]], [0, 255]);
  const bright = pixels(138, 250);
  assert.equal(binarizeMapText(bright), 198, "a header background near 140 is not painted as text");
  assert.deepEqual([bright[0], bright[4]], [0, 255]);
});
test("automatic start needs a timer with seconds, never a stack count or minute-only text", () => {
  assert.equal(readBuffTimer("29:58"), 1798000);
  assert.equal(readBuffTimer("119:59"), 7199000);
  assert.equal(readBuffTimer("1:59:59"), 7199000);
  assert.equal(readBuffTimer("29분 59초"), 1799000);
  for (const text of ["30", "30분", "29:99", "재획 29:59", "", "1200"]) assert.equal(readBuffTimer(text), null);
});
test("automatic icons survive different backgrounds, reject noise, and exclude inventory potions", () => {
  const icon = { width: 20, height: 24, data: new Uint8ClampedArray(20 * 24 * 4) };
  for (let y = 3; y < 22; y++) for (let x = 3; x < 18; x++) {
    icon.data.set([x * 11 % 256, y * 17 % 256, (x + y) * 21 % 256, 255], (y * 20 + x) * 4);
  }
  const frame = { width: 120, height: 90, data: new Uint8ClampedArray(120 * 90 * 4).fill(55) };
  for (let y = 0; y < 24; y++) for (let x = 0; x < 20; x++) {
    const i = (y * 20 + x) * 4;
    if (icon.data[i + 3]) frame.data.set(icon.data.subarray(i, i + 4), ((y + 11) * 120 + x + 37) * 4);
  }
  const area = { x: 0, y: 0, w: 120, h: 90 };
  assert.deepEqual(findIcons(frame, icon, area, [1]).map(({ x, y }) => [x, y]), [[37, 11]]);
  assert.deepEqual(findIcons(frame, icon, area, [1], [{ x: 30, y: 0, w: 35, h: 50 }]), []);
  frame.data.fill(0); assert.deepEqual(findIcons(frame, icon, area, [1]), []);
});
test("crop clipping never reaches outside a resized capture", () => {
  assert.deepEqual(bounded({ x: -5, y: 90, w: 40, h: 20 }, 100, 100), { x: 0, y: 90, w: 35, h: 10 });
  assert.equal(bounded({ x: 120, y: 0, w: 10, h: 10 }, 100, 100).w, 0);
});
