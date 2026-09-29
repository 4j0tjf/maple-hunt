import { z } from "zod";
import { levelMesoFactor, mapKey, MESO_PER_MONSTER_LEVEL, type Plan } from "./efficiency";

export const mapCatalogSchema = z.object({
  version: z.string().trim().min(1).max(80),
  maps: z.array(z.object({
    id: z.string().regex(/^\d{9}$/),
    name: z.string().trim().min(1).max(40),
    streetName: z.string().trim().max(80).optional(),
    mobCount: z.number().int().min(1).max(500),
    // 여러 종류가 나오면 배치 수로 가중 평균한 레벨을 사용한다.
    monsterLevel: z.number().min(1).max(300),
    monsters: z.array(z.object({
      id: z.string().regex(/^\d{7}$/), name: z.string().max(100),
      level: z.number().int().min(1).max(300), count: z.number().int().min(1).max(500),
    })).max(500).optional(),
  })).max(20000),
}).superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  for (const [index, map] of catalog.maps.entries()) {
    if (ids.has(map.id)) ctx.addIssue({ code: "custom", message: "중복 맵 ID", path: ["maps", index, "id"] });
    ids.add(map.id);
    if (map.monsters) {
      const count = map.monsters.reduce((sum, mob) => sum + mob.count, 0);
      const average = count ? map.monsters.reduce((sum, mob) => sum + mob.level * mob.count, 0) / count : 0;
      if (count !== map.mobCount || Math.abs(average - map.monsterLevel) > 0.000001)
        ctx.addIssue({ code: "custom", message: "몬스터 구성과 개수/평균 레벨 불일치", path: ["maps", index, "monsters"] });
    }
  }
});
export type MapCatalog = z.infer<typeof mapCatalogSchema>;
export type CatalogMap = MapCatalog["maps"][number];

/** OCR이 한글 한 글자를 잘못 읽은 경우(미슈피라 ↔ 이슈피라)만 같은 이름으로 본다. 숫자가 다르면 다른 사냥터다. */
function nearName(read: string, name: string) {
  if (read.length !== name.length || read.length < 4) return false;
  const diff = [...read].filter((ch, i) => ch !== name[i]);
  return diff.length <= 1 && diff.every(ch => /[가-힣]/.test(ch)) && [...name].every((ch, i) => ch === read[i] || /[가-힣]/.test(ch));
}
/**
 * 동명이거나 OCR이 일부만 읽은 사냥터는 임의로 선택하지 않는다. 같은 이름이 여럿이면 미니맵의 지역 이름으로 가른다.
 * 정확히 맞는 이름이 없을 때만 한 글자 오독을 허용한다.
 */
export function findCatalogMap(catalog: MapCatalog, name: string | null, street?: string | null): CatalogMap | null {
  if (!name) return null;
  const key = mapKey(name);
  const pick = (same: (mapName: string) => boolean) => {
    const matches = catalog.maps.filter(map => same(mapKey(map.name)) || same(mapKey(`${map.streetName ?? ""}:${map.name}`)));
    const local = street ? matches.filter(map => mapKey(map.streetName) === mapKey(street)) : [];
    return matches.length === 1 ? matches[0] : local.length === 1 ? local[0] : null;
  };
  return pick(mapName => mapName === key) ?? pick(mapName => nearName(key, mapName));
}
export function applyCatalogMap(plan: Plan, map: CatalogMap, version: string): Plan {
  return { ...plan, map: map.name, mapId: map.id, mapVersion: version,
    monsterLevel: map.monsterLevel, mobCount: map.mobCount, basis: "mobs", kills6m: null };
}

/**
 * 사냥터 검색. 검색어가 있으면 이름·지역이 맞는 곳을, 없으면 캐릭터 레벨에서 레벨 차이 배율이 100%인 곳을
 * 1젠당 기본 메소(몹 수 × 레벨 × 7.5 × 레벨 차이 배율) 순으로 보여준다. share는 목록 1위 대비 비율이다.
 */
export function searchMaps(catalog: MapCatalog, query: string, characterLevel: number | null, limit = 40) {
  const key = mapKey(query);
  const found = catalog.maps.map(map => {
    const factor = levelMesoFactor(characterLevel, map.monsterLevel) ?? 100;
    return { map, factor, spawnMeso: map.mobCount * map.monsterLevel * MESO_PER_MONSTER_LEVEL * factor / 100 };
  }).filter(item => key ? mapKey(`${item.map.streetName ?? ""}${item.map.name}`).includes(key) : characterLevel != null && item.factor === 100)
    .sort((a, b) => b.spawnMeso - a.spawnMeso || a.map.name.localeCompare(b.map.name, "ko"));
  const top = found[0]?.spawnMeso ?? 0;
  return found.slice(0, limit).map(item => ({ ...item, share: top > 0 ? item.spawnMeso / top : 0 }));
}
export type CatalogMonster = { id: string; name: string; level: number; maps: number };
/** 사냥터 목록에 나오는 몬스터(같은 ID는 하나로, 나오는 사냥터 수와 함께). */
export function catalogMonsters(catalog: MapCatalog): CatalogMonster[] {
  const byId = new Map<string, CatalogMonster>();
  for (const map of catalog.maps) for (const mob of map.monsters ?? []) {
    const found = byId.get(mob.id);
    if (found) found.maps++; else byId.set(mob.id, { id: mob.id, name: mob.name, level: mob.level, maps: 1 });
  }
  return [...byId.values()];
}
/** 몬스터 검색. 검색어가 없으면 캐릭터 레벨 ±10 안의 몬스터를 레벨 높은 순으로. */
export function searchMonsters(monsters: CatalogMonster[], query: string, characterLevel: number | null, limit = 40) {
  const key = query.replace(/\s/g, "");
  return monsters.filter(mob => key ? mob.name.replace(/\s/g, "").includes(key) : characterLevel != null && Math.abs(mob.level - characterLevel) <= 10)
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, "ko")).slice(0, limit);
}
