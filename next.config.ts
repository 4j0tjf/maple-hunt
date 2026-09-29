import type { NextConfig } from "next";
import { BASE_PATH } from "./src/base-path";

const nextConfig: NextConfig = {
  // 운영 서버를 멈추지 않고 별도 폴더에서 빌드 검증할 때만 사용한다.
  distDir: process.env.HUNT_BUILD_DIR || ".next",
  /**
   * 시세 사이트와 같은 도메인의 /hunting 아래에서 연다.
   * 외부 요청은 Cloudflare 터널이, 이 PC의 localhost:3000 요청은 시세 사이트의 rewrite가 이 서버(3200)로 넘긴다.
   * 화면·API·정적 파일(_next)이 모두 /hunting 아래에 있어야 시세 사이트의 경로와 섞이지 않는다.
   */
  basePath: BASE_PATH,
  /** next dev는 localhost 외 origin의 dev 전용 asset 요청을 막는다. 시세 사이트와 같은 목록을 둔다. */
  allowedDevOrigins: ["127.0.0.1", "192.168.0.37"],
};

export default nextConfig;
