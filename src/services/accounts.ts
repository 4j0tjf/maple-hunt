import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
export const CHARACTER_NAME = /^[가-힣A-Za-z0-9]{2,12}$/;
export const PASSWORD = { min: 4, max: 64 };
export const SESSION_MS = 24 * 3600_000;

export async function hashPassword(password: string) {
  const salt = randomBytes(16); const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  return timingSafeEqual(await scrypt(password, Buffer.from(salt, "base64"), expected.length), expected);
}

/**
 * 세션 토큰은 캐릭터의 비밀번호 해시로 서명한다.
 * 서버에 별도 비밀키가 없어도 되고, 비밀번호를 바꾸면 기존 토큰이 모두 무효가 된다.
 */
const sign = (characterId: string, expires: number, key: string) =>
  createHmac("sha256", key).update(`${characterId}.${expires}`).digest("base64url");
export function issueToken(characterId: string, passwordHash: string, now = Date.now()) {
  const expires = now + SESSION_MS;
  return { token: `hunt.${characterId}.${expires}.${sign(characterId, expires, passwordHash)}`, expiresAt: expires };
}
export function readToken(token: string) {
  const [prefix, characterId, expires, signature, extra] = token.split(".");
  if (prefix !== "hunt" || !characterId || !/^\d{1,15}$/.test(expires ?? "") || !signature || extra !== undefined) return null;
  return { characterId, expires: Number(expires), signature };
}
export function tokenValid(parsed: NonNullable<ReturnType<typeof readToken>>, passwordHash: string, now = Date.now()) {
  if (parsed.expires <= now) return false;
  const expected = Buffer.from(sign(parsed.characterId, parsed.expires, passwordHash)); const actual = Buffer.from(parsed.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 프로세스 메모리의 시도 기록. 비밀번호 대입과 캐릭터 대량 등록을 늦춘다. */
export class Attempts {
  private log = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}
  blocked(key: string, now = Date.now()) { return this.recent(key, now).length >= this.limit; }
  add(key: string, now = Date.now()) {
    if (this.log.size > 5000) for (const [k] of this.log) if (!this.recent(k, now).length) this.log.delete(k);
    this.log.set(key, [...this.recent(key, now), now]);
  }
  clear(key: string) { this.log.delete(key); }
  private recent(key: string, now: number) { return (this.log.get(key) ?? []).filter(at => now - at < this.windowMs); }
}
