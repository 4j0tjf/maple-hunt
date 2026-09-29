/** 임시 계정 하나로 실서버 로그인·사냥터 API를 확인하고 finally에서 해당 계정만 지운다. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/services/accounts";
import { mapCatalogSchema } from "../src/services/map-catalog";

const base = process.argv[2] ?? "http://127.0.0.1:3202/hunting";
const address = new URL(base);
if (address.hostname !== "127.0.0.1") throw new Error("이 점검은 로컬 서버에서만 실행합니다.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
async function main() {
  const name = `검증${randomBytes(4).toString("hex")}`;
  const password = randomBytes(24).toString("base64url");
  let id: string | undefined;
  const login = (body: object) => fetch(`${base}/api/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/api/maps`)).status, 401);
    assert.equal((await login({ name, password })).status, 404, "초대 목록 대신 기존 신규 등록 흐름");
    const row = await prisma.huntCharacter.create({ data: { name, passwordHash: await hashPassword(password) } }); id = row.id;
    const response = await login({ name, password }); assert.equal(response.status, 200);
    const session = await response.json();
    const maps = await fetch(`${base}/api/maps`, { headers: { Authorization: `Bearer ${session.token}` } });
    assert.equal(maps.status, 200); assert.equal(maps.headers.get("cache-control"), "no-store");
    const catalog = mapCatalogSchema.parse(await maps.json()); assert.ok(catalog.maps.length > 0);
    const sample = catalog.maps.find(map => map.id === "410000600"); assert.ok(sample); assert.equal(sample.mobCount, 34);
    console.log(`API 확인: 로그인 정상, 초대 제한 없음, 사냥터 ${catalog.maps.length}개, 세르니움 서쪽 성벽 2 = ${sample.mobCount * 48}마리/6분`);
  } finally {
    if (id) await prisma.huntCharacter.delete({ where: { id, name } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
