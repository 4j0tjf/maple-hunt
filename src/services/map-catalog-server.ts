import { readFile } from "node:fs/promises";
import path from "node:path";
import { mapCatalogSchema, type MapCatalog } from "./map-catalog";

/** public 밖에 저장하며 로그인한 사용자에게만 API로 제공한다. */
export const catalogPath = () => path.resolve(process.cwd(), "data", "hunting-maps.json");
export async function readMapCatalog(): Promise<MapCatalog> {
  try { return mapCatalogSchema.parse(JSON.parse((await readFile(catalogPath(), "utf8")).replace(/^\uFEFF/, ""))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: "미등록", maps: [] };
    throw error;
  }
}
