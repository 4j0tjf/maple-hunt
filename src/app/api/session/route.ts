import { prisma } from "@/lib/prisma";
import { Attempts, CHARACTER_NAME, hashPassword, issueToken, PASSWORD, verifyPassword } from "@/services/accounts";
import { denied, sameSite } from "@/services/access";
import { findOcid } from "@/services/nexon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 캐릭터별 비밀번호 실패 5회/10분, 접속 주소별 신규 등록 5회/1시간.
const failures = new Attempts(5, 10 * 60_000);
const registrations = new Attempts(5, 3600_000);

/**
 * 캐릭터 로그인. 없는 캐릭터면 404로 알려 주고, create=true로 다시 보내면 그 비밀번호로 등록한다.
 * 비밀번호 원문은 저장하지 않고 응답의 세션 토큰으로만 이후 요청을 인증한다.
 */
export async function POST(request: Request) {
  const cross = sameSite(request); if (cross) return cross;
  const body = await request.json().catch(() => null) as { name?: unknown; password?: unknown; create?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.replace(/\s/g, "") : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!CHARACTER_NAME.test(name)) return denied("캐릭터명은 한글·영문·숫자 2~12자입니다.", 400);
  if (password.length < PASSWORD.min || password.length > PASSWORD.max)
    return denied(`비밀번호는 ${PASSWORD.min}~${PASSWORD.max}자입니다.`, 400);
  if (failures.blocked(name)) return denied("비밀번호를 여러 번 틀렸습니다. 10분 뒤 다시 시도하세요.", 429);
  try {
    let character = await prisma.huntCharacter.findUnique({ where: { name } });
    if (!character) {
      if (body?.create !== true) return Response.json({ exists: false, error: "등록되지 않은 캐릭터입니다." }, { status: 404 });
      const client = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
      if (registrations.blocked(client)) return denied("등록 요청이 많습니다. 잠시 후 다시 시도하세요.", 429);
      registrations.add(client);
      // 넥슨에 없는 이름(오타·임의 이름)은 등록하지 않는다. 확인할 수 없을 때(점검·한도)도 나중에 다시 등록하게 한다.
      const key = process.env.NEXON_API_KEY;
      if (key) {
        const found = await findOcid(name, key).catch(() => undefined);
        if (found === null) return denied("넥슨에서 찾을 수 없는 캐릭터명입니다. 게임의 캐릭터명을 정확히 입력하세요.", 400);
        if (found === undefined) return denied("지금 넥슨 API로 캐릭터를 확인할 수 없습니다. 잠시 후 다시 등록하세요.", 503);
      }
      character = await prisma.huntCharacter.create({ data: { name, passwordHash: await hashPassword(password) } });
    } else if (body?.create === true) {
      return denied("이미 등록된 캐릭터입니다. 비밀번호로 로그인하세요.", 409);
    } else if (!await verifyPassword(password, character.passwordHash)) {
      failures.add(name); return denied("비밀번호가 맞지 않습니다.", 401);
    }
    failures.clear(name);
    const session = issueToken(character.id, character.passwordHash);
    return Response.json({ ...session, character: { id: character.id, name: character.name } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return denied("방금 같은 이름으로 등록되었습니다. 로그인하세요.", 409);
    return denied("기록 저장소에 연결할 수 없습니다.", 503);
  }
}
