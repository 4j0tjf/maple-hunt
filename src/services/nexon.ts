/**
 * 넥슨 Open API(메이플스토리) 응답 해석. 호출은 서버 라우트(/api/character)에서만 한다.
 * - ocid:     GET /maplestory/v1/id?character_name=
 * - 기본:     GET /character/basic?ocid=            → character_level, character_class
 * - 스탯:     GET /character/stat?ocid=             → final_stat[{ stat_name, stat_value }]
 * - 장비:     GET /character/item-equipment?ocid=   → item_equipment_preset_1..3[].potential_option_1..3, additional_potential_option_1..3
 * - 어빌리티: GET /character/ability?ocid=          → ability_preset_1..3.ability_info[].ability_value ("메소 획득량 13% 증가")
 * - 유니온:   GET /user/union-raider?ocid=          → union_raider_stat ("메소 획득량 4% 증가" = 팬텀 공격대원 효과)
 * - 아티팩트: GET /user/union-artifact?ocid=        → union_artifact_effect[].name
 * - 심볼:     GET /character/symbol-equipment?ocid= → symbol[].symbol_drop_rate, symbol_meso_rate (그랜드 어센틱심볼만 값이 있다)
 * - 5차 스킬: GET /character/skill?ocid=&character_skill_grade=5 → 쓸만한 홀리 심볼의 skill_effect ("드롭률 24% 증가")
 */
export const NEXON_BASE = "https://open.api.nexon.com/maplestory/v1";

/** 초당 호출 수. 개발 단계 키의 한도(초당 5회)에 맞춘다. 서버 전체가 같이 쓴다. */
const PER_SECOND = 5;
const started: number[] = [];
async function slot() {
  for (;;) {
    const now = Date.now();
    while (started.length && now - started[0] >= 1000) started.shift();
    if (started.length < PER_SECOND) { started.push(now); return; }
    await new Promise(resolve => setTimeout(resolve, 1000 - (now - started[0]) + 5));
  }
}

export class NexonError extends Error { constructor(readonly code: string | undefined, readonly status: number) { super(code ?? String(status)); } }
export async function nexonGet<T>(path: string, key: string): Promise<T> {
  await slot();
  const response = await fetch(`${NEXON_BASE}${path}`, { headers: { "x-nxopen-api-key": key }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  const data = await response.json().catch(() => null) as { error?: { name?: string } } | null;
  if (!response.ok) throw new NexonError(data?.error?.name, response.status);
  return data as T;
}
/** 캐릭터명으로 ocid를 찾는다. 넥슨에 없는 이름(OPENAPI00004)이면 null, 그 밖의 오류(점검·한도·키)는 던진다. */
export async function findOcid(name: string, key: string): Promise<string | null> {
  try { return (await nexonGet<{ ocid: string }>(`/id?character_name=${encodeURIComponent(name)}`, key)).ocid; }
  catch (error) { if (error instanceof NexonError && error.code === "OPENAPI00004") return null; throw error; }
}

type FinalStat = { stat_name?: unknown; stat_value?: unknown };
const percent = (value: unknown) => {
  const number = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(number) && String(value ?? "").trim() !== "" ? number : null;
};
/** 스탯창 값. 메소 획득량·아이템 드롭률이 없으면 null(응답 형식이 바뀐 것). */
export function statRates(finalStat: unknown) {
  const list = Array.isArray(finalStat) ? finalStat as FinalStat[] : [];
  const find = (name: string) => percent(list.find(stat => stat?.stat_name === name)?.stat_value);
  return { mesoRate: find("메소 획득량"), dropRate: find("아이템 드롭률") };
}

export type RatePair = { drop: number; meso: number };
/**
 * 문장 안의 메소 획득량·아이템 드롭률. 잠재능력 "메소 획득량 +20%"(예전 표기 "메소 획득량 : +20%"),
 * 어빌리티·유니온·아티팩트 "아이템 드롭률 20% 증가"를 모두 받는다.
 */
const RATE_TEXT = /(메소 획득량|아이템 드롭률)\s*:?\s*\+?\s*(\d+(?:\.\d+)?)\s*%/g;
export function ratesIn(texts: unknown[]): RatePair {
  let drop = 0, meso = 0;
  for (const text of texts) for (const match of String(text ?? "").matchAll(RATE_TEXT)) {
    if (match[1] === "메소 획득량") meso += Number(match[2]); else drop += Number(match[2]);
  }
  return { drop, meso };
}

type Equipment = Record<string, unknown>;
const OPTION_KEYS = ["potential_option_1", "potential_option_2", "potential_option_3",
  "additional_potential_option_1", "additional_potential_option_2", "additional_potential_option_3"];
/** 장비 잠재능력·에디셔널 잠재능력의 메소 획득량·아이템 드롭률 합계와 부위별 내역. */
export function equipmentRates(items: unknown) {
  const rows: { slot: string; name: string; meso: number; drop: number }[] = [];
  for (const item of Array.isArray(items) ? items as Equipment[] : []) {
    const { meso, drop } = ratesIn(OPTION_KEYS.map(key => item?.[key]));
    if (meso || drop) rows.push({ slot: String(item?.item_equipment_slot ?? ""), name: String(item?.item_name ?? ""), meso, drop });
  }
  return { mesoRate: rows.reduce((sum, row) => sum + row.meso, 0), dropRate: rows.reduce((sum, row) => sum + row.drop, 0), items: rows };
}
export type EquipmentPreset = RatePair & { items: ReturnType<typeof equipmentRates>["items"] };
/** 장비 프리셋 1~3. 프리셋 목록이 없으면(프리셋을 안 쓰는 응답) 지금 착용 장비를 1번으로 본다. */
export function equipmentPresets(data: Record<string, unknown>): EquipmentPreset[] {
  const presets = [1, 2, 3].map(n => data[`item_equipment_preset_${n}`]);
  if (presets.every(items => !Array.isArray(items) || !items.length)) presets[0] = data.item_equipment;
  return presets.map(items => { const rates = equipmentRates(items); return { drop: rates.dropRate, meso: rates.mesoRate, items: rates.items }; });
}
/** 어빌리티 프리셋 1~3. 프리셋이 없으면 지금 어빌리티를 1번으로 본다. */
export function abilityPresets(data: Record<string, unknown>): RatePair[] {
  const lines = (preset: unknown) => {
    const info = (preset as { ability_info?: unknown } | null)?.ability_info;
    return Array.isArray(info) ? info.map(line => (line as { ability_value?: unknown })?.ability_value) : [];
  };
  const presets = [1, 2, 3].map(n => lines(data[`ability_preset_${n}`]));
  if (presets.every(list => !list.length) && Array.isArray(data.ability_info)) presets[0] = lines({ ability_info: data.ability_info });
  return presets.map(ratesIn);
}
/** 유니온 공격대원 효과의 메소 획득량(팬텀 등급: B 1% ~ SSS 5%). 없으면 0. */
export function unionPhantom(raiderStat: unknown): number {
  return Math.min(5, ratesIn(Array.isArray(raiderStat) ? raiderStat : []).meso);
}
/** 유니온 아티팩트 효과의 메소 획득량·아이템 드롭률. */
export function artifactRates(effects: unknown): RatePair {
  return ratesIn(Array.isArray(effects) ? effects.map(effect => (effect as { name?: unknown })?.name) : []);
}
/** 그랜드 어센틱심볼의 메소 획득량·아이템 드롭률 합계. 다른 심볼은 0%다. */
export function symbolRates(symbols: unknown): RatePair {
  let drop = 0, meso = 0;
  for (const symbol of Array.isArray(symbols) ? symbols as Record<string, unknown>[] : []) {
    drop += percent(symbol?.symbol_drop_rate) ?? 0; meso += percent(symbol?.symbol_meso_rate) ?? 0;
  }
  return { drop, meso };
}
/** 쓸만한 홀리 심볼의 아이템 드롭률 증가량(스킬 레벨에 따라 다르다). 스킬이 없으면 null. */
export function holySymbolDrop(skills: unknown): number | null {
  const skill = (Array.isArray(skills) ? skills as Record<string, unknown>[] : []).find(item => item?.skill_name === "쓸만한 홀리 심볼");
  const match = String(skill?.skill_effect ?? "").match(/드롭률\s*(\d+(?:\.\d+)?)\s*%\s*증가/);
  return match ? Number(match[1]) : null;
}

export type CharacterInfo = {
  name: string; level: number | null; className: string | null; world: string | null;
  /** 스탯창 값(조회 시점의 버프 포함 여부가 분명하지 않아 참고용). */
  stat: { mesoRate: number | null; dropRate: number | null };
  /** 지금 착용 장비의 잠재능력 내역. */
  equipment: ReturnType<typeof equipmentRates>;
  /** 장비·어빌리티 프리셋 1~3의 값과 지금 쓰는 프리셋 번호. 불러오지 못했으면 null. */
  presets: { equipment: EquipmentPreset[] | null; equipmentNow: number | null; ability: RatePair[] | null; abilityNow: number | null };
  holySymbol: number | null; phantom: number | null; artifact: RatePair | null; grandSymbol: RatePair | null;
  /** 넥슨 API에서 불러오지 못한 항목. 해당 값은 null이고 직접 넣을 수 있다. */
  missing: string[];
  fetchedAt: string;
};
/** 넥슨 오류 코드를 사용자 문구로. */
export function nexonError(code: string | undefined) {
  switch (code) {
    case "OPENAPI00001": return "넥슨 API 서버 오류입니다. 잠시 후 다시 시도하세요.";
    case "OPENAPI00002": case "OPENAPI00005": return "넥슨 API 키가 올바르지 않거나 권한이 없습니다. maple-hunt/.env의 NEXON_API_KEY를 확인하세요.";
    case "OPENAPI00004": return "캐릭터를 찾지 못했습니다. 로그인한 캐릭터명이 게임 캐릭터명과 같은지 확인하세요.";
    case "OPENAPI00007": return "넥슨 API 호출 한도를 넘었습니다. 잠시 후 다시 시도하세요.";
    case "OPENAPI00009": return "넥슨 API 데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.";
    case "OPENAPI00010": case "OPENAPI00011": return "게임 점검 중이라 캐릭터 정보를 가져올 수 없습니다.";
    default: return "캐릭터 정보를 가져오지 못했습니다.";
  }
}
