import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // public/scanner/ocr는 tesseract.js 배포 파일 복사본이라 이 프로젝트 소스가 아니다.
  globalIgnores([".next/**", ".next-check/**", ".next-releases/**", ".next-release-*/**", "data/**", "out/**", "build/**", "logs/**", "next-env.d.ts", "src/generated/**", "public/scanner/ocr/**", "public/scanner/pixel-worker.js"]),
]);

export default eslintConfig;
