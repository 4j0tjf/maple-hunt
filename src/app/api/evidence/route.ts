import { prisma } from "@/lib/prisma";
import { denied, huntingCharacter, readLimited, sameSite } from "@/services/access";
import { EVIDENCE_KEEP, EVIDENCE_KINDS, imageType, type EvidenceKind } from "@/services/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 600_000;

async function ownedHunt(request: Request, huntId: string | null) {
  const character = await huntingCharacter(request);
  if (!character) return { error: denied("캐릭터 비밀번호로 로그인하세요.", 401) };
  const hunt = huntId ? await prisma.huntRecord.findUnique({ where: { id: huntId }, select: { characterId: true } }) : null;
  if (!hunt || hunt.characterId !== character.id) return { error: denied("기록을 찾을 수 없습니다.", 404) };
  return { error: null };
}

/** ?hunt=<id> 이면 증거 목록, ?hunt=<id>&id=<증거 id> 이면 그 이미지. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const { error } = await ownedHunt(request, url.searchParams.get("hunt")); if (error) return error;
    const huntId = url.searchParams.get("hunt")!; const id = url.searchParams.get("id");
    if (!id) {
      const items = await prisma.huntEvidence.findMany({ where: { huntId }, orderBy: { capturedAt: "asc" }, select: { id: true, kind: true, capturedAt: true } });
      return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
    }
    const item = await prisma.huntEvidence.findFirst({ where: { id, huntId } });
    if (!item) return denied("이미지를 찾을 수 없습니다.", 404);
    const image = new Uint8Array(item.image);
    return new Response(image, { headers: { "Content-Type": imageType(image) ?? "application/octet-stream", "Cache-Control": "private, no-store" } });
  } catch { return denied("기록 저장소에 연결할 수 없습니다.", 503); }
}

/**
 * ?hunt=<id>&kind=baseline|final|screen 으로 증거 이미지를 올린다. 종류별 최근 몇 장만 남긴다.
 * 판독 이미지는 OCR에 쓴 PNG, 종료 화면은 1280px WebP다.
 */
export async function POST(request: Request) {
  const cross = sameSite(request); if (cross) return cross;
  const url = new URL(request.url); const huntId = url.searchParams.get("hunt"); const kind = url.searchParams.get("kind") as EvidenceKind;
  if (!EVIDENCE_KINDS.includes(kind)) return denied("증거 종류가 올바르지 않습니다.", 400);
  const type = request.headers.get("content-type");
  if (type !== "image/png" && type !== "image/webp") return denied("PNG 또는 WebP만 지원합니다.", 415);
  try {
    const { error } = await ownedHunt(request, huntId); if (error) return error;
    const bytes = await readLimited(request, MAX_BYTES);
    if (!bytes) return denied("이미지가 너무 큽니다.", 413);
    if (imageType(bytes) !== type) return denied("이미지 형식이 올바르지 않습니다.", 400);
    await prisma.huntEvidence.create({ data: { huntId: huntId!, kind, image: bytes } });
    const old = await prisma.huntEvidence.findMany({ where: { huntId: huntId!, kind }, orderBy: { capturedAt: "desc" }, skip: EVIDENCE_KEEP[kind], select: { id: true } });
    if (old.length) await prisma.huntEvidence.deleteMany({ where: { id: { in: old.map(row => row.id) } } });
    return Response.json({ ok: true }, { status: 201 });
  } catch { return denied("기록 저장소에 연결할 수 없습니다.", 503); }
}
