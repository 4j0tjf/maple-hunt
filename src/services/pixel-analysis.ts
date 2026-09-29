import { countStacks, findIcons, findInventory, findMapHeader, readBuffMinutes, overlap, type Box, type Pixels } from "./scanner";

export type PixelRequest = { pixels: Pixels; icons: Record<"small" | "large" | "fragment" | "meso" | "point", Pixels> };
export type SearchState = { width: number; height: number; stripe: number; layout: ReturnType<typeof findInventory>; buff: { kind: "small" | "large"; region: Box } | null };
export const createSearchState = (): SearchState => ({ width: 0, height: 0, stripe: 0, layout: null, buff: null });
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
  const header = findMapHeader(pixels);
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
