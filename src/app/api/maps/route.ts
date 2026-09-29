import { denied, huntingCharacter } from "@/services/access";
import { readMapCatalog } from "@/services/map-catalog-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    if (!await huntingCharacter(request)) return denied("캐릭터 비밀번호로 로그인하세요.", 401);
    return Response.json(await readMapCatalog(), { headers: { "Cache-Control": "no-store" } });
  } catch { return denied("사냥터 데이터를 불러오지 못했습니다.", 503); }
}
