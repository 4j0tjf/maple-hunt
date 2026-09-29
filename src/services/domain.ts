import type { Plan } from "./efficiency";

export type Potion = "small" | "large";
export const DURATION: Record<Potion, number> = { small: 30 * 60_000, large: 120 * 60_000 };
export type Reading = { at: number; meso: number | null; fragments: number | null };
export type Side = "baseline" | "final";
export type Amount = "meso" | "fragments";
export type ManualField = `${Side}.${Amount}`;
export type Hunt = {
  id: string; character: string | null; startedAt: number; endedAt: number | null;
  expiresAt: number; potion: Potion; small: number; large: number;
  baseline: Reading | null; final: Reading | null;
  meso: number | null; fragments: number | null;
  status: "hunting" | "finishing" | "saved"; reason: string | null;
  source: "automatic" | "manual"; recordingId: string | null;
  /** 사용자가 직접 채운 값. OCR이 나중에 읽어도 덮지 않는다. */
  manual?: ManualField[];
  /** 그날 경매장 시세가 없을 때 사용자가 넣은 조각 개당 가격. */
  manualPrice?: string | null;
  /** 기대 메소 계산 조건(사냥터·몬스터 레벨·메획 등). 시작할 때의 설정을 담고 나중에 고칠 수 있다. */
  plan?: Plan;
};
export function createHunt(id: string, potion: Potion, at: number, character: string | null, source: Hunt["source"]): Hunt {
  return { id, character, startedAt: at, endedAt: null, expiresAt: at + DURATION[potion], potion,
    small: potion === "small" ? 1 : 0, large: potion === "large" ? 1 : 0, baseline: null, final: null,
    meso: null, fragments: null, status: "hunting", reason: null, source, recordingId: null };
}
export function addPotion(hunt: Hunt, potion: Potion, at: number): Hunt {
  if (hunt.status !== "hunting" || at >= hunt.expiresAt) return hunt;
  return { ...hunt, potion, expiresAt: at + DURATION[potion], [potion]: hunt[potion] + 1 };
}
export function finishHunt(hunt: Hunt, at: number, reason: string): Hunt {
  if (hunt.status !== "hunting") return hunt;
  return { ...hunt, status: "finishing", endedAt: Math.max(hunt.startedAt, Math.min(at, hunt.expiresAt)), reason };
}
function delta(start: number | null | undefined, end: number | null | undefined) {
  return start == null || end == null || end < start ? null : end - start;
}
export function observeInventory(hunt: Hunt, reading: Reading): Hunt {
  if (hunt.status === "saved" || reading.at < hunt.startedAt) return hunt;
  // A late first inventory is not a valid starting balance.
  if (reading.at <= hunt.startedAt + 30_000 && hunt.status === "hunting") {
    const previous = hunt.baseline;
    return { ...hunt, baseline: { at: previous?.at ?? reading.at,
      meso: previous?.meso ?? reading.meso, fragments: previous?.fragments ?? reading.fragments } };
  }
  if (hunt.status === "finishing" && reading.at >= hunt.endedAt! && reading.at <= hunt.endedAt! + 60_000) {
    const read = (key: Amount) => hunt.manual?.includes(`final.${key}`) ? hunt.final![key] : reading[key] ?? hunt.final?.[key] ?? null;
    const final = { at: reading.at, meso: read("meso"), fragments: read("fragments") };
    return { ...hunt, final, meso: delta(hunt.baseline?.meso, final.meso), fragments: delta(hunt.baseline?.fragments, final.fragments) };
  }
  return hunt;
}
/** 비약을 쓰기 전에 인벤토리를 열어 확인한 수량을 시작값으로 인정하는 시간. 그보다 오래된 값은 그 사이 변했을 수 있다. */
export const PRE_START_MS = 3 * 60_000;
/** 항목별로 마지막에 확정된 보유량과 그 시각. 메소와 조각은 서로 다른 순간에 읽힐 수 있다. */
export type Seen = { meso: { value: number; at: number } | null; fragments: { value: number; at: number } | null };
export const NOTHING_SEEN: Seen = { meso: null, fragments: null };
export function noteInventory(seen: Seen, reading: Reading): Seen {
  return { meso: reading.meso != null ? { value: reading.meso, at: reading.at } : seen.meso,
    fragments: reading.fragments != null ? { value: reading.fragments, at: reading.at } : seen.fragments };
}
/** 사냥 시작 기준으로 쓸 수 있는 값: 시작 전 PRE_START_MS부터 시작 후 30초(인식 지연)까지. */
export function seenValue(entry: Seen[Amount], startedAt: number) {
  return entry && entry.at >= startedAt - PRE_START_MS && entry.at <= startedAt + 30_000 ? entry.value : null;
}
/** 새 사냥에 비약 사용 직전 확인한 수량을 시작값으로 채운다. 이후 30초 안의 인식은 빈 항목만 채운다. */
export function withPreStart(hunt: Hunt, seen: Seen): Hunt {
  const meso = seenValue(seen.meso, hunt.startedAt); const fragments = seenValue(seen.fragments, hunt.startedAt);
  if (hunt.baseline || (meso == null && fragments == null)) return hunt;
  const times = [meso != null ? seen.meso!.at : Infinity, fragments != null ? seen.fragments!.at : Infinity];
  return { ...hunt, baseline: { at: Math.min(...times), meso, fragments } };
}
export function saveHunt(hunt: Hunt): Hunt {
  return { ...hunt, status: "saved", meso: delta(hunt.baseline?.meso, hunt.final?.meso), fragments: delta(hunt.baseline?.fragments, hunt.final?.fragments) };
}
/**
 * Fill a value that was never recorded. A recorded value is never overwritten by hand; end values wait for the end.
 * A typed value stands for the balance at the hunt's start or end, so it is stamped with that time.
 */
export function fillMissing(hunt: Hunt, side: Side, key: Amount, value: number): Hunt {
  if (hunt[side]?.[key] != null || (side === "final" && hunt.status === "hunting") || !Number.isSafeInteger(value) || value < 0) return hunt;
  const at = side === "baseline" ? hunt.startedAt : hunt.endedAt ?? hunt.startedAt;
  const reading: Reading = { at: hunt[side]?.at ?? at, meso: hunt[side]?.meso ?? null, fragments: hunt[side]?.fragments ?? null };
  reading[key] = value;
  const next: Hunt = { ...hunt, [side]: reading, manual: [...(hunt.manual ?? []), `${side}.${key}` as const] };
  return { ...next, meso: delta(next.baseline?.meso, next.final?.meso), fragments: delta(next.baseline?.fragments, next.final?.fragments) };
}
/** 조각 환산 메소 = 이번 차수 획득 조각 × 개당 가격. 둘 중 하나라도 모르면 null. */
export function fragmentValue(fragments: number | null | undefined, price: string | null | undefined) {
  return fragments == null || !price || !/^\d+$/.test(price) ? null : (BigInt(fragments) * BigInt(price)).toString();
}
/** Strict OCR parser: never silently turn ambiguous letters into digits. */
export function parseCount(text: string): number | null {
  const compact = text.replace(/\s/g, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(compact)) return null;
  const number = Number(compact.replaceAll(",", ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
/**
 * 인벤토리 메소 표시. "7451만 5280", "12억 3456만 7890" 같은 억·만 단위와 쉼표 숫자를 받는다.
 * "74517 5280"처럼 단위를 숫자로 잘못 읽은 값은 띄어쓰기로 이어 붙이지 않고 버린다.
 */
export function parseMeso(text: string): number | null {
  const value = text.trim().replace(/\s*(억|만)\s*/g, "$1 ").trim();
  const unit = value.match(/^(?:(\d{1,4})억 ?)?(?:(\d{1,4})만 ?)?(\d{1,4})?$/);
  if (unit && (unit[1] || unit[2])) return Number(unit[1] ?? 0) * 100_000_000 + Number(unit[2] ?? 0) * 10_000 + Number(unit[3] ?? 0);
  return /\s/.test(value) ? null : parseCount(value);
}
export function parseTimer(text: string): number | null {
  const compact = text.replace(/\s/g, "");
  // 분+초 표시는 2시간 버프를 119:59처럼 60분 넘게 쓸 수 있다. 시간 칸이 있을 때만 분을 60 미만으로 본다.
  const clock = compact.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/);
  if (clock && Number(clock[3]) < 60 && (!clock[1] || (clock[2].length <= 2 && Number(clock[2]) < 60)))
    return (Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000;
  const korean = compact.match(/^(?:(\d+)시간)?(?:(\d+)분)?(?:(\d+)초)?$/);
  if (korean && compact) return (Number(korean[1] ?? 0) * 3600 + Number(korean[2] ?? 0) * 60 + Number(korean[3] ?? 0)) * 1000;
  return null;
}
/** Detect only a newly applied, near-full timer. Mid-buff capture cannot prove a use. */
export function potionFromTimer(ms: number | null): Potion | null {
  if (ms == null) return null;
  if (ms >= DURATION.large - 90_000 && ms <= DURATION.large) return "large";
  if (ms >= DURATION.small - 60_000 && ms <= DURATION.small) return "small";
  return null;
}
export class StableValue<T> {
  private value: T | null = null;
  private count = 0;
  read(value: T | null): T | null {
    if (value === null) { this.value = null; this.count = 0; return null; }
    this.count = value === this.value ? this.count + 1 : 1;
    this.value = value;
    return this.count >= 2 ? value : null;
  }
}
/** A visible buff when capture starts is not evidence that a potion was consumed. */
export class PotionDetector {
  private candidate = new StableValue<Potion>();
  private lastTimer: number | null = null;
  private lastUse = -Infinity;
  private absent = 0;
  private armed = false;
  private expectedEnd = 0;
  acknowledge(at: number) { this.lastUse = at; this.armed = false; }
  read(buff: boolean, timer: number | null, at: number): Potion | null {
    if (!buff) { this.absent++; if (this.absent >= 2 && at >= this.expectedEnd - 5000) this.armed = true; }
    else this.absent = 0;
    const kind = buff ? potionFromTimer(timer) : null;
    const stable = this.candidate.read(kind);
    // Only a rise in remaining time proves re-use. A large buff passing 30 min does not.
    const refresh = timer !== null && this.lastTimer !== null && timer > this.lastTimer + 20_000;
    let result: Potion | null = null;
    if (stable && at - this.lastUse > 90_000 && (this.armed || refresh)) {
      result = stable; this.acknowledge(at);
    }
    if (timer !== null && (!kind || stable || !refresh)) this.lastTimer = timer;
    if (timer !== null) this.expectedEnd = at + timer;
    return result;
  }
}
/** 한국 날짜(YYYY-MM-DD). 조각 시세는 이 날짜 단위로 매긴다. */
export function koreaDay(at: number) { return new Date(at + 9 * 3600_000).toISOString().slice(0, 10); }
