"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import { THEME_KEY, type Theme } from "@/lib/theme";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  return () => observer.disconnect();
}

const readTheme = (): Theme | null => {
  const value = document.documentElement.getAttribute("data-theme");

  return value === "light" || value === "dark" ? value : null;
};

function storedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);

    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* 저장소를 못 쓰면 시스템 설정을 따른다 */
  }

  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 메이플로드 상단의 다크 모드 스위치와 같은 모양.
 * 손잡이 위치와 아이콘은 CSS(dark: 변형)가 <html data-theme>을 보고 정하므로
 * 서버 렌더와 첫 화면이 어긋나지 않는다. aria-checked만 마운트 뒤에 채운다.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => null);

  /**
   * 개발 모드의 Strict Mode 재마운트는 <html>의 속성을 JSX 기준으로 되돌려
   * 인라인 스크립트가 넣은 data-theme을 지운다. 비어 있을 때만 다시 채운다(운영에서는 아무 일도 하지 않는다).
   */
  useLayoutEffect(() => {
    if (!document.documentElement.hasAttribute("data-theme")) {
      document.documentElement.setAttribute("data-theme", storedTheme());
    }
  }, []);

  function toggle() {
    const next: Theme = (readTheme() ?? storedTheme()) === "dark" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", next);

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* 이번 화면에만 적용된다 */
    }
  }

  const dark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === null ? undefined : dark}
      aria-label="다크 모드"
      title={dark ? "라이트 모드로 바꾸기" : "다크 모드로 바꾸기"}
      onClick={toggle}
      className="
        relative
        inline-flex
        h-7
        w-[52px]
        shrink-0
        items-center
        rounded-full
        bg-surface-3
        ring-1
        ring-line-strong
        ring-inset
        transition-colors
        focus-visible:outline-2
        focus-visible:outline-offset-2
        focus-visible:outline-accent
        dark:bg-accent
        dark:ring-accent
      "
    >
      {/* 다크일 때 왼쪽에 달, 라이트일 때 오른쪽에 해. 손잡이가 반대편을 가린다. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="absolute left-[7px] size-3.5 fill-accent-ink opacity-0 transition-opacity dark:opacity-100"
      >
        <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z" />
      </svg>

      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="absolute right-[7px] size-3.5 fill-none stroke-ink-muted stroke-2 opacity-100 transition-opacity dark:opacity-0"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>

      <span
        aria-hidden
        className="
          absolute
          left-[3px]
          size-[22px]
          rounded-full
          bg-white
          shadow-sm
          ring-1
          ring-black/5
          transition-transform
          dark:translate-x-6
        "
      />
    </button>
  );
}
