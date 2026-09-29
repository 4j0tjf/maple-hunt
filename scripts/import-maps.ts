/** 정규화한 위컴알 사냥터 JSON 검증/등록. 원본 WZ·MS 파일은 직접 읽지 않는다. */
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mapCatalogSchema } from "../src/services/map-catalog";
import { catalogPath } from "../src/services/map-catalog-server";

async function main() {
  const args = process.argv.slice(2);
  const source = args.find(arg => !arg.startsWith("--"));
  if (!source || args.some(arg => arg.startsWith("--") && arg !== "--apply"))
    throw new Error("사용법: npm run maps:import -- <사냥터.json> [--apply] (기본: 검증만)");
  const catalog = mapCatalogSchema.parse(JSON.parse((await readFile(path.resolve(source), "utf8")).replace(/^\uFEFF/, "")));
  if (!catalog.maps.length) throw new Error("빈 목록으로 기존 사냥터를 교체할 수 없습니다.");
  console.log(`버전 ${catalog.version} · 사냥터 ${catalog.maps.length}개 검증 완료`);
  if (!args.includes("--apply")) { console.log("등록하려면 --apply를 붙이세요."); return; }
  const destination = catalogPath();
  await mkdir(path.dirname(destination), { recursive: true });
  try { await copyFile(destination, `${destination}.${Date.now()}.bak`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(catalog, null, 2), "utf8");
  await rename(temporary, destination);
  console.log(`등록 완료: ${destination}\n사이트에서 ‘목록 새로고침’을 누르면 적용됩니다. 기존 기록은 바뀌지 않습니다.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
