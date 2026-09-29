/**
 * 라이트/다크 테마.
 *
 * maple-market/src/lib/theme.ts의 복사본이다. 선택은 localStorage "theme"에 둔다.
 * 시세(/)·MVP작(/mvp)도 같은 도메인에서 같은 키를 읽으므로 한 곳에서 바꾸면 모든 화면이 따라간다.
 * 저장된 선택이 없으면 시스템 설정을 따른다.
 */
export const THEME_KEY = "theme";

export type Theme = "light" | "dark";

/**
 * 첫 페인트 전에 <html data-theme>을 채우는 인라인 스크립트.
 * 저장소를 못 읽는 환경(사생활 보호 모드 등)에서도 시스템 설정으로 정한다.
 */
export const THEME_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)})()`;
