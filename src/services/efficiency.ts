/**
 * 사냥 기대 메소와 손실률.
 *
 * 나무위키 「메이플스토리/재화」와 메이플로드 사냥 메소 계산기의 규칙을 따른다(2026-09 확인).
 *   마리당 기본 메소 = 몬스터 레벨 × 7.5   (레벨의 6~9배 중 평균)
 *   메소 주머니 확률 = min(100%, 60% × (1 + 아이템 드롭률))   → 드롭률이 67%를 넘으면 100%
 *   마리당 메소      = 기본 메소 × 주머니 확률 × (1 + 메소 획득량) × 레벨 차이 배율
 *   처치 수          = 1젠 몹 수 × (사냥 시간 ÷ 7.5초)   또는   6분 마릿수 × (사냥 시간 ÷ 6분)
 * 메소 획득량은 합연산 값(장비·어빌리티·유니온 등)에 재물 획득의 비약 ×1.2를 곱한 최종 값이다(최대 300%).
 * 일일 메소 한도는 메소 획득량·레벨 차이 배율을 적용하기 전의 기본 메소로 찬다. 다 차면 필드 메소가 더 떨어지지 않는다.
 */
import { koreaDay, type Hunt } from "./domain";

export const REGEN_MS = 7_500;
export const SIX_MINUTES = 6 * 60_000;
export const MESO_PER_MONSTER_LEVEL = 7.5;
/** 재물 획득의 비약: 메소 ×1.2(곱연산), 아이템 드롭률 +20%(합연산). 소형·일반 모두 같다. */
export const POTION_MESO = 1.2;
export const POTION_DROP = 20;
/** 메소 주머니 기본 드롭 확률(%). 아이템 드롭률만큼 늘어난다. */
export const MESO_BAG_BASE = 60;
/** 아이템 드롭률(%)이 이 값을 넘으면 메소 주머니가 100% 떨어진다(60% × 1.67 > 100%). */
export const MESO_BAG_DROP_THRESHOLD = 67;
/** 게임이 적용하는 최대치(%). 넘는 값은 여기까지만 반영한다. */
export const MAX_MESO_RATE = 300;
export const MAX_DROP_RATE = 500;

export type Plan = {
  /** 사냥터 이름. 미니맵 제목을 읽거나 직접 입력한다. */
  map: string | null;
  mapId?: string;
  mapVersion?: string;
  characterLevel: number | null;
  monsterLevel: number | null;
  /** 처치 수 기준. mobs: 맵 몹 수를 7.5초마다 모두 잡는다고 본다. kills6m: 6분 동안 실제로 잡은 수. */
  basis: "mobs" | "kills6m";
  mobCount: number | null;
  kills6m: number | null;
  /**
   * 메소 획득량(%). formula 2는 재물 획득의 비약 ×1.2까지 곱한 최종 값이다.
   * formula가 없는 예전 기록은 비약을 뺀 값이라 계산할 때 ×1.2를 곱한다.
   */
  mesoRate: number | null;
  /** 아이템 드롭률(%). 메소 주머니 확률에 쓴다. 모르면 67%를 넘는다고(주머니 100%) 본다. */
  dropRate: number | null;
  /** 레벨 차이 메소 배율(%). formula 2는 캐릭터·몬스터 레벨로 정하고, 예전 기록은 저장된 값(기본 100%)을 쓴다. */
  levelFactor: number;
  /** 캐릭터 레벨을 넥슨 API에서 가져왔는지. */
  source?: "api" | "manual";
  /** 2: 최종 메소 획득량·레벨 차이 표·기본 메소 한도로 계산하는 지금 방식. 없으면 예전 방식의 기록이다. */
  formula?: 2;
};
export const EMPTY_PLAN: Plan = { map: null, characterLevel: null, monsterLevel: null, basis: "mobs", mobCount: null, kills6m: null,
  mesoRate: null, dropRate: null, levelFactor: 100, formula: 2 };

/**
 * 레벨별 일일 메소 획득 한도(기본 메소 기준). 모르는 레벨이면 null.
 * 200~259: 8,000만 + 200레벨 초과 5레벨당 500만 · 260~300: 1억 5,000만 + 260레벨 초과 5레벨당 1,000만
 */
export function dailyMesoCap(level: number | null | undefined): number | null {
  if (level == null || !Number.isInteger(level) || level < 1 || level > 300) return null;
  if (level < 100) return 20_000_000;
  if (level < 200) return 40_000_000;
  if (level < 260) return 80_000_000 + Math.floor((level - 200) / 5) * 5_000_000;
  return 150_000_000 + Math.floor((level - 260) / 5) * 10_000_000;
}

/** 캐릭터가 몬스터보다 21~29레벨 높을 때의 메소 배율(%). 11~20레벨은 1레벨당 2%씩 줄고 30레벨부터는 0이다. */
const HIGHER_21_TO_29 = [75, 69, 62, 54, 45, 35, 24, 16, 3];
/**
 * 레벨 차이에 따른 메소 배율(%). ±10레벨 안은 100%다.
 * 몬스터가 11~20레벨 높으면 1레벨당 3%, 21~33레벨 높으면 70%에서 1레벨당 5%씩 줄고 34레벨부터는 떨어지지 않는다.
 * 혼합 맵의 평균 레벨처럼 소수이면 반올림한 차이로 본다.
 */
export function levelMesoFactor(characterLevel: number | null | undefined, monsterLevel: number | null | undefined): number | null {
  if (characterLevel == null || monsterLevel == null) return null;
  const gap = Math.round(characterLevel - monsterLevel);
  if (Math.abs(gap) <= 10) return 100;
  if (gap > 0) return gap <= 20 ? 100 - 2 * (gap - 10) : gap < 30 ? HIGHER_21_TO_29[gap - 21] : 0;
  const above = -gap;
  return above <= 20 ? 100 - 3 * (above - 10) : above < 34 ? 70 - 5 * (above - 20) : 0;
}
/** 메소 주머니가 떨어질 확률(0~1). 드롭률을 모르면 1로 본다. */
export function mesoBagRate(dropRate: number | null | undefined): number {
  if (dropRate == null) return 1;
  return Math.min(1, MESO_BAG_BASE / 100 * (1 + Math.min(MAX_DROP_RATE, Math.max(0, dropRate)) / 100));
}
/** 계산에 쓰는 최종 메소 획득량(%). 예전 기록은 비약 ×1.2를 곱해 맞춘다. */
export function finalMesoRate(plan: Plan): number | null {
  if (plan.mesoRate == null) return null;
  const rate = plan.formula === 2 ? plan.mesoRate : ((1 + plan.mesoRate / 100) * POTION_MESO - 1) * 100;
  return Math.min(MAX_MESO_RATE, Math.max(0, rate));
}
/** 계산에 쓰는 레벨 차이 배율(%). */
export function planLevelFactor(plan: Plan): number {
  return plan.formula === 2 ? levelMesoFactor(plan.characterLevel, plan.monsterLevel) ?? 100 : plan.levelFactor;
}
/**
 * 예전 기록의 계산 조건을 지금 방식(formula 2)으로 바꾼다. 기록을 고칠 때 쓴다.
 * 메획은 비약 ×1.2를 곱한 최종 값으로, 드롭률은 비약 20%를 더한 값으로, 레벨 차이 배율은 표로 바꾼다.
 */
export function upgradePlan(plan: Plan): Plan {
  if (plan.formula === 2) return plan;
  const meso = finalMesoRate(plan);
  return { ...plan, formula: 2, mesoRate: meso == null ? null : Math.round(meso * 100) / 100,
    dropRate: plan.dropRate == null ? null : plan.dropRate + POTION_DROP,
    levelFactor: levelMesoFactor(plan.characterLevel, plan.monsterLevel) ?? 100 };
}
/**
 * 계산에 쓰는 메소 주머니 확률. 예전 기록은 당시 방식대로 늘 떨어진다고 본다.
 * 그때 저장한 드롭률은 스탯창 값이라 사냥할 때의 프리셋·비약과 다를 수 있기 때문이다.
 */
function planBagRate(plan: Plan) { return plan.formula === 2 ? mesoBagRate(plan.dropRate) : 1; }
/** 마리당 기본 메소(주머니 확률 반영). 일일 한도는 이 값으로 찬다. */
export function basePerKill(plan: Plan): number | null {
  return plan.monsterLevel ? plan.monsterLevel * MESO_PER_MONSTER_LEVEL * planBagRate(plan) : null;
}
/** 마리당 기대 메소. 계산에 필요한 값이 없으면 null. */
export function mesoPerKill(plan: Plan): number | null {
  const base = basePerKill(plan); const rate = finalMesoRate(plan);
  if (base == null || rate == null) return null;
  return base * (1 + rate / 100) * (planLevelFactor(plan) / 100);
}
export function killsFor(plan: Plan, durationMs: number): number | null {
  if (durationMs <= 0) return 0;
  if (plan.basis === "kills6m") return plan.kills6m ? plan.kills6m * durationMs / SIX_MINUTES : null;
  return plan.mobCount ? plan.mobCount * durationMs / REGEN_MS : null;
}
/**
 * 사냥 시간 동안의 기대 메소. baseBefore는 같은 날 앞선 사냥이 일일 한도에 채운 기본 메소다.
 * base는 이 사냥이 한도에 채울 기본 메소, raw는 한도를 무시한 값이다.
 */
export function expectedMeso(plan: Plan | null | undefined, durationMs: number, baseBefore = 0) {
  if (!plan) return null;
  const perKill = mesoPerKill(plan); const base = basePerKill(plan); const kills = killsFor(plan, durationMs);
  if (perKill == null || base == null || kills == null) return null;
  // 기대값이라 1메소 단위는 반올림한다(소수 배율의 부동소수점 오차로 1메소씩 흔들리지 않게).
  const raw = Math.round(kills * perKill); const baseRaw = kills * base;
  const cap = dailyMesoCap(plan.characterLevel);
  const room = cap == null ? Infinity : Math.max(0, cap - Math.max(0, baseBefore));
  const capped = baseRaw > room;
  const expected = capped ? Math.round(kills * perKill * (baseRaw > 0 ? room / baseRaw : 0)) : raw;
  return { expected, raw, kills, perKill, capped, cap, base: Math.min(baseRaw, room) };
}
/**
 * 일일 한도를 새로 채울 때의 값. 한도까지 걸리는 시간과 그때까지 얻는 메소.
 * 레벨·몹 수·배율 중 하나라도 없으면 null.
 */
export function capOutlook(plan: Plan) {
  const cap = dailyMesoCap(plan.characterLevel); const base = basePerKill(plan); const rate = finalMesoRate(plan);
  const kills = killsFor(plan, 60 * 60_000);
  if (cap == null || base == null || rate == null || !kills) return null;
  const basePerHour = kills * base;
  if (basePerHour <= 0) return null;
  return { cap, timeMs: cap / basePerHour * 3_600_000, meso: Math.round(cap * (1 + rate / 100) * planLevelFactor(plan) / 100) };
}
/** 손실률 = (기대 − 실제) ÷ 기대. 음수면 기대보다 더 얻었다는 뜻이다. */
export function lossRate(expected: number | null | undefined, actual: number | null | undefined) {
  return expected && expected > 0 && actual != null ? (expected - actual) / expected : null;
}
/** 사냥터 이름 비교용 키. 공백·구두점 차이로 다른 사냥터가 되지 않게 한다. */
export const mapKey = (name: string | null | undefined) => (name ?? "").replace(/[\s:·.,\-_()[\]]/g, "");
export type Expectation = { expected: number | null; loss: number | null; capped: boolean };

/**
 * 한 사냥이 일일 한도에 채운 기본 메소. 실제 획득 메소를 배율로 나눠 되돌리고, 실제 값이 없으면 기대값을 쓴다.
 * 계산 조건이 없는 예전 기록은 배율을 몰라 0으로 둔다.
 */
function filledBase(hunt: Hunt, expectedBase: number) {
  const plan = hunt.plan; if (!plan) return 0;
  const rate = finalMesoRate(plan); const factor = planLevelFactor(plan);
  if (hunt.meso != null && rate != null && factor > 0) return hunt.meso / ((1 + rate / 100) * factor / 100);
  return expectedBase;
}
/** 같은 날(한국 날짜) 사냥을 시작 순서대로 돌며 기대 메소와, 그 사냥까지 한도에 채운 기본 메소를 넘긴다. */
function walkDays(hunts: Hunt[], now: number, visit: (hunt: Hunt, value: ReturnType<typeof expectedMeso>, filled: number) => void) {
  const days = new Map<string, Hunt[]>();
  for (const hunt of hunts) { const day = koreaDay(hunt.startedAt); days.set(day, [...(days.get(day) ?? []), hunt]); }
  for (const list of days.values()) {
    let filled = 0;
    for (const hunt of [...list].sort((a, b) => a.startedAt - b.startedAt)) {
      const end = hunt.endedAt ?? (hunt.status === "hunting" ? Math.min(now, hunt.expiresAt) : hunt.startedAt);
      const value = expectedMeso(hunt.plan, end - hunt.startedAt, filled);
      filled += filledBase(hunt, value?.base ?? 0);
      visit(hunt, value, filled);
    }
  }
}
/**
 * 기록마다 기대 메소와 손실률. 일일 한도에서는 같은 날 앞선 사냥이 채운 기본 메소를 뺀다.
 * 진행 중인 사냥은 지금까지의 시간으로 계산하고 손실률은 끝난 뒤에만 낸다.
 */
export function expectations(hunts: Hunt[], now = Date.now()) {
  const result = new Map<string, Expectation>();
  walkDays(hunts, now, (hunt, value) => result.set(hunt.id, { expected: value?.expected ?? null, capped: value?.capped ?? false,
    loss: hunt.status === "hunting" ? null : lossRate(value?.expected, hunt.meso) }));
  return result;
}
/** 그날(한국 날짜) 사냥들이 일일 한도에 채운 기본 메소. */
export function filledOn(hunts: Hunt[], day: string, now = Date.now()) {
  let total = 0;
  walkDays(hunts.filter(hunt => koreaDay(hunt.startedAt) === day), now, (_hunt, _value, filled) => { total = filled; });
  return total;
}
