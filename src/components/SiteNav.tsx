"use client";

import { useEffect, useRef } from "react";
import { BrandMark } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";

/**
 * 시세 사이트(maple-market)와 같은 상단 메뉴.
 * 사냥 기록 외의 메뉴는 다른 서버의 페이지라 basePath가 붙는 next/link 대신 일반 링크로 이동한다.
 */
const LINKS = [
  { href: "/market", label: "시세 기록" },
  { href: "/admin", label: "수집 관리" },
  { href: "/mvp", label: "MVP작" },
  { href: "/recovery", label: "회수율 추이" },
  { href: "/hunting", label: "사냥 기록", active: true },
];

export function SiteNav() {
  const bar = useRef<HTMLDivElement>(null);
  // 휴대폰에서는 메뉴가 가로로 넘쳐 맨 끝의 '사냥 기록'이 안 보인다. 현재 메뉴가 보이게 가로 위치만 옮긴다(세로 스크롤 없음).
  useEffect(() => {
    const container = bar.current; const current = container?.querySelector<HTMLElement>("[aria-current=page]");
    if (container && current && container.scrollWidth > container.clientWidth)
      container.scrollLeft = current.offsetLeft + current.offsetWidth - container.clientWidth + 16;
  }, []);
  return (
    <nav className="sticky top-0 z-30 border-b border-line bg-surface-1/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <div ref={bar} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- "/"는 시세 사이트의 메인이다. Link는 basePath를 붙여 /hunting으로 보낸다. */}
          <a href="/" className="mr-5 flex shrink-0 items-center gap-1.5 whitespace-nowrap py-3.5 text-sm font-bold tracking-tight text-ink">
            <BrandMark className="size-[18px]" /><span className="text-accent">메라이프</span>
          </a>
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={link.active ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3.5 text-sm font-medium transition ${
                link.active ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink"
              }`}
            >
              {link.label}
            </a>
          ))}
        </div>
        <ThemeToggle />
      </div>
    </nav>
  );
}
