const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
// 크기(padding·글자)는 변형마다 한 번만 준다. 같은 속성의 클래스를 덧붙이면 어느 쪽이 이길지 CSS 순서에 달려 버린다.
const buttonBody = `rounded-lg border border-line-strong bg-surface-2 font-medium hover:bg-surface-3 disabled:opacity-40 ${focus}`;
const primaryBody = `rounded-lg bg-accent font-semibold text-accent-ink hover:brightness-110 disabled:opacity-40 ${focus}`;
export const button = `${buttonBody} px-4 py-2 text-sm`;
export const smallButton = `${buttonBody} px-3 py-1.5 text-xs`;
/** 지금 눌러야 할 버튼 하나에만 쓴다(로그인, 화면 연결, 인식 재개 등). */
export const primary = `${primaryBody} px-4 py-2 text-sm`;
export const smallPrimary = `${primaryBody} px-3 py-1.5 text-sm`;
export const card = "min-w-0 rounded-2xl border border-line bg-surface-1 p-5 shadow-card";
const fieldBody = `rounded-lg border border-line-strong bg-surface-2 text-sm placeholder:text-ink-faint ${focus}`;
export const field = `${fieldBody} p-2`;
export const smallField = `${fieldBody} px-2.5 py-1.5`;
/** 값이 없으면 "—". 읽지 못한 수량을 0으로 보이지 않게 한다. */
export const number = (value: number | string | null | undefined) => value == null ? "—" : Number(value).toLocaleString("ko-KR");
/** 메소를 억·만 단위로(1억 177만, 5,088만). 만 아래는 버리고, 1만 미만이면 그대로 쓴다. */
export const eok = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const man = Math.floor(value / 10_000);
  if (man < 1) return Math.floor(value).toLocaleString("ko-KR");
  const high = Math.floor(man / 10_000); const rest = man % 10_000;
  return high ? `${high.toLocaleString("ko-KR")}억${rest ? ` ${rest.toLocaleString("ko-KR")}만` : ""}` : `${rest.toLocaleString("ko-KR")}만`;
};
/** 걸리는 시간을 "4시간 52분"으로(분 아래는 버림). */
export const hoursText = (ms: number) => {
  const minutes = Math.floor(ms / 60_000); const hours = Math.floor(minutes / 60);
  return hours ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`;
};
export const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
/** 시세 수집 상태를 사용자 문구로. 모르는 값은 그대로 보인다. */
export const QUOTE_STATUS: Record<string, string> = {
  SUCCESS: "수집 완료", PARTIAL: "일부 표본으로 수집", FAIL: "수집 실패", INTERRUPTED: "수집 중단", RUNNING: "수집 중",
  NOT_REQUESTED: "오늘 아직 조회 전", UNAVAILABLE: "시세 사이트 연결 안 됨", BUSY: "다른 수집 진행 중",
};
