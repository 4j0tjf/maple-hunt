import { countStacks, findIcons, findInventory, findMapHeader, readBuffMinutes, overlap, type Box, type MapHeader, type Pixels } from "./scanner";

export type PixelRequest = { pixels: Pixels; icons: Record<"small" | "large" | "fragment" | "meso" | "point", Pixels> };
export type SearchState = { width: number; height: number; stripe: number; layout: ReturnType<typeof findInventory>; buff: { kind: "small" | "large"; region: Box } | null;
  /** 지난번에 찾은 미니맵 지도 아이콘. */
  mapIcon: Box | null };
export const createSearchState = (): SearchState => ({ width: 0, height: 0, stripe: 0, layout: null, buff: null, mapIcon: null });
/**
 * 미니맵 머리글은 지난번 자리 → 화면 왼쪽 위 → 화면 위쪽 절반 순서로 찾는다.
 * 모니터 전체를 공유하면 게임 창(과 미니맵)이 화면 왼쪽 위에 있지 않아 왼쪽 위만 보면 사냥터를 못 읽었다.
 */
export function locateMapHeader(pixels: Pixels, state?: SearchState): MapHeader | null {
  const last = state?.mapIcon;
  const header = (last && findMapHeader(pixels, { x: last.x - 16, y: last.y - 16, w: 360, h: last.h + 32 }, 32)) || findMapHeader(pixels)
    || findMapHeader(pixels, { x: 0, y: 0, w: pixels.width, h: Math.ceil(pixels.height / 2) }, pixels.width);
  if (state) state.mapIcon = header?.icon ?? null;
  return header;
}
export function analyzePixels({ pixels, icons }: PixelRequest, state?: SearchState) {
  if (state && (state.width !== pixels.width || state.height !== pixels.height)) Object.assign(state, createSearchState(), { width: pixels.width, height: pixels.height });
  const previous = state?.layout;
  // 저장한 위치에서도 동전과 P 아이콘을 다시 검증한다. 닫힌 인벤토리의 수량을 재사용하지 않는다.
  let layout = previous ? findInventory(pixels, icons.meso, icons.point, previous.anchor, [previous.scale]) : null;
  if (!layout) {
    // 전체 화면 탐색을 4회로 나눠 한 번에 CPU를 오래 점유하지 않는다. 경계의 아이콘은 겹쳐서 찾는다.
    const slice = Math.ceil(pixels.height / 4);
    const area = state ? { x: 0, y: state.stripe * slice, w: pixels.width, h: slice + Math.ceil(icons.meso.height * 2) } : undefined;
    layout = findInventory(pixels, icons.meso, icons.point, area);
    if (state) state.stripe = (state.stripe + 1) % 4;
  }
  if (state) state.layout = layout;
  const fragments = layout ? countStacks(pixels, icons.fragment, layout.panel, layout.scale) : null;
  const header = locateMapHeader(pixels, state);
  const area = { x: 0, y: 0, w: pixels.width, h: Math.min(pixels.height * .3, 300) };
  const savedBuff = state?.buff;
  const cachedBuff = savedBuff && (!layout || !overlap(savedBuff.region, layout.panel)) && findIcons(pixels, icons[savedBuff.kind], savedBuff.region,
    [savedBuff.region.w / icons[savedBuff.kind].width], [], 1, 34).length ? savedBuff : null;
  const candidates = cachedBuff ? [cachedBuff] : (["small", "large"] as const).flatMap(kind =>
    findIcons(pixels, icons[kind], area, [.75, 1, 1.25, 1.5, 2, 2.5], layout ? [layout.panel] : [], 3, 34).map(region => ({ kind, region })));
  const buff = candidates.length === 1 ? candidates[0] : null;
  if (state) state.buff = buff;
  return { layout, fragments, header, buff, minuteTimer: buff ? readBuffMinutes(pixels, buff.region, buff.kind) : null };
}
export type PixelResult = ReturnType<typeof analyzePixels>;
