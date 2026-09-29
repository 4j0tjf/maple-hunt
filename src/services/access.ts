import { prisma } from "@/lib/prisma";
import { requestHost, sameSiteRequest, viaPublicTunnel } from "@/lib/site";
import { readToken, tokenValid } from "./accounts";

const bearer = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
export const denied = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** 본문을 max 바이트까지만 읽는다. 믿을 수 없는 Content-Length 대신 실제 스트림 길이를 잰다. 넘으면 null. */
export async function readLimited(request: Request, max: number) {
  const reader = request.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
/** 요청에 실린 캐릭터 세션. 없거나 만료·위조면 null. */
export async function huntingCharacter(request: Request) {
  const parsed = readToken(bearer(request)); if (!parsed) return null;
  const character = await prisma.huntCharacter.findUnique({ where: { id: parsed.characterId } });
  return character && tokenValid(parsed, character.passwordHash) ? { id: character.id, name: character.name } : null;
}
export function sameSite(request: Request): Response | null {
  return sameSiteRequest(request.headers.get("origin"), requestHost(request)) ? null : denied("같은 사이트에서 요청하세요.", 403);
}
/** OCR·시세 수집 요청. 이 PC에서 열었거나 캐릭터로 로그인했으면 허용한다. */
export async function huntingAccess(request: Request): Promise<Response | null> {
  const cross = sameSite(request); if (cross) return cross;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(requestHost(request) ?? "") && !viaPublicTunnel(request.headers);
  return local || await huntingCharacter(request) ? null : denied("캐릭터 비밀번호로 로그인하세요.", 401);
}
