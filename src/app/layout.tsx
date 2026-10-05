import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

import { SiteNav } from "@/components/SiteNav";
import { THEME_SCRIPT } from "@/lib/theme";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
/** Geist에는 한글이 없어 Noto Sans KR을 함께 싣는다. CJK는 파일이 커서 preload는 끈다. */
const notoSansKr = Noto_Sans_KR({ variable: "--font-noto-sans-kr", preload: false });

export const metadata: Metadata = {
  title: "사냥 기록 · 메라이프",
  description: "재획 사냥 시간, 획득 메소, 솔 에르다 조각을 화면 인식으로 기록한다",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme은 인라인 스크립트가 첫 페인트 전에 넣는다. 서버 HTML에는 없어서 경고를 끈다.
    <html lang="ko" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${notoSansKr.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="flex min-h-full flex-col font-sans">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
