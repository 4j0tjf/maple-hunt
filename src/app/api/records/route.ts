import { prisma } from "@/lib/prisma";
import { denied, huntingCharacter, sameSite } from "@/services/access";
import { koreaDay, type Hunt } from "@/services/domain";
import { pricesByDay } from "@/services/market";
import { huntSchema, presentRecord } from "@/services/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 로그인한 캐릭터의 사냥 기록. 기록마다 그날(사냥 시작일) 경매장 조각 평균가를 시세 사이트에서 받아 붙인다. */
export async function GET(request: Request) {
  try {
    const character = await huntingCharacter(request);
    if (!character) return denied("캐릭터 비밀번호로 로그인하세요.", 401);
    const rows = await prisma.huntRecord.findMany({ where: { characterId: character.id }, orderBy: { startedAt: "desc" }, take: 500,
      include: { _count: { select: { evidence: true } } } });
    const prices = await pricesByDay([...new Set(rows.map(row => row.day))]);
    const records = rows.map(row => presentRecord(row.data as Hunt, row.updatedAt.getTime(), prices.get(row.day) ?? null, row._count.evidence));
    return Response.json({ character, records }, { headers: { "Cache-Control": "no-store" } });
  } catch { return denied("기록 저장소에 연결할 수 없습니다.", 503); }
}

/**
 * ?id=<기록 id> 기록 1건 삭제. 증거 이미지도 함께 지워진다(DB cascade). 다른 캐릭터의 기록은 지울 수 없다.
 * 이미 없는 기록(업로드 전 기록 등)은 지운 것으로 본다.
 */
export async function DELETE(request: Request) {
  const cross = sameSite(request); if (cross) return cross;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !huntSchema.shape.id.safeParse(id).success) return denied("기록 id가 올바르지 않습니다.", 400);
  try {
    const character = await huntingCharacter(request);
    if (!character) return denied("캐릭터 비밀번호로 로그인하세요.", 401);
    const deleted = await prisma.huntRecord.deleteMany({ where: { id, characterId: character.id } });
    if (!deleted.count && await prisma.huntRecord.findUnique({ where: { id }, select: { id: true } })) return denied("다른 캐릭터의 기록입니다.", 403);
    return Response.json({ ok: true, deleted: deleted.count }, { headers: { "Cache-Control": "no-store" } });
  } catch { return denied("기록 저장소에 연결할 수 없습니다.", 503); }
}

/** 기록 1건 저장(같은 id면 덮어씀). 다른 캐릭터의 id는 받지 않는다. */
export async function PUT(request: Request) {
  const cross = sameSite(request); if (cross) return cross;
  try {
    const character = await huntingCharacter(request);
    if (!character) return denied("캐릭터 비밀번호로 로그인하세요.", 401);
    const text = await request.text();
    if (text.length > 32_000) return denied("기록이 너무 큽니다.", 413);
    const parsed = huntSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return denied("기록 형식이 올바르지 않습니다.", 400);
    const hunt = { ...parsed.data, character: character.name };
    const existing = await prisma.huntRecord.findUnique({ where: { id: hunt.id }, select: { characterId: true } });
    if (existing && existing.characterId !== character.id) return denied("다른 캐릭터의 기록입니다.", 403);
    const values = { startedAt: new Date(hunt.startedAt), day: koreaDay(hunt.startedAt), data: hunt };
    await prisma.huntRecord.upsert({ where: { id: hunt.id }, create: { id: hunt.id, characterId: character.id, ...values }, update: values });
    return Response.json({ ok: true, id: hunt.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return denied("기록 형식이 올바르지 않습니다.", 400);
    return denied("기록 저장소에 연결할 수 없습니다.", 503);
  }
}
