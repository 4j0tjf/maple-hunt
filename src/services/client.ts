import { apiUrl } from "@/base-path";
import { koreaDay, type Hunt } from "./domain";
import { EMPTY_PLAN, mapKey, type Plan } from "./efficiency";
import { EMPTY_SETUP, readSetup, type RateSetup } from "./rates";

export type Session = { token: string; expiresAt: number; character: { id: string; name: string } };
/** 서버가 돌려준 기록. auctionPrice는 그날 경매장 평균가, evidence는 증거 이미지 수. */
export type HuntRow = Hunt & { auctionPrice?: string | null; evidence?: number; pending?: boolean };
type Outbox = Record<string, { characterId: string; hunt: Hunt }>;

const SESSION = "maple-hunting-session-v1";
const OUTBOX = "maple-hunting-outbox-v1";
const PRICE = "maple-hunting-manual-price-v1";
export const LEGACY_RECORDS = "maple-hunting-records-v1";

/** 세션은 이 탭에만 둔다. 탭을 닫으면 다시 비밀번호를 넣는다. 비밀번호 원문은 어디에도 저장하지 않는다. */
export function loadSession(): Session | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION) ?? "null") as Session | null;
    return session && session.expiresAt > Date.now() ? session : null;
  } catch { return null; }
}
export function storeSession(session: Session | null) {
  try { if (session) sessionStorage.setItem(SESSION, JSON.stringify(session)); else sessionStorage.removeItem(SESSION); } catch { /* 이 탭에서만 기억하지 못할 뿐 */ }
}

export class ApiError extends Error { constructor(message: string, readonly status: number, readonly data: unknown) { super(message); } }
export async function api<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (typeof init.body === "string") headers["Content-Type"] = "application/json";
  const response = await fetch(apiUrl(path), { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  const data = response.headers.get("content-type")?.includes("json") ? await response.json().catch(() => null) : null;
  if (!response.ok) throw new ApiError((data as { error?: string } | null)?.error ?? `요청 실패 (${response.status})`, response.status, data);
  return data as T;
}

/** 서버에 아직 못 올린 기록. 네트워크가 끊기거나 창을 닫아도 다음 로그인 때 이어서 올린다. */
export function readOutbox(): Outbox {
  try { return JSON.parse(localStorage.getItem(OUTBOX) ?? "{}") as Outbox; } catch { return {}; }
}
export function writeOutbox(box: Outbox) { localStorage.setItem(OUTBOX, JSON.stringify(box)); }

/** 경매장 시세가 없던 날 직접 넣은 조각 가격. 그날만 쓴다. */
export function loadManualPrice(now = Date.now()): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PRICE) ?? "null") as { day: string; price: string } | null;
    return saved?.day === koreaDay(now) ? saved.price : null;
  } catch { return null; }
}
export function storeManualPrice(price: string, now = Date.now()) {
  try { localStorage.setItem(PRICE, JSON.stringify({ day: koreaDay(now), price })); } catch { /* 이번 화면에서만 쓴다 */ }
}

/**
 * 기대 메소 계산 설정. 캐릭터별 공통값(레벨)과 메획·아획 출처별 설정(setup), 사냥터별 값(몬스터 레벨·몹 수)을 이 브라우저에 둔다.
 * 사냥 기록에는 시작할 때의 값이 함께 저장되므로 다른 기기에서도 기대값·손실률이 보인다.
 */
const PLAN = "maple-hunting-plan-v1";
export type MapPreset = Pick<Plan, "map" | "mapId" | "mapVersion" | "monsterLevel" | "basis" | "mobCount" | "kills6m">;
export type PlanStore = { settings: Pick<Plan, "characterLevel" | "mesoRate" | "dropRate" | "levelFactor" | "source">; maps: Record<string, MapPreset>; lastMap: string | null;
  setup?: RateSetup };
export function loadPlanStore(characterId: string): PlanStore {
  try {
    const all = JSON.parse(localStorage.getItem(PLAN) ?? "{}") as Record<string, PlanStore>;
    const saved = all[characterId];
    if (saved) return { settings: { ...pickSettings(EMPTY_PLAN), ...saved.settings }, maps: saved.maps ?? {}, lastMap: saved.lastMap ?? null, setup: readSetup(saved.setup) };
  } catch { /* 처음 쓰는 것으로 본다 */ }
  return { settings: pickSettings(EMPTY_PLAN), maps: {}, lastMap: null, setup: EMPTY_SETUP };
}
export function storePlanStore(characterId: string, store: PlanStore) {
  try {
    const all = JSON.parse(localStorage.getItem(PLAN) ?? "{}") as Record<string, PlanStore>;
    localStorage.setItem(PLAN, JSON.stringify({ ...all, [characterId]: store }));
  } catch { /* 이번 화면에서만 쓴다 */ }
}
const pickSettings = (plan: Plan): PlanStore["settings"] =>
  ({ characterLevel: plan.characterLevel, mesoRate: plan.mesoRate, dropRate: plan.dropRate, levelFactor: plan.levelFactor, source: plan.source });
/** 저장된 설정과 사냥터 값을 합친 지금의 계산 조건. */
export function planFrom(store: PlanStore, map: string | null): Plan {
  const name = map ?? store.lastMap;
  const preset = store.maps[mapKey(name)];
  return { ...EMPTY_PLAN, ...store.settings, ...(preset ?? {}), map: name ?? preset?.map ?? null };
}
/** 계산 조건을 고치면 캐릭터 공통값과 그 사냥터 값으로 나눠 저장한다. */
export function rememberPlan(store: PlanStore, plan: Plan): PlanStore {
  const preset: MapPreset = { map: plan.map, mapId: plan.mapId, mapVersion: plan.mapVersion, monsterLevel: plan.monsterLevel, basis: plan.basis, mobCount: plan.mobCount, kills6m: plan.kills6m };
  return { ...store, settings: pickSettings(plan), maps: { ...store.maps, [mapKey(plan.map)]: preset }, lastMap: plan.map };
}
