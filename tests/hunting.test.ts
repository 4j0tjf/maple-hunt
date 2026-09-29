import test from "node:test";
import assert from "node:assert/strict";
import { addPotion, createHunt, DURATION, fillMissing, noteInventory, NOTHING_SEEN, PRE_START_MS, withPreStart, finishHunt, fragmentValue, koreaDay, observeInventory, parseCount, parseMeso, parseTimer, potionFromTimer, PotionDetector, saveHunt, StableValue } from "../src/services/domain";
import { Attempts, hashPassword, issueToken, readToken, SESSION_MS, tokenValid, verifyPassword } from "../src/services/accounts";
import { EVIDENCE_KEEP, EVIDENCE_KINDS, huntSchema, imageType, presentRecord, STALE_MS } from "../src/services/records";
import { findTemplate, pixelSignature } from "../src/services/browser";

test("icon matcher finds an icon shifted by an odd number of pixels and rejects unrelated images", () => {
  const icon = new Uint8ClampedArray(12 * 12 * 4);
  for (let i = 0; i < icon.length; i++) icon[i] = i % 4 === 3 ? 255 : (i * 73 + 57) % 256;
  const image = { width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4) };
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const i = (y * 12 + x) * 4; image.data.set(icon.subarray(i, i + 4), ((y + 7) * 40 + x + 5) * 4);
  }
  const template = { x: 0, y: 0, w: 12, h: 12, pixels: pixelSignature({ width: 12, height: 12, data: icon }) };
  const area = { x: 100, y: 20, w: 40, h: 30 };
  const match = findTemplate(image, template, area);
  assert.equal(match?.x, 105); assert.equal(match?.y, 27);
  image.data.fill(0); assert.equal(findTemplate(image, template, area), null);
});

test("inventory never opened produces null, not zero", () => {
  const hunt = saveHunt(finishHunt(createHunt("1", "small", 0, "캐릭터", "automatic"), DURATION.small, "expired"));
  assert.equal(hunt.meso, null); assert.equal(hunt.fragments, null);
  assert.equal(hunt.endedAt, 1800000); assert.equal(hunt.small, 1); assert.equal(hunt.large, 0);
});
test("late baseline rejected, final alone cannot manufacture gains", () => {
  let hunt = createHunt("1", "large", 0, null, "automatic");
  hunt = observeInventory(hunt, { at: 31000, meso: 100, fragments: 2 });
  assert.equal(hunt.baseline, null);
  hunt = finishHunt(hunt, 90000, "stop");
  hunt = observeInventory(hunt, { at: 95000, meso: 200, fragments: 4 });
  assert.equal(saveHunt(hunt).meso, null);
});
test("partial fields remain null; confirmed zero is zero; earlier end readings ignored", () => {
  let hunt = createHunt("1", "small", 0, "test", "manual");
  hunt = observeInventory(hunt, { at: 1000, meso: 1000, fragments: null });
  hunt = observeInventory(hunt, { at: 2000, meso: 1100, fragments: 10 });
  assert.equal(hunt.baseline?.meso, 1000);
  hunt = observeInventory(hunt, { at: 50000, meso: 2000, fragments: 20 });
  hunt = finishHunt(hunt, 60000, "stop");
  assert.equal(hunt.final, null);
  hunt = observeInventory(hunt, { at: 61000, meso: null, fragments: 10 });
  hunt = saveHunt(hunt);
  assert.equal(hunt.fragments, 0); assert.equal(hunt.meso, null);
});
test("separate ending reads merge, balance decrease remains unknown", () => {
  let hunt = observeInventory(createHunt("1", "small", 0, "test", "manual"), { at: 1000, meso: 1000, fragments: 5 });
  hunt = finishHunt(hunt, 60000, "stop");
  hunt = observeInventory(hunt, { at: 61000, meso: 900, fragments: null });
  hunt = observeInventory(hunt, { at: 62000, meso: null, fragments: 8 });
  assert.equal(saveHunt(hunt).meso, null); assert.equal(saveHunt(hunt).fragments, 3);
  assert.deepEqual(observeInventory(hunt, { at: 121000, meso: 3000, fragments: 20 }), hunt);
});
test("potion re-use increments correct type and expiry without resetting hunting time", () => {
  const h = addPotion(createHunt("1", "small", 1000, "test", "automatic"), "large", 90000);
  assert.equal(h.startedAt, 1000); assert.equal(h.small, 1); assert.equal(h.large, 1);
  assert.equal(h.expiresAt, 7290000);
  assert.deepEqual(addPotion(finishHunt(h, 95000, "stop"), "small", 96000), finishHunt(h, 95000, "stop"));
});
test("strict number and timer parsing reject common OCR corruption", () => {
  assert.equal(parseCount("1,234,567"), 1234567); assert.equal(parseCount("0"), 0);
  for (const x of ["", "1O0", "1,23", "-10", "1.2", "123 메소", "9007199254740992"]) assert.equal(parseCount(x), null);
  // 인벤토리 메소 표시는 억·만 단위다. 단위를 숫자로 잘못 읽은 값("74517 5280")은 이어 붙이지 않는다.
  assert.equal(parseMeso("7451만 5280"), 74_515_280); assert.equal(parseMeso("7451 만 5280"), 74_515_280);
  assert.equal(parseMeso("12억 3456만 7890"), 1_234_567_890); assert.equal(parseMeso("3억"), 300_000_000);
  assert.equal(parseMeso("5280"), 5280); assert.equal(parseMeso("74,515,280"), 74_515_280);
  for (const x of ["74517 5280", "7451만 52800", "", "만", "7451만 5280 메소"]) assert.equal(parseMeso(x), null);
  assert.equal(parseTimer("1:59:59"), 7199000); assert.equal(parseTimer("29분 58초"), 1798000);
  assert.equal(parseTimer("29:99"), null);
});
test("stable OCR needs two consecutive readings and resets on invisible inventory", () => {
  const s = new StableValue<number>(); assert.equal(s.read(10), null); assert.equal(s.read(10), 10);
  assert.equal(s.read(null), null); assert.equal(s.read(10), null); assert.equal(s.read(11), null);
});
test("new potion needs absent buff then two full timer readings; repeated frames count once", () => {
  const d = new PotionDetector(); d.read(false, null, 0); d.read(false, null, 2500);
  assert.equal(d.read(true, 1799000, 5000), null); assert.equal(d.read(true, 1796000, 8000), "small");
  assert.equal(d.read(true, 1793000, 11000), null);
});
test("starting mid-buff and large buff crossing 30 minutes do not count as usage", () => {
  const d = new PotionDetector();
  assert.equal(d.read(true, 7199000, 0), null); assert.equal(d.read(true, 7196000, 3000), null);
  d.read(true, 1810000, 5389000); d.read(false, null, 5390000); d.read(false, null, 5393000);
  assert.equal(d.read(true, 1799000, 5400000), null); assert.equal(d.read(true, 1796000, 5403000), null);
});
test("timer refresh near full counts a second use once", () => {
  const d = new PotionDetector(); d.read(false, null, 0); d.read(false, null, 2500);
  d.read(true, 1799000, 5000); d.read(true, 1796000, 8000); d.read(true, 500000, 1304000);
  assert.equal(d.read(true, 1799000, 1306000), null); assert.equal(d.read(true, 1796000, 1309000), "small");
  assert.equal(d.read(true, 1793000, 1312000), null);
});
test("Korean day boundary is midnight KST", () => {
  assert.equal(koreaDay(Date.parse("2026-09-22T14:59:59Z")), "2026-09-22"); assert.equal(koreaDay(Date.parse("2026-09-22T15:00:00Z")), "2026-09-23");
});

test("manual fill only touches unrecorded values and never lets later OCR overwrite it", () => {
  let hunt = observeInventory(createHunt("1", "small", 0, "test", "automatic"), { at: 1000, meso: 1000, fragments: null });
  hunt = fillMissing(hunt, "baseline", "fragments", 0);
  assert.deepEqual([hunt.baseline?.meso, hunt.baseline?.fragments], [1000, 0]);
  assert.equal(fillMissing(hunt, "baseline", "meso", 5), hunt, "recorded value is not replaced");
  assert.equal(fillMissing(hunt, "final", "meso", 5), hunt, "end value waits for the end");
  hunt = finishHunt(hunt, 60000, "stop");
  hunt = fillMissing(hunt, "final", "fragments", 7);
  hunt = observeInventory(hunt, { at: 62000, meso: 1500, fragments: 99 });
  assert.equal(hunt.final?.fragments, 7); assert.equal(hunt.final?.meso, 1500);
  assert.deepEqual(hunt.manual, ["baseline.fragments", "final.fragments"]);
  const saved = saveHunt(hunt); assert.equal(saved.meso, 500); assert.equal(saved.fragments, 7);
  assert.equal(fillMissing(saved, "final", "meso", 1), saved);
  assert.equal(fillMissing(saveHunt(finishHunt(createHunt("2", "small", 0, null, "manual"), 10, "x")), "final", "meso", -1).final, null);
});
test("saved record with nothing read can be completed by hand afterwards", () => {
  let hunt = saveHunt(finishHunt(createHunt("1", "large", 0, "test", "automatic"), DURATION.large, "비약 종료"));
  for (const [side, key, value] of [["baseline", "meso", 100], ["final", "meso", 350], ["baseline", "fragments", 3], ["final", "fragments", 3]] as const)
    hunt = fillMissing(hunt, side, key, value);
  assert.equal(hunt.meso, 250); assert.equal(hunt.fragments, 0); assert.equal(hunt.status, "saved");
});
test("minutes+seconds buff display over an hour and fragment value", () => {
  assert.equal(parseTimer("119:59"), 7199000); assert.equal(potionFromTimer(parseTimer("119:59")), "large");
  assert.equal(parseTimer("119분 59초"), 7199000); assert.equal(parseTimer("1:59:59"), 7199000);
  assert.equal(parseTimer("1:60:00"), null); assert.equal(parseTimer("1:119:59"), null);
  assert.equal(fragmentValue(12, "9500000"), "114000000"); assert.equal(fragmentValue(0, "9500000"), "0");
  assert.equal(fragmentValue(null, "9500000"), null); assert.equal(fragmentValue(3, null), null); assert.equal(fragmentValue(3, "9.5"), null);
});
test("character passwords are salted hashes and session tokens are bound to them", async () => {
  const hash = await hashPassword("secret-1"); const other = await hashPassword("secret-1");
  assert.notEqual(hash, other); assert.ok(!hash.includes("secret-1"));
  assert.equal(await verifyPassword("secret-1", hash), true); assert.equal(await verifyPassword("secret-2", hash), false);
  assert.equal(await verifyPassword("secret-1", "plain"), false);
  const { token, expiresAt } = issueToken("char-id", hash, 1000);
  const parsed = readToken(token)!;
  assert.equal(parsed.characterId, "char-id"); assert.equal(expiresAt, 1000 + SESSION_MS);
  assert.equal(tokenValid(parsed, hash, 2000), true);
  assert.equal(tokenValid(parsed, other, 2000), false, "a changed password invalidates old sessions");
  assert.equal(tokenValid(parsed, hash, expiresAt), false, "expired");
  assert.equal(tokenValid({ ...parsed, characterId: "someone-else" }, hash, 2000), false, "tampered id");
  for (const bad of ["", "hunt.a.b.c", `${token}.x`, token.replace("hunt.", "admin.")]) assert.equal(readToken(bad), null, bad);
});
test("attempt limiter blocks within the window and forgets afterwards", () => {
  const attempts = new Attempts(2, 1000);
  attempts.add("a", 0); assert.equal(attempts.blocked("a", 10), false);
  attempts.add("a", 10); assert.equal(attempts.blocked("a", 20), true); assert.equal(attempts.blocked("b", 20), false);
  assert.equal(attempts.blocked("a", 1011), false); attempts.add("a", 1500); attempts.clear("a"); assert.equal(attempts.blocked("a", 1600), false);
});
test("record schema accepts real hunts and rejects malformed ones", () => {
  const hunt = saveHunt(fillMissing(finishHunt(createHunt(crypto.randomUUID(), "small", Date.now(), "캐릭터", "automatic"), Date.now() + 1000, "stop"), "final", "meso", 5));
  assert.equal(huntSchema.safeParse({ ...hunt, manualPrice: "9500000" }).success, true);
  assert.equal(huntSchema.safeParse({ ...hunt, id: "1" }).success, false);
  assert.equal(huntSchema.safeParse({ ...hunt, meso: -5 }).success, false);
  assert.equal(huntSchema.safeParse({ ...hunt, manualPrice: "0" }).success, false);
  assert.equal(huntSchema.safeParse({ ...hunt, manual: ["meso"] }).success, false);
  const stripped = huntSchema.parse({ ...hunt, auctionPrice: "1", pending: true }) as Record<string, unknown>;
  assert.equal("auctionPrice" in stripped || "pending" in stripped, false);
});
test("server shows an abandoned in-progress hunt as interrupted", () => {
  const hunt = observeInventory(createHunt(crypto.randomUUID(), "large", 0, "test", "automatic"), { at: 1000, meso: 10, fragments: 1 });
  const stale = presentRecord(hunt, 600_000, "100", 2, 600_000 + STALE_MS + 1);
  assert.equal(stale.status, "saved"); assert.equal(stale.endedAt, 600_000); assert.equal(stale.reason, "기록 중단"); assert.equal(stale.meso, null);
  assert.equal(stale.auctionPrice, "100"); assert.equal(stale.evidence, 2);
  assert.equal(presentRecord(hunt, 600_000, null, 0, 600_000 + 1000).status, "hunting");
});
test("evidence accepts only real PNG and WebP bytes; end screen keeps one", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(16).fill(0)]);
  const webp = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
  assert.equal(imageType(png), "image/png"); assert.equal(imageType(webp), "image/webp");
  assert.equal(imageType(png.subarray(0, 8)), null, "truncated PNG");
  assert.equal(imageType(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WAVEfmt ")), null, "other RIFF");
  assert.equal(imageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>")), null);
  assert.deepEqual(Object.keys(EVIDENCE_KEEP).sort(), [...EVIDENCE_KINDS].sort()); assert.equal(EVIDENCE_KEEP.screen, 1);
});
test("inventory checked shortly before the potion becomes the starting balance", () => {
  const start = 10 * 60_000;
  let seen = noteInventory(NOTHING_SEEN, { at: start - 2 * 60_000, meso: 1000, fragments: null });
  seen = noteInventory(seen, { at: start - 60_000, meso: null, fragments: 40 });
  seen = noteInventory(seen, { at: start - 30_000, meso: null, fragments: null });
  assert.deepEqual(seen, { meso: { value: 1000, at: start - 120_000 }, fragments: { value: 40, at: start - 60_000 } });
  let hunt = withPreStart(createHunt("1", "small", start, "test", "automatic"), seen);
  assert.deepEqual(hunt.baseline, { at: start - 120_000, meso: 1000, fragments: 40 });
  hunt = observeInventory(hunt, { at: start + 5000, meso: 1200, fragments: 41 });
  assert.equal(hunt.baseline?.meso, 1000, "a later read does not replace the pre-start check");
  const stale = noteInventory(NOTHING_SEEN, { at: start - PRE_START_MS - 1, meso: 5, fragments: 5 });
  assert.equal(withPreStart(createHunt("2", "small", start, null, "manual"), stale).baseline, null, "too old");
  const partial = withPreStart(createHunt("3", "large", start, null, "automatic"), noteInventory(NOTHING_SEEN, { at: start - 1000, meso: 7, fragments: null }));
  assert.deepEqual(partial.baseline, { at: start - 1000, meso: 7, fragments: null });
  assert.equal(observeInventory(partial, { at: start + 3000, meso: 9, fragments: 2 }).baseline?.fragments, 2, "missing field filled within 30s");
  const detectedLate = noteInventory(NOTHING_SEEN, { at: start + 4000, meso: 3, fragments: 3 });
  assert.equal(withPreStart(createHunt("4", "small", start, null, "automatic"), detectedLate).baseline?.meso, 3, "read between use and detection");
  const withBase = observeInventory(createHunt("5", "small", start, null, "manual"), { at: start + 1000, meso: 1, fragments: 1 });
  assert.equal(withPreStart(withBase, seen), withBase, "existing baseline kept");
});
