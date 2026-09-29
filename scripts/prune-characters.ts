/**
 * 넥슨 API에서 찾을 수 없는 캐릭터(임의 이름·오타·삭제된 캐릭터)의 등록과 사냥 기록을 정리한다.
 *
 *   npm run characters:prune             확인만 한다. 아무것도 지우지 않는다.
 *   npm run characters:prune -- --delete  찾을 수 없는 캐릭터를 logs/에 백업한 뒤 지운다(기록·증거 이미지 포함).
 *
 * 점검·호출 한도처럼 확인 자체가 안 되는 캐릭터는 지우지 않고 건너뛴다.
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { findOcid } from "../src/services/nexon";

const remove = process.argv.includes("--delete");
const key = process.env.NEXON_API_KEY ?? "";
if (!key) { console.error("NEXON_API_KEY가 없습니다. maple-hunt/.env를 확인하세요."); process.exit(1); }
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

// 이 프로젝트는 CommonJS로 변환되므로 최상위 await 대신 함수로 감싼다.
async function main() {
  try {
    const characters = await prisma.huntCharacter.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { hunts: true } } } });
    const missing: typeof characters = [];
    for (const character of characters) {
      const found = await findOcid(character.name, key).catch((error: Error) => { console.log(`?  ${character.name}: 확인 불가(${error.message}) · 건너뜀`); return undefined; });
      if (found === undefined) continue;
      console.log(`${found ? "✓" : "✗"}  ${character.name} · 기록 ${character._count.hunts}건${found ? "" : " · 넥슨에서 찾을 수 없음"}`);
      if (!found) missing.push(character);
    }
    if (!missing.length) console.log("\n정리할 캐릭터가 없습니다.");
    else if (!remove) console.log(`\n찾을 수 없는 캐릭터 ${missing.length}명. 지우려면: npm run characters:prune -- --delete`);
    else {
      const ids = missing.map(c => c.id);
      const records = await prisma.huntRecord.findMany({ where: { characterId: { in: ids } } });
      const evidence = await prisma.huntEvidence.findMany({ where: { huntId: { in: records.map(r => r.id) } } });
      const file = path.resolve("logs", `deleted-characters-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      await mkdir(path.dirname(file), { recursive: true });
      // 되돌릴 수 있게 등록 정보(비밀번호는 해시만)·기록·증거 이미지를 그대로 남긴다.
      await writeFile(file, JSON.stringify({ characters: missing, records,
        evidence: evidence.map(e => ({ ...e, image: Buffer.from(e.image).toString("base64") })) }, null, 2));
      const { count } = await prisma.huntCharacter.deleteMany({ where: { id: { in: ids } } });
      console.log(`\n${count}명 삭제(기록 ${records.length}건, 증거 이미지 ${evidence.length}장 포함). 백업: ${file}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
void main();
