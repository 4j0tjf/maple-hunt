import { huntingAccess } from "@/services/access";
import { readQuote, requestQuote } from "@/services/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 오늘 조각 시세 저장본(시세 사이트에서 읽음). 누구나 볼 수 있다. */
export async function GET() {
  const { quote, status } = await readQuote();
  return Response.json(quote, { status, headers: { "Cache-Control": "no-store" } });
}
/** 오늘 시세 수집 요청. 경매장 검색 횟수를 쓰므로 이 PC 또는 로그인한 캐릭터만 부를 수 있다. */
export async function POST(request: Request) {
  const denied = await huntingAccess(request); if (denied) return denied;
  const body = await request.json().catch(() => null) as { retry?: unknown } | null;
  const { quote, status } = await requestQuote(body?.retry === true);
  return Response.json(quote, { status, headers: { "Cache-Control": "no-store" } });
}
