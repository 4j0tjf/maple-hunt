import test from "node:test";
import assert from "node:assert/strict";
import { applyCatalogMap, catalogMonsters, findCatalogMap, mapCatalogSchema, searchMaps, searchMonsters } from "../src/services/map-catalog";
import { EMPTY_PLAN, expectedMeso, killsFor, SIX_MINUTES } from "../src/services/efficiency";
import { huntSchema } from "../src/services/records";
import { createHunt } from "../src/services/domain";
import { planFrom, rememberPlan, type PlanStore } from "../src/services/client";

// 실게임 값이 아닌 합성 데이터. 운영 목록에는 등록하지 않는다.
const entry = { id: "123456789", name: "테스트 사냥터", streetName: "테스트 지역", monsterLevel: 265.5, mobCount: 40 };
const catalog = { version: "test-v1", maps: [entry] };
test("catalog rejects duplicate IDs, invalid counts and missing versions", () => {
  assert.equal(mapCatalogSchema.safeParse(catalog).success, true);
  for (const bad of [{ ...catalog, maps: [entry, entry] }, { ...catalog, version: "" },
    { ...catalog, maps: [{ ...entry, mobCount: 0 }] }, { ...catalog, maps: [{ ...entry, mobCount: 1.5 }] },
    { ...catalog, maps: [{ ...entry, id: "../../secret" }] }])
    assert.equal(mapCatalogSchema.safeParse(bad).success, false);
});
test("OCR lookup requires a unique full name", () => {
  assert.equal(findCatalogMap(catalog, "테스트지역:테스트 사냥터")?.id, entry.id);
  assert.equal(findCatalogMap(catalog, "테스트 사냥터")?.id, entry.id);
  assert.equal(findCatalogMap(catalog, "사냥터"), null);
  assert.equal(findCatalogMap({ ...catalog, maps: [entry, { ...entry, id: "123456788" }] }, entry.name), null);
});
test("minimap street separates same-named maps and one misread Korean letter is forgiven", () => {
  const twins = { ...catalog, maps: [entry, { ...entry, id: "123456788", streetName: "다른 지역" }] };
  assert.equal(findCatalogMap(twins, entry.name, "다른 지역")?.id, "123456788");
  assert.equal(findCatalogMap(twins, entry.name, "모르는 곳"), null);
  // "이"를 "미"로 읽는 오독은 목록 이름으로 맞춘다.
  assert.equal(findCatalogMap(catalog, "테스트 사냥더")?.id, entry.id);
  const numbered = { ...catalog, maps: [{ ...entry, name: "산호 군락 1" }, { ...entry, id: "123456788", name: "산호 군락 3" }] };
  assert.equal(findCatalogMap(numbered, "산호 군락 2"), null, "a different number is a different map");
  assert.equal(findCatalogMap(numbered, "산호 군락 3")?.id, "123456788");
  assert.equal(findCatalogMap(catalog, "테스트 사냥"), null, "missing letters are not forgiven");
});
test("mixed monster data must agree with the count and weighted level", () => {
  const mixed = { ...entry, monsterLevel: 265.5, monsters: [
    { id: "1234567", name: "몬스터A", level: 265, count: 20 },
    { id: "1234568", name: "몬스터B", level: 266, count: 20 },
  ] };
  assert.equal(mapCatalogSchema.safeParse({ ...catalog, maps: [mixed] }).success, true);
  assert.equal(mapCatalogSchema.safeParse({ ...catalog, maps: [{ ...mixed, mobCount: 39 }] }).success, false);
  assert.equal(mapCatalogSchema.safeParse({ ...catalog, maps: [{ ...mixed, monsterLevel: 265 }] }).success, false);
});
test("catalog selection keeps character stats and snapshots formula inputs", () => {
  const plan = applyCatalogMap({ ...EMPTY_PLAN, mesoRate: 100, basis: "kills6m", kills6m: 500 }, entry, catalog.version);
  assert.equal(plan.basis, "mobs"); assert.equal(plan.kills6m, null);
  assert.equal(killsFor(plan, SIX_MINUTES), 1920);
  assert.equal(killsFor(plan, 60 * 60_000), 19200);
  const expected = expectedMeso(plan, SIX_MINUTES)!.expected;
  // 메획 100%는 비약까지 곱한 최종 값(formula 2)이다.
  assert.equal(expected, Math.round(1920 * 265.5 * 7.5 * 2));
  const parsed = huntSchema.parse({ ...createHunt(crypto.randomUUID(), "small", Date.now(), "테스트", "manual"), plan });
  assert.equal(parsed.plan?.mapVersion, "test-v1");
  assert.equal(parsed.plan?.monsterLevel, 265.5);
  applyCatalogMap(plan, { ...entry, mobCount: 50 }, "test-v2");
  assert.equal(expectedMeso(parsed.plan, SIX_MINUTES)!.expected, expected);
  const store: PlanStore = { settings: { characterLevel: null, mesoRate: null, dropRate: null, levelFactor: 100 }, maps: {}, lastMap: null };
  assert.equal(planFrom(rememberPlan(store, plan), entry.name).mapVersion, "test-v1");
});
test("map search ranks hunting grounds by base meso per spawn for the character level", () => {
  const maps = { version: "test-v1", maps: [
    { id: "100000001", name: "테스트 숲 1", streetName: "테스트 지역", monsterLevel: 280, mobCount: 40,
      monsters: [{ id: "1000001", name: "테스트 몬스터", level: 280, count: 40 }] },
    { id: "100000002", name: "테스트 숲 2", streetName: "테스트 지역", monsterLevel: 282, mobCount: 30,
      monsters: [{ id: "1000002", name: "다른 몬스터", level: 282, count: 30 }] },
    { id: "100000003", name: "먼 동굴", streetName: "다른 지역", monsterLevel: 250, mobCount: 50,
      monsters: [{ id: "1000001", name: "테스트 몬스터", level: 280, count: 25 }, { id: "1000003", name: "약한 몬스터", level: 220, count: 25 }] },
  ] };
  assert.equal(mapCatalogSchema.safeParse(maps).success, true);
  // 검색어 없음: 레벨 차이 배율 100%인 곳만, 1젠당 메소 순
  const near = searchMaps(maps, "", 285);
  assert.deepEqual(near.map(item => item.map.id), ["100000001", "100000002"]);
  assert.equal(near[0].share, 1); assert.ok(near[1].share < 1);
  assert.deepEqual(searchMaps(maps, "", null), [], "no level: nothing to suggest");
  // 검색어: 이름·지역으로 찾고, 레벨 차이 배율이 낮으면 뒤로
  const found = searchMaps(maps, "다른지역", 285);
  assert.equal(found.length, 1); assert.equal(found[0].factor, 0);
  const monsters = catalogMonsters(maps);
  assert.equal(monsters.find(mob => mob.id === "1000001")?.maps, 2);
  assert.deepEqual(searchMonsters(monsters, "", 285).map(mob => mob.id), ["1000002", "1000001"]);
  assert.deepEqual(searchMonsters(monsters, "약한", 285).map(mob => mob.level), [220]);
});
