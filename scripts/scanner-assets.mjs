import { copyFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({ entryPoints: [path.join(root, "src/services/pixel.worker.ts")], bundle: true,
  outfile: path.join(root, "public/scanner/pixel-worker.js"), platform: "browser", format: "iife", target: "es2020", minify: true });
const target = path.join(root, "public/scanner/ocr");
await mkdir(target, { recursive: true });
await copyFile(path.join(root, "node_modules/tesseract.js/dist/worker.min.js"), path.join(target, "worker.min.js"));
const core = path.join(root, "node_modules/tesseract.js-core");
for (const file of await readdir(core)) {
  if (file.endsWith(".wasm.js")) await copyFile(path.join(core, file), path.join(target, file));
}
for (const lang of ["kor", "eng"]) {
  await copyFile(path.join(root, `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), path.join(target, `${lang}.traineddata.gz`));
}
console.log("Browser scanner assets ready (same-origin worker, WASM, Korean/English).");
