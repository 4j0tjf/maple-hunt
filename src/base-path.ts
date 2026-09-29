/**
 * 사냥 기록은 시세 사이트와 같은 도메인의 /hunting 아래에서 열린다.
 * next.config의 basePath와 브라우저 fetch 주소가 이 값 하나를 같이 쓴다(fetch에는 basePath가 자동으로 붙지 않는다).
 */
export const BASE_PATH = "/hunting";
export const apiUrl = (path: string) => `${BASE_PATH}${path}`;
