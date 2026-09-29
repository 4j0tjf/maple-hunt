import "server-only";

/**
 * 솔 에르다 조각 시세는 maple-market이 수집한다.
 * 경매장 크롬 확장은 브리지 하나에만 붙고 검색 횟수도 하루 한도를 같이 쓰므로, 여기서는 수집하지 않고 물어보기만 한다.
 * 서버끼리 이 PC 안에서 부르므로 시세 사이트는 로컬 요청으로 받는다. 누가 불러도 되는지는 이쪽 라우트가 먼저 확인한다.
 */
const MARKET_URL = (process.env.MARKET_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const PRICE = `${MARKET_URL}/api/hunting/price`;

export type Quote = { status: string; average: string | null; error?: string; [key: string]: unknown };
const unavailable = (error: string): Quote => ({ status: "UNAVAILABLE", average: null, error });

/** 오늘 시세 저장본. 조회만 하며 수집을 시작하지 않는다. */
export async function readQuote(): Promise<{ quote: Quote; status: number }> {
  try {
    const response = await fetch(PRICE, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return { quote: await response.json(), status: response.status };
  } catch { return { quote: unavailable("시세 사이트에 연결할 수 없습니다."), status: 503 }; }
}
/** 오늘 첫 요청이면 수집을 시작한다. retry는 실패·중단된 날만 다시 조회한다. */
export async function requestQuote(retry: boolean): Promise<{ quote: Quote; status: number }> {
  try {
    const response = await fetch(PRICE, { method: "POST", cache: "no-store", body: JSON.stringify({ retry }),
      headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000) });
    return { quote: await response.json(), status: response.status };
  } catch { return { quote: unavailable("시세 사이트에 연결할 수 없습니다."), status: 503 }; }
}
/** 날짜별 경매장 평균가. 시세 사이트가 꺼져 있으면 모두 null로 두고 기록은 그대로 보여준다. */
export async function pricesByDay(days: string[]): Promise<Map<string, string | null>> {
  const prices = new Map<string, string | null>();
  for (let i = 0; i < days.length; i += 100) {
    try {
      const response = await fetch(`${PRICE}?days=${days.slice(i, i + 100).join(",")}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      const data = await response.json() as { prices?: Record<string, unknown> };
      for (const [day, price] of Object.entries(data.prices ?? {})) prices.set(day, typeof price === "string" && /^\d+$/.test(price) ? price : null);
    } catch { /* 시세 없이 기록만 보여준다 */ }
  }
  return prices;
}
