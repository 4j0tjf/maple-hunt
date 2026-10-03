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
  title: "사냥 기록 · 스마트 메라이프",
  description: "재획 사냥 시간, 획득 메소, 솔 에르다 조각을 화면 인식으로 기록한다",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme은 인라인 스크립트가 첫 페인트 전에 넣는다. 서버 HTML에는 없어서 경고를 끈다.
    <html lang="ko" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${notoSansKr.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="flex min-h-full flex-col font-sans">
        <SiteNav />
        {/* 사냥 기록은 스케줄러로 옮겼다. 기존 화면은 당분간 그대로 두고, 새 화면으로 안내만 한다. */}
        <p role="note" className="mx-auto mt-4 w-full max-w-[1400px] px-4 text-sm sm:px-6 lg:px-8">
          <span className="block rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-ink">
            사냥 기록은 이제 <b>스케줄러</b>의 사냥 기록 탭에서 계정으로 로그인해 씁니다. 이 화면의 기록은 스케줄러의 ‘기존 사냥 기록 가져오기’로 옮길 수 있습니다.{" "}
            <a href="/scheduler#hunting" className="font-semibold text-accent underline underline-offset-2">스케줄러로 이동</a>
          </span>
        </p>
        {children}
      </body>
    </html>
  );
}
