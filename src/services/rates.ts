/**
 * 메소 획득량·아이템 드롭률 설정(사냥 효율 카드의 기본 설정·추가 획득 설정).
 * 출처별 값을 따로 두고 합계를 계산한다. 넥슨 API 값으로 채우고, 사용자가 고칠 수 있다.
 */
import { levelMesoFactor, MAX_DROP_RATE, MAX_MESO_RATE, POTION_DROP, POTION_MESO, type Plan } from "./efficiency";
import type { CharacterInfo, RatePair } from "./nexon";

export type { RatePair };
export const NO_RATES: RatePair = { drop: 0, meso: 0 };

/** 입력 칸의 최대값. 장비는 잠재능력으로 얻을 수 있는 최대치(드롭 200%, 메획 100%)다. */
export const LIMITS = {
  equip: { drop: 200, meso: 100 }, ability: { drop: 20, meso: 20 }, holySymbol: 60,
  artifact: { drop: 12, meso: 12 }, grandSymbol: { drop: 30, meso: 30 },
} as const;

/** 팬텀 유니온 공격대원 등급(팬텀 레벨 기준)과 메소 획득량. */
export const PHANTOM_RANKS = [
  { rank: "B", level: 130, meso: 1 }, { rank: "A", level: 160, meso: 2 }, { rank: "S", level: 180, meso: 3 },
  { rank: "SS", level: 200, meso: 4 }, { rank: "SSS", level: 250, meso: 5 },
] as const;

/** 켜고 끄는 추가 효과. 재물 획득의 비약은 사냥 기록의 기준이라 여기 없이 늘 적용한다. */
export const EXTRAS = [
  { key: "unionLuck", group: "item", name: "유니온의 행운", effect: "아이템 드롭률 +50%", drop: 50, meso: 0 },
  { key: "unionWealth", group: "item", name: "유니온의 부", effect: "메소 획득량 +50%", drop: 0, meso: 50 },
  { key: "greed", group: "extra", name: "그리드 (섀도어)", effect: "메소 획득량 +20%", drop: 0, meso: 20 },
  { key: "pcRoom", group: "extra", name: "PC방 보너스 혜택", effect: "아이템 드롭률 +10%", drop: 10, meso: 0 },
  { key: "challengers", group: "extra", name: "챌린저스 사파이어 티어 이상", effect: "드롭률·메소 획득량 +20%", drop: 20, meso: 20 },
] as const;
export type ExtraKey = (typeof EXTRAS)[number]["key"];

export type RateSetup = {
  /** none: 아직 값이 없음 · api: 넥슨 API 값 그대로 · manual: 사용자가 고침(자동 불러오기가 덮지 않고, 불러오기 버튼은 덮는다). */
  origin: "none" | "api" | "manual";
  equipPreset: number | null; equip: RatePair;
  abilityPreset: number | null; ability: RatePair;
  /** 홀리 심볼의 아이템 드롭률. */
  holySymbol: number;
  /** 팬텀 유니온의 메소 획득량(0~5). 0이면 없음. */
  phantom: number;
  artifact: RatePair; grandSymbol: RatePair;
  extras: Record<ExtraKey, boolean>;
  /** 합계 대신 쓸 값. 메획은 비약까지 곱한 최종 값이다. */
  manualDrop: number | null; manualMeso: number | null;
};
export const EMPTY_SETUP: RateSetup = {
  origin: "none", equipPreset: null, equip: NO_RATES, abilityPreset: null, ability: NO_RATES, holySymbol: 0, phantom: 0,
  artifact: NO_RATES, grandSymbol: NO_RATES,
  extras: { unionLuck: false, unionWealth: false, greed: false, pcRoom: false, challengers: false },
  manualDrop: null, manualMeso: null,
};
/** 브라우저에 저장된 값이 예전 형식이거나 일부가 빠져 있어도 쓸 수 있게 채운다. */
export function readSetup(saved: unknown): RateSetup {
  const value = saved && typeof saved === "object" ? saved as Partial<RateSetup> : {};
  return { ...EMPTY_SETUP, ...value, extras: { ...EMPTY_SETUP.extras, ...value.extras } };
}

const round = (value: number) => Math.round(value * 100) / 100;
/** 값을 아는지. 아무것도 불러오거나 넣지 않았으면 기대 메소를 계산하지 않는다. */
export const setupKnown = (setup: RateSetup) => setup.origin !== "none" || Object.values(setup.extras).some(Boolean);
/**
 * 합계. 메소 획득량 = (1 + 합연산 메획) × 재물 획득의 비약 1.2 − 1, 아이템 드롭률 = 합연산 드롭 + 비약 20%.
 * 수동 값이 있으면 그 값을 쓴다. 게임 최대치(메획 300%, 드롭 500%)를 넘으면 자른다.
 */
export function rateTotals(setup: RateSetup) {
  const on = EXTRAS.filter(extra => setup.extras[extra.key]);
  const sumMeso = setup.equip.meso + setup.ability.meso + setup.phantom + setup.artifact.meso + setup.grandSymbol.meso + on.reduce((sum, extra) => sum + extra.meso, 0);
  const sumDrop = setup.equip.drop + setup.ability.drop + setup.holySymbol + setup.artifact.drop + setup.grandSymbol.drop + on.reduce((sum, extra) => sum + extra.drop, 0);
  const meso = setup.manualMeso ?? round((1 + sumMeso / 100) * POTION_MESO * 100 - 100);
  const drop = setup.manualDrop ?? sumDrop + POTION_DROP;
  return { sumMeso, sumDrop, meso: Math.min(MAX_MESO_RATE, meso), drop: Math.min(MAX_DROP_RATE, drop),
    mesoCapped: meso > MAX_MESO_RATE, dropCapped: drop > MAX_DROP_RATE };
}
/** 계산 조건에 합계와 레벨 차이 배율을 넣는다. 사냥을 시작하면 이 값이 기록에 저장된다. */
export function applyRates(plan: Plan, setup: RateSetup): Plan {
  const totals = rateTotals(setup); const known = setupKnown(setup);
  return { ...plan, formula: 2,
    mesoRate: known || setup.manualMeso != null ? totals.meso : null,
    dropRate: known || setup.manualDrop != null ? totals.drop : null,
    levelFactor: levelMesoFactor(plan.characterLevel, plan.monsterLevel) ?? 100 };
}
/** 메획이 가장 높은 프리셋, 같으면 드롭이 높은 쪽(번호). 모두 0이면 null. */
export function bestPreset(list: RatePair[] | null | undefined): number | null {
  let best: number | null = null; let top = NO_RATES;
  for (const [index, rates] of (list ?? []).entries())
    if (rates.meso > top.meso || (rates.meso === top.meso && rates.drop > top.drop)) { best = index + 1; top = rates; }
  return best;
}
const pair = (rates: RatePair | null | undefined): RatePair => ({ drop: rates?.drop ?? 0, meso: rates?.meso ?? 0 });
/**
 * 넥슨 API 값으로 채운다. 장비·어빌리티는 메획(같으면 드롭)이 가장 높은 프리셋을 고른다.
 * 사용자가 고친 설정은 force(불러오기 버튼)일 때만 덮는다. 켜고 끄는 소비 아이템·수동 값은 그대로 둔다.
 */
export function setupFromApi(info: CharacterInfo, previous: RateSetup, force: boolean): RateSetup {
  if (!force && previous.origin === "manual") return previous;
  const equipPreset = bestPreset(info.presets.equipment); const abilityPreset = bestPreset(info.presets.ability);
  return { ...previous, origin: "api",
    equipPreset, equip: pair(equipPreset ? info.presets.equipment?.[equipPreset - 1] : null),
    abilityPreset, ability: pair(abilityPreset ? info.presets.ability?.[abilityPreset - 1] : null),
    holySymbol: info.holySymbol ?? 0, phantom: info.phantom ?? 0,
    artifact: pair(info.artifact), grandSymbol: pair(info.grandSymbol),
    extras: { ...previous.extras, greed: info.className === "섀도어" } };
}
