import test from "node:test";
import assert from "node:assert/strict";
import { createHunt, finishHunt, koreaDay, saveHunt, type Hunt } from "../src/services/domain";
import { capOutlook, dailyMesoCap, EMPTY_PLAN, expectations, expectedMeso, filledOn, finalMesoRate, killsFor, levelMesoFactor, lossRate, mapKey, mesoBagRate,
  mesoPerKill, upgradePlan, type Plan } from "../src/services/efficiency";
import { abilityPresets, artifactRates, equipmentPresets, equipmentRates, holySymbolDrop, ratesIn, statRates, symbolRates, unionPhantom,
  type CharacterInfo } from "../src/services/nexon";
import { applyRates, bestPreset, EMPTY_SETUP, rateTotals, readSetup, setupFromApi, type RateSetup } from "../src/services/rates";
import { normalizeMap } from "../src/services/scanner";
import { huntSchema } from "../src/services/records";
import { planFrom, rememberPlan, type PlanStore } from "../src/services/client";
import { eok, hoursText } from "../src/components/ui";

// 지금 방식(formula 2): mesoRate는 재물 획득의 비약까지 곱한 최종 값이다.
const plan = (patch: Partial<Plan> = {}): Plan => ({ ...EMPTY_PLAN, characterLevel: 280, monsterLevel: 275, mesoRate: 140, mobCount: 40, ...patch });
// 예전 기록: mesoRate는 비약을 뺀 값이고 레벨 차이 배율은 저장된 값을 쓴다.
const legacy = (patch: Partial<Plan> = {}): Plan => { const { formula: _formula, ...rest } = plan({ mesoRate: 100, ...patch }); void _formula; return rest; };
const near = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

test("daily meso cap follows the level table", () => {
  assert.equal(dailyMesoCap(99), 20_000_000); assert.equal(dailyMesoCap(150), 40_000_000);
  assert.equal(dailyMesoCap(200), 80_000_000); assert.equal(dailyMesoCap(204), 80_000_000); assert.equal(dailyMesoCap(205), 85_000_000);
  assert.equal(dailyMesoCap(259), 135_000_000); assert.equal(dailyMesoCap(260), 150_000_000); assert.equal(dailyMesoCap(265), 160_000_000);
  assert.equal(dailyMesoCap(285), 200_000_000); assert.equal(dailyMesoCap(300), 230_000_000);
  for (const bad of [null, undefined, 0, 301, 250.5]) assert.equal(dailyMesoCap(bad), null);
});

test("level difference meso factor matches the in-game table", () => {
  // 캐릭터 − 몬스터 = 차이. ±10은 100%.
  const cases: [number, number, number][] = [[286, 285, 100], [285, 295, 100], [295, 285, 100], [296, 285, 98], [300, 285, 90], [300, 280, 80],
    [280, 259, 75], [290, 262, 16], [290, 261, 3], [290, 260, 0], [274, 285, 97], [270, 285, 85], [265, 285, 70], [264, 285, 65], [252, 285, 5], [251, 285, 0]];
  for (const [character, monster, factor] of cases) assert.equal(levelMesoFactor(character, monster), factor, `Lv.${character} vs Lv.${monster}`);
  assert.equal(levelMesoFactor(286, 283.5), 100, "mixed map average rounds the gap");
  assert.equal(levelMesoFactor(null, 285), null); assert.equal(levelMesoFactor(285, null), null);
});

test("meso bag drops at 60% times (1 + drop rate), certain above 67%", () => {
  assert.equal(mesoBagRate(null), 1, "unknown drop rate assumes a certain bag");
  near(mesoBagRate(0), 0.6); near(mesoBagRate(50), 0.9); near(mesoBagRate(66), 0.996);
  assert.equal(mesoBagRate(67), 1); assert.equal(mesoBagRate(500), 1);
});

test("per-kill meso applies the bag, final meso rate and level factor", () => {
  // 275 × 7.5 × (1 + 140%) = 4,950
  near(mesoPerKill(plan())!, 4950);
  near(mesoPerKill(plan({ dropRate: 0 }))!, 2970); // 주머니 60%
  near(mesoPerKill(plan({ characterLevel: 300, monsterLevel: 280 }))!, 4032); // 20레벨 높음: 80%
  near(mesoPerKill(plan({ mesoRate: 999 }))!, 8250); // 메획 최대 300%
  // 예전 기록: 비약 제외 100% → ×1.2, 저장된 레벨 차이 배율 사용
  near(finalMesoRate(legacy())!, 140);
  near(mesoPerKill(legacy())!, 4950); near(mesoPerKill(legacy({ levelFactor: 50 }))!, 2475);
  near(mesoPerKill(legacy({ dropRate: 30 }))!, 4950, 1e-6); // 예전 기록은 스탯창 드롭률과 관계없이 주머니 100%
  assert.equal(mesoPerKill(plan({ monsterLevel: null })), null); assert.equal(mesoPerKill(plan({ mesoRate: null })), null);
  // 맵 몹 40마리 × 30분(240젠) = 9,600마리
  assert.equal(killsFor(plan(), 30 * 60_000), 9600);
  assert.equal(killsFor(plan({ basis: "kills6m", kills6m: 1000 }), 30 * 60_000), 5000);
  assert.equal(killsFor(plan({ mobCount: null }), 60_000), null);
  assert.equal(killsFor(plan(), -5), 0);
});

test("the daily cap fills with base meso before meso rate and level factor", () => {
  const half = expectedMeso(plan(), 30 * 60_000)!;
  assert.equal(half.expected, 47_520_000); assert.equal(half.capped, false); assert.equal(half.base, 9600 * 2062.5);
  // 280레벨 한도 1억 9,000만 중 1억 8,000만이 찼다 → 남은 기본 메소 1,000만 / 이번 사냥 기본 메소 1,980만
  const late = expectedMeso(plan(), 30 * 60_000, 180_000_000)!;
  assert.equal(late.expected, 24_000_000); assert.equal(late.capped, true); assert.equal(late.raw, 47_520_000); assert.equal(late.base, 10_000_000);
  assert.equal(expectedMeso(plan(), 30 * 60_000, 190_000_000)!.expected, 0);
  assert.equal(expectedMeso(plan({ characterLevel: null }), 30 * 60_000, 999_999_999)!.expected, 47_520_000, "unknown level: no cap");
  assert.equal(expectedMeso(undefined, 1000), null);
});

test("loss rate is positive for shortfall and negative for surplus", () => {
  assert.equal(lossRate(100, 80), 0.2); assert.equal(lossRate(100, 120), -0.2);
  assert.equal(lossRate(null, 5), null); assert.equal(lossRate(0, 5), null); assert.equal(lossRate(100, null), null);
});

test("same-day hunts share the base-meso cap and live hunts have no loss yet", () => {
  const day = Date.parse("2026-09-23T01:00:00Z");
  // 실제 4억 3,200만 ÷ 2.4 = 기본 메소 1억 8,000만을 채웠다.
  const first: Hunt = { ...saveHunt(finishHunt(createHunt("a", "large", day, "t", "manual"), day + 2 * 3600_000, "x")), meso: 432_000_000, plan: plan() };
  const second: Hunt = { ...saveHunt(finishHunt(createHunt("b", "small", day + 3 * 3600_000, "t", "manual"), day + 3.5 * 3600_000, "x")), meso: 12_000_000, plan: plan() };
  const live: Hunt = { ...createHunt("c", "small", day + 4 * 3600_000, "t", "manual"), plan: plan() };
  const now = day + 4 * 3600_000 + 15 * 60_000;
  const result = expectations([second, live, first], now);
  // 2시간 = 40마리 × 960젠 × 4,950 = 190,080,000 (기본 메소 7,920만으로 한도 이하)
  assert.equal(result.get("a")!.expected, 190_080_000); assert.equal(result.get("a")!.capped, false);
  assert.equal(result.get("b")!.expected, 24_000_000, "1,000만 base left of the 1.9억 cap");
  assert.equal(result.get("b")!.capped, true); assert.equal(result.get("b")!.loss, 0.5);
  // 두 번째 사냥이 실제로 채운 기본 메소 500만(1,200만 ÷ 2.4) → 남은 500만 / 15분 기본 메소 990만
  assert.equal(result.get("c")!.expected, 12_000_000); assert.equal(result.get("c")!.loss, null);
  near(filledOn([first, second, live], koreaDay(day), now), 190_000_000, 1);
  assert.equal(filledOn([first, second, live], "2000-01-01", now), 0);
});

test("cap outlook reproduces the reference calculator's time to the cap", () => {
  // 참고 화면: Lv.286 · 몬스터 Lv.285 · 6분 1,920마리 · 메획 153.2% → 한도 2억까지 약 4시간 52분
  const reference = plan({ characterLevel: 286, monsterLevel: 285, basis: "kills6m", kills6m: 1920, mesoRate: 153.2, dropRate: 266 });
  const outlook = capOutlook(reference)!;
  assert.equal(outlook.cap, 200_000_000); assert.equal(hoursText(outlook.timeMs), "4시간 52분");
  assert.equal(outlook.meso, 506_400_000);
  assert.equal(expectedMeso(reference, 30 * 60_000)!.expected, 51_956_640);
  assert.equal(capOutlook(plan({ characterLevel: null })), null); assert.equal(capOutlook(plan({ mobCount: null })), null);
});

test("meso amounts read in 억·만 units", () => {
  assert.equal(eok(203_559_999), "2억 355만"); assert.equal(eok(50_880_000), "5,088만"); assert.equal(eok(200_000_000), "2억");
  assert.equal(eok(9_999), "9,999"); assert.equal(eok(null), "—");
  assert.equal(hoursText(59 * 60_000), "59분"); assert.equal(hoursText(125 * 60_000), "2시간 5분");
});

test("old records upgrade to final meso rates when edited", () => {
  const upgraded = upgradePlan(legacy({ dropRate: 50, levelFactor: 50, characterLevel: 300, monsterLevel: 280 }));
  assert.equal(upgraded.formula, 2); assert.equal(upgraded.mesoRate, 140); assert.equal(upgraded.dropRate, 70); assert.equal(upgraded.levelFactor, 80);
  const current = plan(); assert.equal(upgradePlan(current), current);
});

test("map names are normalized and keyed ignoring spacing and punctuation", () => {
  assert.equal(normalizeMap("  아르카나 : 동쪽 동굴  "), "아르카나 : 동쪽 동굴");
  // 미니맵 아이콘을 글자로 읽은 앞쪽 조각은 떼고, 사냥터를 가르는 뒤쪽 숫자는 둔다.
  assert.equal(normalizeMap("ELH] 미슈피라의 눈"), "미슈피라의 눈"); assert.equal(normalizeMap("td 2 카르시온"), "카르시온");
  assert.equal(normalizeMap("거대 산호 군락 1"), "거대 산호 군락 1");
  for (const bad of ["29:59", "Lv.285", "메 ", "", null]) assert.equal(normalizeMap(bad), null);
  assert.equal(mapKey("아르카나 : 동굴"), mapKey("아르카나:동굴"));
});

// 넥슨 Open API 응답 형식(2026-09 실제 응답에서 확인한 모양, 값은 예시).
const ITEM = (slot: string, ...options: string[]) => ({ item_equipment_slot: slot, item_name: slot, ...Object.fromEntries(options.map((option, i) => [`potential_option_${i + 1}`, option])) });
const EQUIPMENT = {
  preset_no: 1,
  item_equipment: [ITEM("반지1", "STR +12%")],
  item_equipment_preset_1: [ITEM("반지1", "STR +12%")],
  item_equipment_preset_2: [ITEM("얼굴장식", "아이템 드롭률 +20%", "아이템 드롭률 +20%"), ITEM("펜던트", "메소 획득량 +20%", "아이템 드롭률 +20%", "메소 획득량 +20%")],
  item_equipment_preset_3: [],
};
const ABILITY = {
  preset_no: 1, ability_info: [{ ability_value: "보스 몬스터 공격 시 데미지 19% 증가" }],
  ability_preset_1: { ability_info: [{ ability_value: "보스 몬스터 공격 시 데미지 19% 증가" }] },
  ability_preset_2: { ability_info: [{ ability_value: "아이템 드롭률 20% 증가" }, { ability_value: "메소 획득량 13% 증가" }, { ability_value: "STR 15 증가, INT 8 증가" }] },
  ability_preset_3: { ability_info: [{ ability_value: "버프 스킬의 지속 시간 47% 증가" }] },
};

test("Nexon responses yield meso and drop rates by source", () => {
  assert.deepEqual(statRates([{ stat_name: "메소 획득량", stat_value: "20" }, { stat_name: "아이템 드롭률", stat_value: "105.5" }, { stat_name: "STR", stat_value: "1000" }]),
    { mesoRate: 20, dropRate: 105.5 });
  assert.deepEqual(statRates(undefined), { mesoRate: null, dropRate: null });
  const equipment = equipmentRates([
    // 실제 넥슨 응답 형식(콜론 없음)과 예전 표기(콜론 있음)를 모두 받는다.
    { item_equipment_slot: "얼굴장식", item_name: "트와일라이트 마크", potential_option_1: "메소 획득량 +20%", potential_option_2: "아이템 드롭률 +20%", potential_option_3: "STR +12%" },
    { item_equipment_slot: "눈장식", item_name: "파풀라투스 마크", additional_potential_option_1: "메소 획득량 : +10%", potential_option_1: null },
    { item_equipment_slot: "반지1", item_name: "반지", potential_option_1: "LUK : +9%" },
  ]);
  assert.equal(equipment.mesoRate, 30); assert.equal(equipment.dropRate, 20); assert.equal(equipment.items.length, 2);
  assert.deepEqual(equipmentRates(null), { mesoRate: 0, dropRate: 0, items: [] });

  assert.deepEqual(equipmentPresets(EQUIPMENT).map(({ drop, meso }) => ({ drop, meso })), [{ drop: 0, meso: 0 }, { drop: 60, meso: 40 }, { drop: 0, meso: 0 }]);
  assert.deepEqual(equipmentPresets({ item_equipment: EQUIPMENT.item_equipment_preset_2 })[0].drop, 60, "no presets: current gear is preset 1");
  assert.deepEqual(abilityPresets(ABILITY), [{ drop: 0, meso: 0 }, { drop: 20, meso: 13 }, { drop: 0, meso: 0 }]);
  assert.deepEqual(abilityPresets({ ability_info: ABILITY.ability_preset_2.ability_info })[0], { drop: 20, meso: 13 }, "no presets: current ability is preset 1");
  assert.equal(unionPhantom(["경험치 획득량 10% 증가", "메소 획득량 4% 증가"]), 4); assert.equal(unionPhantom(null), 0);
  assert.deepEqual(artifactRates([{ name: "올스탯 150 증가" }, { name: "메소 획득량 4% 증가" }, { name: "아이템 드롭률 12% 증가" }]), { drop: 12, meso: 4 });
  assert.deepEqual(symbolRates([{ symbol_drop_rate: "0%", symbol_meso_rate: "0%" }, { symbol_drop_rate: "5%", symbol_meso_rate: "5%" }]), { drop: 5, meso: 5 });
  assert.equal(holySymbolDrop([{ skill_name: "쓸만한 홀리 심볼", skill_effect: "HP 100 소비, 270초 동안 획득 경험치 35%, 드롭률 24% 증가\n재사용 대기시간 180초" }]), 24);
  assert.equal(holySymbolDrop([{ skill_name: "쓸만한 홀리 파운틴", skill_effect: "..." }]), null);
  assert.deepEqual(ratesIn(["보스 몬스터 공격 시 데미지 19% 증가", null]), { drop: 0, meso: 0 });
});

const INFO: CharacterInfo = {
  name: "테스트", level: 286, className: "아크메이지(불,독)", world: "스카니아", stat: { mesoRate: 8, dropRate: 36 }, equipment: equipmentRates([]),
  presets: { equipment: [{ drop: 0, meso: 0, items: [] }, { drop: 140, meso: 40, items: [] }, { drop: 0, meso: 0, items: [] }], equipmentNow: 1,
    ability: [{ drop: 0, meso: 0 }, { drop: 20, meso: 13 }, { drop: 0, meso: 0 }], abilityNow: 1 },
  holySymbol: 24, phantom: 4, artifact: { drop: 12, meso: 4 }, grandSymbol: { drop: 0, meso: 0 }, missing: [], fetchedAt: "2026-09-25T00:00:00.000Z",
};

test("the best preset has the highest meso rate, then drop rate", () => {
  assert.equal(bestPreset([{ drop: 0, meso: 0 }, { drop: 140, meso: 40 }, { drop: 0, meso: 0 }]), 2);
  assert.equal(bestPreset([{ drop: 100, meso: 20 }, { drop: 0, meso: 20 }, { drop: 150, meso: 20 }]), 3);
  assert.equal(bestPreset([{ drop: 200, meso: 0 }, { drop: 0, meso: 20 }]), 2);
  assert.equal(bestPreset([{ drop: 0, meso: 0 }]), null); assert.equal(bestPreset(null), null);
});

test("API values fill the setup and reproduce the reference totals", () => {
  const setup = setupFromApi(INFO, EMPTY_SETUP, false);
  assert.equal(setup.origin, "api"); assert.equal(setup.equipPreset, 2); assert.equal(setup.abilityPreset, 2);
  assert.deepEqual(setup.equip, { drop: 140, meso: 40 }); assert.deepEqual(setup.ability, { drop: 20, meso: 13 });
  assert.equal(setup.holySymbol, 24); assert.equal(setup.phantom, 4); assert.equal(setup.extras.greed, false);
  // 참고 화면: 유니온의 행운·부를 켜면 드롭 266%, 메획 (1 + 111%) × 1.2 − 1 = 153.2%
  const withBuffs: RateSetup = { ...setup, extras: { ...setup.extras, unionLuck: true, unionWealth: true } };
  const totals = rateTotals(withBuffs);
  assert.equal(totals.drop, 266); assert.equal(totals.meso, 153.2); assert.equal(totals.sumMeso, 111);
  // 사용자가 고친 값은 자동 불러오기가 덮지 않고, 불러오기 버튼(force)은 덮되 켜 둔 소비 아이템은 남긴다.
  const edited: RateSetup = { ...withBuffs, origin: "manual", equip: { drop: 0, meso: 0 } };
  assert.equal(setupFromApi(INFO, edited, false), edited);
  const forced = setupFromApi(INFO, edited, true);
  assert.deepEqual(forced.equip, { drop: 140, meso: 40 }); assert.equal(forced.extras.unionWealth, true); assert.equal(forced.origin, "api");
  assert.equal(setupFromApi({ ...INFO, className: "섀도어" }, EMPTY_SETUP, false).extras.greed, true);
});

test("manual totals override the sum and game maxima cap them", () => {
  const manual = rateTotals({ ...EMPTY_SETUP, origin: "api", manualMeso: 100, manualDrop: 600 });
  assert.equal(manual.meso, 100); assert.equal(manual.drop, 500); assert.equal(manual.dropCapped, true);
  // 합연산 257% → (1 + 257%) × 1.2 − 1 = 328.4% → 300%
  const maxed = rateTotals({ ...EMPTY_SETUP, equip: { drop: 0, meso: 100 }, ability: { drop: 0, meso: 20 }, phantom: 5, artifact: { drop: 0, meso: 12 }, grandSymbol: { drop: 0, meso: 30 },
    extras: { ...EMPTY_SETUP.extras, unionWealth: true, greed: true, challengers: true } });
  assert.equal(maxed.sumMeso, 257); assert.equal(maxed.meso, 300); assert.equal(maxed.mesoCapped, true);
});

test("plans take rates only once something is known", () => {
  const base = plan({ mesoRate: null, dropRate: null, characterLevel: 300, monsterLevel: 280 });
  const empty = applyRates(base, EMPTY_SETUP);
  assert.equal(empty.mesoRate, null); assert.equal(empty.dropRate, null); assert.equal(empty.levelFactor, 80); assert.equal(empty.formula, 2);
  // 합연산 메획 61% → (1 + 61%) × 1.2 − 1 = 93.2%, 드롭 196% + 비약 20%
  const known = applyRates(base, setupFromApi(INFO, EMPTY_SETUP, false));
  assert.equal(known.mesoRate, 93.2); assert.equal(known.dropRate, 216);
  assert.equal(applyRates(base, { ...EMPTY_SETUP, manualMeso: 90 }).mesoRate, 90);
  assert.deepEqual(readSetup(undefined), EMPTY_SETUP);
  assert.equal(readSetup({ origin: "api", extras: { unionLuck: true } }).extras.unionWealth, false, "missing keys are filled");
});

test("hunt records accept a plan in range and reject typos", () => {
  const hunt = { ...createHunt(crypto.randomUUID(), "small", Date.now(), "캐릭터", "automatic"), plan: plan({ map: "아케인리버 : 츄츄" }) };
  assert.equal(huntSchema.safeParse(hunt).success, true);
  assert.equal(huntSchema.parse(hunt).plan?.formula, 2);
  assert.equal(huntSchema.safeParse({ ...hunt, plan: legacy() }).success, true, "old plans without formula");
  assert.equal(huntSchema.safeParse({ ...hunt, plan: { ...plan(), formula: 3 } }).success, false);
  assert.equal(huntSchema.safeParse({ ...hunt, plan: plan({ mobCount: 1000 }) }).success, false);
  assert.equal(huntSchema.safeParse({ ...hunt, plan: undefined }).success, true, "old records without a plan");
});

test("map presets are remembered per hunting ground and keep the rate setup", () => {
  const setup = setupFromApi(INFO, EMPTY_SETUP, false);
  let store: PlanStore = { settings: { characterLevel: null, mesoRate: null, dropRate: null, levelFactor: 100 }, maps: {}, lastMap: null, setup };
  store = rememberPlan(store, plan({ map: "아케인리버 : 츄츄", monsterLevel: 210, mobCount: 35 }));
  store = rememberPlan(store, plan({ map: "리멘", monsterLevel: 260, mobCount: 40 }));
  const back = planFrom(store, "아케인리버:츄츄");
  assert.equal(back.monsterLevel, 210); assert.equal(back.mobCount, 35); assert.equal(back.characterLevel, 280, "character settings shared");
  assert.equal(planFrom(store, null).map, "리멘", "last map by default");
  assert.equal(planFrom(store, "처음 가는 곳").monsterLevel, null);
  assert.equal(store.setup, setup);
});
