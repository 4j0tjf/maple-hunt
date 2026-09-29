/** Origin이 있으면 요청받은 호스트와 같아야 한다. 브라우저가 아닌 요청(Origin 없음)은 통과시킨다. */
export function sameSiteRequest(origin: string | null, host: string | null) {
  if (!origin) return true;
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
/** Cloudflare 터널을 거친 요청인지. 터널은 이 PC의 localhost로 들어오므로 호스트만으로는 외부 요청을 가릴 수 없다. */
export function viaPublicTunnel(headers: Headers) {
  return Boolean(headers.get("cf-ray") || headers.get("cf-connecting-ip"));
}
/** 요청이 보고 있는 호스트. 시세 사이트(3000)를 거쳐 들어오면 원래 호스트가 x-forwarded-host에 있다. */
export const requestHost = (request: Request) => request.headers.get("x-forwarded-host") ?? request.headers.get("host");
