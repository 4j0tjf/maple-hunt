import { parseCount, parseMeso, parseTimer } from "./domain";

export type Box = { x: number; y: number; w: number; h: number };
export type TextBox = Box & { text: string; confidence: number };
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };
export const compact = (text: string) => text.replace(/\s/g, "");
export function inside(a: Box, b: Box) {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}
export function overlap(a: Box, b: Box) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
export function bounded(box: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  return { x, y, w: Math.max(0, Math.min(width, Math.ceil(box.x + box.w)) - x), h: Math.max(0, Math.min(height, Math.ceil(box.y + box.h)) - y) };
}

/**
 * 인벤토리 아래쪽 메소 줄. 메소 동전 오른쪽 180px에 메이플포인트(P) 아이콘이 같은 줄로 있어야 인벤토리로 본다.
 * 필드에 떨어진 메소나 다른 창의 동전은 P 아이콘이 없어 걸러진다. 거리는 KMS 인벤토리(2026-09 UI)에서 잰 값이다.
 */
export function findInventory(frame: Pixels, coin: Pixels, point: Pixels, area?: Box, scales = [1, 1.25, 1.5, 2]) {
  const whole = area ?? { x: 0, y: 0, w: frame.width, h: frame.height };
  for (const found of findIcons(frame, coin, whole, scales)) {
    const scale = found.w / coin.width;
    const pointArea = { x: found.x + 170 * scale, y: found.y - 4 * scale, w: 25 * scale, h: found.h + 8 * scale };
    if (!findIcons(frame, point, pointArea, [scale], [], 1).length) continue;
    return {
      scale,
      anchor: { x: found.x, y: found.y, w: found.w, h: found.h },
      // 메소는 동전 오른쪽 흰 칸에 오른쪽 정렬로 "7451만 5280"처럼 나온다.
      amount: bounded({ x: found.x + found.w + 2 * scale, y: found.y - 4 * scale, w: 152 * scale, h: found.h + 8 * scale }, frame.width, frame.height),
      // 아이템 칸 8줄은 메소 줄 바로 위에 있다.
      panel: bounded({ x: found.x - 10 * scale, y: found.y - 395 * scale, w: 770 * scale, h: 390 * scale }, frame.width, frame.height),
    };
  }
  return null;
}

/**
 * 아이템 개수 숫자(높이 11px, 어두운 테두리 안에 밝은 채움). '#' 어두움, 'o' 밝음, '.' 상관없음.
 * 인벤토리 화면의 여러 개수 표시에서 뽑아 다수결로 만들었다. OCR은 이 테두리 글꼴을 거의 읽지 못한다.
 * 글자 바깥과 안쪽 구멍은 아이콘이 비쳐 보이므로 비교하지 않는다(조각 아이콘 그림자 위에 겹친 네 자리 수).
 */
export const COUNT_DIGITS: Record<string, string[]> = {
  "0": ["..####..", ".#oooo#.", "#o####o#", "#o#..#o#", "#o#..#o#", "#o#..#o#", "#o#..#o#", "#o#..#o#", "#o####o#", ".#oooo#.", "..####.."],
  "1": ["...##", ".##o#", "#ooo#", "###o#", "..#o#", "..#o#", "..#o#", "..#o#", "..#o#", "..#o#", "..###"],
  "2": ["..####..", ".#oooo#.", "#o####o#", "##...#o#", ".....#o#", "...##o#.", "..#oo#..", ".#o##...", "#o######", "#oooooo#", "########"],
  "3": ["..####..", ".#oooo#.", "#o####o#", "###..#o#", "..####o#", "..#ooo#.", "..####o#", "##o..#o#", "#o####o#", ".#oooo#.", "..####.."],
  "4": [".....##.", "....#o#.", "...#oo#.", "..#o#o#.", ".#o##o#.", "#o###o##", "#oooooo#", "#####o##", "....#o#.", "....#o#.", "....###."],
  "5": ["########", "#oooooo#", "#o######", "#o####..", "#ooooo#.", ".#####o#", ".....#o#", "##...#o#", "#o####o#", ".#oooo#.", "..####.."],
  "6": ["...####.", "..#ooo#.", ".#o####.", "#o####..", "#ooooo#.", "#o####o#", "#o#..#o#", "#o#..#o#", "#o####o#", ".#oooo#.", "..####.."],
  "7": ["########", "#oooooo#", "######o#", "....#o#.", "....#o#.", "...#o#..", "...#o#..", "..#o#...", "..#o#...", ".#o#....", ".###...."],
  "8": ["..####..", ".#oooo#.", "#o####o#", "#o#..#o#", "#o####o#", ".#oooo#.", "#o####o#", "#o#..#o#", "#o####o#", ".#oooo#.", "..####.."],
  "9": ["..####..", ".#oooo#.", "#o####o#", "#o#..#o#", "#o#..#o#", "#o####o#", ".#ooooo#", "..####o#", ".#####o#", ".#oooo#.", ".#####.."],
};
/**
 * 같은 아이템이 여러 칸에 나뉘어 있으면(한 칸 최대 개수를 넘은 경우 등) 모든 칸의 개수를 더한다.
 * 한 칸이라도 개수를 못 읽으면 합계가 실제보다 작게 나오므로 total은 null이다. 칸이 없어도 0이 아니라 null이다.
 * 다른 창에 가려진 칸은 알 수 없으니 인벤토리 아이템 칸을 가리지 않게 해야 한다.
 */
export function countStacks(frame: Pixels, icon: Pixels, area: Box, scale: number) {
  const stacks = findIcons(frame, icon, area, [scale], [], 128).sort((a, b) => a.y - b.y || a.x - b.x);
  const counts = stacks.map(stack => readItemCount(frame, stack));
  const total = stacks.length && counts.every(count => count != null) ? counts.reduce((sum, count) => sum! + count!, 0) : null;
  return { stacks, counts, total };
}
/** 아이콘 칸 왼쪽 아래의 개수 글자 영역. 증거 이미지에도 이 영역을 남긴다. */
export const countBand = (icon: Box): Box => ({ x: icon.x - 12, y: icon.y + icon.h - 12, w: icon.w + 24, h: 22 });
/**
 * 아이템 개수. 첫 숫자는 아이콘 왼쪽 아래에서 찾고, 이어지는 숫자는 바로 옆에 붙어 있어야 한다.
 * 숫자 모양이 90% 이상 맞을 때만 읽으며 원본 크기(100%) 화면만 지원한다. 확실하지 않으면 null.
 */
export function readItemCount(frame: Pixels, icon: Box): number | null {
  const tone = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return "";
    const i = (y * frame.width + x) * 4, r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
    return Math.max(r, g, b) < 110 ? "#" : Math.min(r, g, b) > 150 ? "o" : "";
  };
  const match = (digit: string, x: number, y: number) => {
    let hit = 0, total = 0;
    COUNT_DIGITS[digit].forEach((row, dy) => [...row].forEach((want, dx) => {
      if (want === ".") return;
      total++; if (tone(x + dx, y + dy) === want) hit++;
    }));
    return hit / total;
  };
  const best = (xs: number[], ys: number[]) => {
    let top = { digit: "", x: 0, y: 0, score: 0 };
    for (const x of xs) for (const y of ys) for (const digit of Object.keys(COUNT_DIGITS)) {
      const score = match(digit, x, y);
      if (score > top.score) top = { digit, x, y, score };
    }
    return top.score >= .9 ? top : null;
  };
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const first = best(range(icon.x - 12, icon.x - 2), range(icon.y + icon.h - 12, icon.y + icon.h - 4));
  if (!first) return null;
  let text = first.digit, x = first.x + COUNT_DIGITS[first.digit][0].length;
  for (let next = best([x], [first.y]); next; next = best([x], [first.y])) {
    text += next.digit; x += COUNT_DIGITS[next.digit][0].length;
    if (text.length > 6) return null;
  }
  return parseCount(text);
}

/**
 * 사냥터 이름으로 쓸 만한 글자인지. 한글 2자 이상, 숫자·시간만으로 된 글자는 제외하고 30자로 자른다.
 * 앞쪽의 한글 없는 조각("ELH] 미슈피라의 눈"처럼 미니맵 아이콘을 읽은 것)은 뗀다. 뒤쪽 숫자(군락 1)는 사냥터 구분이라 둔다.
 */
export function normalizeMap(text: string | null | undefined): string | null {
  const value = (text ?? "").replace(/[^가-힣A-Za-z0-9 :.\-()]/g, "").replace(/\s+/g, " ").trim()
    .replace(/^(?:[^\s가-힣]+ )+(?=\S*[가-힣])/, "").slice(0, 30);
  if ((value.match(/[가-힣]/g) ?? []).length < 2 || readBuffTimer(value) !== null) return null;
  return value;
}
/**
 * 미니맵 머리글을 읽을 영역. 창을 공유하면 위에 제목 표시줄(약 30px)이 붙어도 두 줄이 다 들어가는 크기다.
 * 더 넓히면 미니맵 버튼·지도를 글자로 잘못 읽어 두 줄을 놓치는 일이 잦았다(실제 화면 4장으로 비교).
 */
export const mapHeader = (width: number, height: number): Box => ({ x: 0, y: 0, w: Math.min(width, 300), h: Math.min(height, 120) });
export type MapHeader = { icon: Box; street: Box; name: Box };
/**
 * 미니맵 머리글의 두 줄(지역, 사냥터 이름) 위치를 픽셀로 찾는다.
 * 머리글 전체를 OCR로 훑으면 줄 찾기부터 흔들렸다(카르시온 → "| EES"로 읽혀 두 줄을 못 짝지음).
 * 구조(KMS 2026-09): 밝은 테두리의 정사각형 지도 아이콘 오른쪽, 짙은 청회색 바탕에 밝은 글자 두 줄.
 * area 왼쪽 iconSpan 안의 아이콘 후보를 왼쪽부터 차례로 보고, 오른쪽에 두 줄이 나오는 첫 후보를 쓴다.
 * 밝은 무늬가 많은 화면을 넓게 찾아도 오래 걸리지 않게 확인할 후보 수에 한도를 둔다.
 */
export function findMapHeader(frame: Pixels, area = mapHeader(frame.width, frame.height), iconSpan = 140): MapHeader | null {
  const bounds = bounded(area, frame.width, frame.height), areaRight = bounds.x + bounds.w, areaBottom = bounds.y + bounds.h;
  // 밝은 글자·테두리: 세 색이 모두 밝고 비슷하다(흰색·밝은 회색).
  const mask = new Uint8Array(bounds.w * bounds.h);
  for (let y = bounds.y; y < areaBottom; y++) for (let x = bounds.x; x < areaRight; x++) {
    const i = (y * frame.width + x) * 4, r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2], low = Math.min(r, g, b);
    if (low > 190 && Math.max(r, g, b) - low < 40) mask[(y - bounds.y) * bounds.w + x - bounds.x] = 1;
  }
  const bright = (x: number, y: number) => mask[(y - bounds.y) * bounds.w + x - bounds.x] === 1;
  const dark = (x: number, y: number) => { const i = (y * frame.width + x) * 4; return x < areaRight && Math.max(frame.data[i], frame.data[i + 1], frame.data[i + 2]) < 120; };
  // 1) 아이콘: 세로로 밝은 테두리 두 개가 한 변 길이만큼 떨어져 같은 높이에 있다.
  type Column = { x: number; top: number; length: number };
  const columns: Column[] = [], byX: Column[][] = Array.from({ length: bounds.w }, () => []);
  for (let x = bounds.x; x < areaRight; x++) {
    for (let y = bounds.y, run = 0; y <= areaBottom; y++) {
      if (y < areaBottom && bright(x, y)) { run++; continue; }
      if (run >= 24 && run <= 80) { const column = { x, top: y - run, length: run }; byX[x - bounds.x].push(column); if (x < bounds.x + iconSpan) columns.push(column); }
      run = 0;
    }
  }
  // 위·아래 변도 밝은 테두리다(모서리가 둥글어 세로 테두리 끝보다 2px쯤 위·아래에 있다).
  const framed = (left: number, top: number, right: number, h: number) => [top, top + h - 1].every(edge => {
    let lit = 0, all = 0;
    for (let x = left + 4; x <= right - 4; x++) { all++; for (let y = Math.max(bounds.y, edge - 3); y <= Math.min(areaBottom - 1, edge + 3); y++) if (bright(x, y)) { lit++; break; } }
    return all > 0 && lit / all >= .9;
  });
  // 속이 밝게 꽉 찬 사각형(밝은 창 제목 표시줄 등)은 아이콘이 아니다. 아이콘 안쪽은 지도 그림이다.
  const hollow = (left: number, top: number, right: number, h: number) => {
    let lit = 0, all = 0;
    for (let y = top + 3; y < top + h - 3; y++) for (let x = left + 3; x < right - 2; x++) { all++; if (bright(x, y)) lit++; }
    return all > 0 && lit / all < .8;
  };
  const luma = (x: number, y: number) => { const i = (y * frame.width + x) * 4; return frame.data[i] * .299 + frame.data[i + 1] * .587 + frame.data[i + 2] * .114; };
  // 2) 글자 영역: 아이콘 오른쪽에서 글자 기둥을 글자 사이 간격(14px 이하)으로 이어 끝을 정한다.
  //    두 줄 사이 행이 어두운 곳(머리글 바탕)까지로도 자른다. 바탕이 실제 화면보다 밝아 그 끝이 첫 글자 앞이면 간격만 본다
  //    (바탕이 조금만 밝아도 바탕 끝을 아이콘 바로 옆으로 잡아 두 줄을 통째로 놓쳤다).
  //    글자 기둥은 바탕(중앙값)보다 50 이상 밝은 픽셀이 있는 세로줄이다. 경계가 부드러운 글꼴은 아주 밝은 픽셀만 보면 글자 사이가 끊긴다.
  const lines = (icon: { x: number; y: number; right: number; h: number }): MapHeader | null => {
    const top = icon.y, bottom = Math.min(areaBottom, icon.y + icon.h), start = icon.right + 3, middle = icon.y + Math.round(icon.h / 2);
    const ground: number[] = [];
    for (let y = top; y < bottom; y++) for (let x = start; x < Math.min(areaRight, start + 120); x++) ground.push(luma(x, y));
    const level = ground.sort((a, b) => a - b)[ground.length >> 1] + 50;
    const lit = (x: number) => { for (let y = top; y < bottom; y++) if (luma(x, y) > level) return true; return false; };
    let first = start;
    while (first < Math.min(areaRight, start + 16) && !lit(first)) first++;
    if (first >= Math.min(areaRight, start + 16)) return null;
    let edge = start;
    while (edge < areaRight && (dark(edge, middle) || dark(edge + 1, middle) || dark(edge + 2, middle))) edge++;
    let last = first;
    // 사냥터 이름은 머리글 폭(약 300px)을 넘지 않는다.
    for (let x = first, stop = Math.min(edge > first ? edge : areaRight, start + 320); x < stop && x - last <= 14; x++) if (lit(x)) last = x;
    // 3) 밝은 글자가 있는 행을 묶으면 두 줄이 나온다.
    const rows: number[] = [];
    for (let y = top; y < bottom; y++) for (let x = first; x <= last; x++) if (bright(x, y)) { rows.push(y); break; }
    const bands: { top: number; bottom: number }[] = [];
    for (const y of rows) {
      const previous = bands[bands.length - 1];
      if (previous && y - previous.bottom <= 2) previous.bottom = y; else bands.push({ top: y, bottom: y });
    }
    const found = bands.filter(band => band.bottom - band.top >= 5 && band.bottom - band.top <= 24);
    if (found.length !== 2) return null;
    const box = (band: { top: number; bottom: number }): Box => {
      let left = last, right = first;
      for (let y = band.top; y <= band.bottom; y++) for (let x = first; x <= last; x++) if (bright(x, y)) { left = Math.min(left, x); right = Math.max(right, x); }
      // 여백이 좁으면 OCR이 첫 줄(카르시온)을 통째로 놓치고 끝 글자(눈)를 =로 읽었다.
      return { x: left - 8, y: band.top - 7, w: right - left + 17, h: band.bottom - band.top + 15 };
    };
    return { icon: { x: icon.x, y: icon.y, w: icon.right - icon.x + 1, h: icon.h }, street: box(found[0]), name: box(found[1]) };
  };
  let budget = 64;
  for (const left of columns) for (let x = left.x + left.length - 6; x <= left.x + left.length + 6; x++) for (const right of byX[x - bounds.x] ?? []) {
    if (Math.abs(right.top - left.top) > 2 || Math.abs(right.length - left.length) > 3 || !framed(left.x, left.top, right.x, left.length) || !hollow(left.x, left.top, right.x, left.length)) continue;
    const header = lines({ x: left.x, y: Math.min(left.top, right.top), right: right.x, h: left.length });
    if (header) return header;
    if (--budget === 0) return null;
  }
  return null;
}

/**
 * 사냥터 이름 조각을 흰 바탕의 검은 글자로 이진화한다(밝은 작은 글자 그대로는 OCR이 못 읽는다).
 * 기준은 밝기 140이고, 바탕(가장 흔한 밝기 쪽인 중앙값)이 밝게 비치면 바탕보다 60 밝은 곳까지 올린다.
 * 기준을 고정하면 바탕이 조금만 밝아도 바탕까지 글자로 칠해져 "거대 산호 군락 2"를 "AM 군락 2"로 읽었다.
 */
export function binarizeMapText(data: Uint8ClampedArray) {
  const luma = new Float32Array(data.length / 4), histogram = new Uint32Array(256);
  for (let i = 0; i < luma.length; i++) histogram[Math.round(luma[i] = data[i * 4] * .299 + data[i * 4 + 1] * .587 + data[i * 4 + 2] * .114)]++;
  let median = 0;
  for (let seen = 0; median < 255 && (seen += histogram[median]) < luma.length / 2; median++);
  const threshold = Math.max(140, median + 60);
  for (let i = 0; i < luma.length; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = luma[i] > threshold ? 0 : 255;
  return threshold;
}

/** A timer is accepted only next to a matched potion; seconds are mandatory for start dating. */
export function readBuffTimer(text: string) {
  const value = compact(text);
  if (!/^(?:\d{1,3}:\d{2}(?::\d{2})?|(?:\d+시간)?\d+분\d+초|\d+초)$/.test(value)) return null;
  return parseTimer(value);
}
/** 아이콘 왼쪽 아래 흰 테두리 숫자는 분 단위 남은 시간이다. 상한으로 표시하며 최대 1분 오차가 있다. */
export function readBuffMinutes(frame: Pixels, icon: Box, kind: "small" | "large") {
  const minutes = readItemCount(frame, icon);
  const maximum = kind === "small" ? 30 : 120;
  return minutes !== null && minutes >= 1 && minutes <= maximum ? Math.min(maximum, minutes + 1) * 60_000 : null;
}
export function readAmount(text: string) {
  return parseMeso(text);
}

/** Alpha-masked matching ignores transparent game backgrounds and item quantity overlays. */
export function findIcons(frame: Pixels, icon: Pixels, area: Box, scales = [1, 1.25, 1.5, 2], excluded: Box[] = [], limit = 3, threshold = 23): Box[] {
  const bounds = bounded(area, frame.width, frame.height);
  const found: (Box & { score: number })[] = [];
  for (const scale of scales) {
    const w = Math.round(icon.width * scale), h = Math.round(icon.height * scale);
    const samples: { dx: number; dy: number; rgb: number[] }[] = [];
    for (let y = 1; y < icon.height * .72; y += 2) for (let x = 1; x < icon.width; x += 2) {
      const i = (y * icon.width + x) * 4;
      if (icon.data[i + 3] < 245) continue;
      samples.push({ dx: Math.min(w - 1, Math.floor((x + .5) * scale)), dy: Math.min(h - 1, Math.floor((y + .5) * scale)), rgb: [icon.data[i], icon.data[i + 1], icon.data[i + 2]] });
    }
    if (samples.length < 12) continue;
    // Distribute early rejection samples over the entire icon, not a single similar corner.
    const order = samples.filter((_, i) => i % 4 === 0).concat(samples.filter((_, i) => i % 4 !== 0));
    for (let y = bounds.y; y <= bounds.y + bounds.h - h; y++) for (let x = bounds.x; x <= bounds.x + bounds.w - w; x++) {
      let sum = 0, count = 0;
      for (const s of order) {
        const i = ((y + s.dy) * frame.width + x + s.dx) * 4;
        sum += Math.abs(frame.data[i] - s.rgb[0]) + Math.abs(frame.data[i + 1] - s.rgb[1]) + Math.abs(frame.data[i + 2] - s.rgb[2]);
        count++;
        if (count === 8 && sum > 8 * 3 * 42 || sum > threshold * order.length * 3) break;
      }
      if (count !== order.length || sum / (count * 3) > threshold) continue;
      const box = { x, y, w, h, score: sum / (count * 3) };
      if (!excluded.some(e => overlap(box, e))) found.push(box);
    }
  }
  const selected: Box[] = [];
  for (const box of found.sort((a, b) => a.score - b.score)) {
    if (!selected.some(e => overlap(e, box))) selected.push(box);
    if (selected.length === limit) break;
  }
  return selected;
}
