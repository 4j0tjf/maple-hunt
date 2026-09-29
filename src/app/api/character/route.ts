import { denied, huntingCharacter } from "@/services/access";
import { abilityPresets, artifactRates, equipmentPresets, equipmentRates, findOcid, holySymbolDrop, NexonError, nexonError, nexonGet, statRates, symbolRates,
  unionPhantom, type CharacterInfo } from "@/services/nexon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 캐릭터 정보는 자주 바뀌지 않고 넥슨 API는 호출 한도가 있다. 같은 캐릭터는 10분간 저장본을 쓴다.
const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; info: CharacterInfo }>();
const ocids = new Map<string, string>();
const presetNumber = (value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 3 ? value as number : null;

/**
 * 로그인한 캐릭터의 레벨과 메소 획득량·아이템 드롭률 출처별 값(장비·어빌리티 프리셋, 홀리 심볼, 유니온, 아티팩트, 심볼).
 * 기본 정보만 필수이고 나머지는 실패해도 빈 값과 missing 목록으로 돌려준다. ?refresh=1이면 저장본을 건너뛴다.
 */
export async function GET(request: Request) {
  const character = await huntingCharacter(request).catch(() => null);
  if (!character) return denied("캐릭터 비밀번호로 로그인하세요.", 401);
  const key = process.env.NEXON_API_KEY;
  if (!key) return denied("서버에 NEXON_API_KEY가 없습니다. maple-hunt/.env에 넣고 서비스를 다시 시작하세요.", 503);
  const cached = cache.get(character.name);
  if (cached && Date.now() - cached.at < TTL && new URL(request.url).searchParams.get("refresh") !== "1")
    return Response.json(cached.info, { headers: { "Cache-Control": "no-store" } });
  try {
    let ocid = ocids.get(character.name);
    if (!ocid) {
      const found = await findOcid(character.name, key);
      if (!found) return denied(nexonError("OPENAPI00004"), 404);
      ocids.set(character.name, ocid = found);
    }
    const query = `?ocid=${encodeURIComponent(ocid)}`;
    const get = <T,>(path: string) => nexonGet<T>(`${path}${path.includes("?") ? `&${query.slice(1)}` : query}`, key);
    const basic = await get<{ character_level?: number; character_class?: string; world_name?: string }>("/character/basic");
    const [stat, equipment, ability, raider, artifact, symbol, skill] = await Promise.allSettled([
      get<{ final_stat?: unknown }>("/character/stat"),
      get<Record<string, unknown>>("/character/item-equipment"),
      get<Record<string, unknown>>("/character/ability"),
      get<{ union_raider_stat?: unknown }>("/user/union-raider"),
      get<{ union_artifact_effect?: unknown }>("/user/union-artifact"),
      get<{ symbol?: unknown }>("/character/symbol-equipment"),
      get<{ character_skill?: unknown }>("/character/skill?character_skill_grade=5"),
    ]);
    const missing: string[] = [];
    const value = <T, R>(result: PromiseSettledResult<T>, label: string, read: (data: T) => R): R | null => {
      if (result.status === "fulfilled") return read(result.value);
      missing.push(label); return null;
    };
    const info: CharacterInfo = {
      name: character.name, level: Number.isInteger(basic.character_level) ? basic.character_level! : null,
      className: basic.character_class ?? null, world: basic.world_name ?? null,
      stat: value(stat, "스탯", data => statRates(data.final_stat)) ?? { mesoRate: null, dropRate: null },
      equipment: value(equipment, "장비", data => equipmentRates(data.item_equipment)) ?? equipmentRates(null),
      presets: {
        equipment: equipment.status === "fulfilled" ? equipmentPresets(equipment.value) : null,
        equipmentNow: equipment.status === "fulfilled" ? presetNumber(equipment.value.preset_no) : null,
        ability: value(ability, "어빌리티", abilityPresets),
        abilityNow: ability.status === "fulfilled" ? presetNumber(ability.value.preset_no) : null,
      },
      holySymbol: value(skill, "5차 스킬(홀리 심볼)", data => holySymbolDrop(data.character_skill)),
      phantom: value(raider, "유니온", data => unionPhantom(data.union_raider_stat)),
      artifact: value(artifact, "유니온 아티팩트", data => artifactRates(data.union_artifact_effect)),
      grandSymbol: value(symbol, "심볼", data => symbolRates(data.symbol)),
      missing, fetchedAt: new Date().toISOString(),
    };
    cache.set(character.name, { at: Date.now(), info });
    return Response.json(info, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof NexonError) {
      // ocid가 바뀌었을 수 있다(닉네임 변경 등). 다음 조회에서 다시 찾는다.
      if (error.code === "OPENAPI00004") ocids.delete(character.name);
      return denied(nexonError(error.code), error.status === 429 ? 429 : error.code === "OPENAPI00004" ? 404 : 502);
    }
    return denied("넥슨 API에 연결할 수 없습니다.", 502);
  }
}
