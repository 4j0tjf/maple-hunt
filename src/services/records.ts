import { z } from "zod";
import { finishHunt, saveHunt, type Hunt } from "./domain";

const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const time = z.number().int().nonnegative().max(8.64e15);
const reading = z.object({ at: time, meso: amount, fragments: amount }).nullable();
const level = z.number().int().min(1).max(300).nullable();
/** 기대 메소 계산 조건. 범위를 벗어난 값은 오타로 보고 받지 않는다. */
const plan = z.object({
  map: z.string().max(40).nullable(), mapId: z.string().regex(/^\d{9}$/).optional(), mapVersion: z.string().max(80).optional(),
  characterLevel: level, monsterLevel: z.number().min(1).max(300).nullable(), basis: z.enum(["mobs", "kills6m"]),
  mobCount: z.number().int().min(1).max(500).nullable(), kills6m: z.number().int().min(1).max(100_000).nullable(),
  mesoRate: z.number().min(0).max(1000).nullable(), dropRate: z.number().min(0).max(2000).nullable(),
  levelFactor: z.number().min(0).max(300), source: z.enum(["api", "manual"]).optional(),
  // 2: 최종 메소 획득량(비약 포함)으로 계산하는 방식. 없으면 예전 기록(비약 제외 값)이다.
  formula: z.literal(2).optional(),
});
/** 브라우저가 올리는 Hunt. 서버는 값의 출처를 알 수 없으므로 형식과 범위만 확인한다. */
export const huntSchema = z.object({
  id: z.uuid(), character: z.string().max(12).nullable(), startedAt: time, endedAt: time.nullable(), expiresAt: time,
  potion: z.enum(["small", "large"]), small: z.number().int().min(0).max(1000), large: z.number().int().min(0).max(1000),
  baseline: reading, final: reading, meso: amount, fragments: amount,
  status: z.enum(["hunting", "finishing", "saved"]), reason: z.string().max(200).nullable(),
  source: z.enum(["automatic", "manual"]), recordingId: z.string().max(64).nullable(),
  manual: z.array(z.enum(["baseline.meso", "baseline.fragments", "final.meso", "final.fragments"])).max(4).optional(),
  manualPrice: z.string().regex(/^[1-9]\d{0,14}$/).nullable().optional(),
  plan: plan.optional(),
});

/** baseline·final은 지정 영역만 이어 붙인 판독 이미지, screen은 종료 수량을 확인한 순간의 전체 화면이다. */
export const EVIDENCE_KINDS = ["baseline", "final", "screen"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** 종류별로 남길 최근 장수. 종료 화면은 마지막으로 확인한 순간 1장이면 된다. */
export const EVIDENCE_KEEP: Record<EvidenceKind, number> = { baseline: 3, final: 3, screen: 1 };
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
/** 올라온 이미지의 실제 형식. 판독 이미지는 PNG, 화면은 WebP다. 그 밖의 바이트는 받지 않는다. */
export function imageType(bytes: Uint8Array): "image/png" | "image/webp" | null {
  if (bytes.length >= 24 && PNG.every((byte, i) => bytes[i] === byte)) return "image/png";
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return null;
}
/** 이 시간 동안 갱신이 없는 진행 중 기록은 브라우저가 닫힌 것으로 본다. */
export const STALE_MS = 10 * 60_000;

/**
 * 저장된 기록을 보여줄 모양으로 바꾼다.
 * 진행 중인 채로 오래 멈춘 기록은 마지막 갱신 시각에 끝난 중단 기록으로 보여준다(저장본은 그대로 둔다).
 */
export function presentRecord(data: Hunt, updatedAt: number, auctionPrice: string | null, evidence: number, now = Date.now()) {
  const stale = data.status !== "saved" && now - updatedAt > STALE_MS;
  const hunt = stale ? saveHunt(finishHunt(data, updatedAt, "기록 중단")) : data;
  return { ...hunt, auctionPrice, evidence };
}
