import { PixelWorker } from "./pixel-worker";
import { parseCount, parseMeso, parseTimer, potionFromTimer, PotionDetector, StableValue, type Potion } from "./domain";
import { LocalOcr } from "./local-ocr";
import { binarizeMapText, bounded, compact, countBand, findMapHeader, normalizeMap, readBuffTimer, type Box, type TextBox } from "./scanner";

export type Role = "buffArea" | "buffIcon" | "timer" | "alternateIcon" | "alternateTimer" | "character" | "inventory" | "meso" | "fragmentIcon" | "fragments" | "map";
export const ROLES: Record<Role, string> = { buffArea: "버프 목록 전체", buffIcon: "재획 버프 아이콘 (숫자 제외)", timer: "그 버프의 남은 시간 (분+초 표시)",
  alternateIcon: "다른 종류의 재획 버프 아이콘 (선택)", alternateTimer: "다른 종류 버프의 남은 시간 (선택)",
  character: "캐릭터 이름", inventory: "인벤토리 제목 (고정 부분)", meso: "보유 메소 숫자만", fragmentIcon: "솔 에르다 조각 아이콘 (숫자 제외)", fragments: "조각 수량 숫자만", map: "사냥터 이름 (미니맵 제목, 선택)" };
export type Region = { x: number; y: number; w: number; h: number; pixels?: number[] };
export type Calibration = { width: number; height: number; regions: Partial<Record<Role, Region>> };
export function crop(source: HTMLCanvasElement, r: Region, scale = 1) {
  const result = document.createElement("canvas"); result.width = Math.ceil(r.w * scale); result.height = Math.ceil(r.h * scale);
  result.getContext("2d")!.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, result.width, result.height);
  return result;
}
/**
 * 판독용 조각. 사냥터 이름(미니맵 머리글)은 짙은 바탕의 밝은 작은 글자라 검은 글자로 이진화해야 OCR이 읽는다
 * (실제 화면 7장에서 지역 이름을 2장 → 7장 읽음). 기준 밝기는 binarizeMapText를 본다.
 */
export function tile(frame: HTMLCanvasElement, region: Region, role: Role) {
  const canvas = crop(frame, region, Math.min(4, 960 / region.w, 140 / region.h));
  if (role === "map") {
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    binarizeMapText(image.data);
    context.putImageData(image, 0, 0);
  }
  return canvas;
}
export function signature(canvas: HTMLCanvasElement): number[] {
  return pixelSignature(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height));
}
type Pixels = { data: Uint8ClampedArray; width: number; height: number };
export function pixelSignature(image: Pixels): number[] {
  const output: number[] = [];
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const i = (Math.floor((y + 0.5) * image.height / 12) * image.width + Math.floor((x + 0.5) * image.width / 12)) * 4;
    output.push(image.data[i], image.data[i + 1], image.data[i + 2], 255);
  }
  return output;
}
export function similarity(a: number[], b: number[]) {
  let sum = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) sum += Math.abs(a[i] - b[i]);
  return 1 - sum / (a.length / 4 * 3 * 255);
}
function matchAt(frame: HTMLCanvasElement, r: Region) {
  return r.pixels ? similarity(signature(crop(frame, r)), r.pixels) >= 0.94 : false;
}
export function locateBuff(frame: HTMLCanvasElement, template: Region, area: Region): Region | null {
  const data = frame.getContext("2d", { willReadFrequently: true })!.getImageData(area.x, area.y, area.w, area.h);
  return findTemplate(data, template, area);
}
export function findTemplate(data: Pixels, template: Region, area: Region): Region | null {
  if (!template.pixels) return null;
  let best = 0.94; let match: Region | null = null;
  for (let y = 0; y <= area.h - template.h; y++) for (let x = 0; x <= area.w - template.w; x++) {
    let difference = 0;
    samples: for (let sy = 0; sy < 12; sy++) for (let sx = 0; sx < 12; sx++) {
      const i = ((y + Math.min(template.h - 1, Math.floor((sy + 0.5) * template.h / 12))) * data.width + x + Math.min(template.w - 1, Math.floor((sx + 0.5) * template.w / 12))) * 4;
      const t = (sy * 12 + sx) * 4;
      difference += Math.abs(data.data[i] - template.pixels[t]) + Math.abs(data.data[i + 1] - template.pixels[t + 1]) + Math.abs(data.data[i + 2] - template.pixels[t + 2]);
      if (difference > (1 - best) * 12 * 12 * 3 * 255) break samples;
    }
    const score = 1 - difference / (12 * 12 * 3 * 255);
    if (score > best) { best = score; match = { ...template, x: area.x + x, y: area.y + y }; }
  }
  return match;
}
/**
 * 반복 신호. 창이 5분 넘게 가려지면 크롬은 페이지의 반복 타이머를 1분에 한 번으로 묶는데,
 * 전용 워커 안의 타이머는 묶이지 않아 게임을 앞에 두고 사냥해도 스캔 주기가 유지된다. 워커를 못 만들면 일반 타이머를 쓴다.
 */
export function steadyInterval(callback: () => void, ms: number): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = () => { URL.revokeObjectURL(url); callback(); };
    return () => { worker.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const timer = setInterval(callback, ms);
    return () => clearInterval(timer);
  }
}
export class Recognition {
  private ocr = new LocalOcr();
  private pixels = new PixelWorker();
  private meso = new StableValue<number>();
  private fragments = new StableValue<number>();
  private character = new StableValue<string>();
  private mapName = new StableValue<string>();
  private detector = new PotionDetector();
  init(progress?: (message: string) => void) { return this.ocr.init(progress); }
  dispose() { this.ocr.dispose(); this.pixels.dispose(); }
  acknowledge(at: number) { this.detector.acknowledge(at); }
  private calibrated(frame: HTMLCanvasElement, config: Calibration) {
    if (frame.width !== config.width || frame.height !== config.height) throw new Error("보정한 화면과 크기가 다릅니다. 자동 인식으로 전환하거나 보정 영역을 다시 지정하세요.");
    const regions = config.regions;
    let anchor = regions.buffIcon; let timerRegion = regions.timer;
    let buff = anchor && regions.buffArea ? locateBuff(frame, anchor, regions.buffArea) : null;
    if (!buff && regions.alternateIcon && regions.alternateTimer && regions.buffArea) {
      anchor = regions.alternateIcon; timerRegion = regions.alternateTimer;
      buff = locateBuff(frame, anchor, regions.buffArea);
    }
    const inventory = !!regions.inventory && matchAt(frame, regions.inventory);
    const fragmentVisible = inventory && !!regions.fragmentIcon && matchAt(frame, regions.fragmentIcon);
    const inputs: { role: Role; region: Region }[] = [];
    if (regions.character) inputs.push({ role: "character", region: regions.character });
    if (regions.map) inputs.push({ role: "map", region: regions.map });
    if (inventory && regions.meso) inputs.push({ role: "meso", region: regions.meso });
    if (fragmentVisible && regions.fragments) inputs.push({ role: "fragments", region: regions.fragments });
    if (buff && timerRegion && anchor) inputs.push({ role: "timer", region: { ...timerRegion,
      x: timerRegion.x + buff.x - anchor.x, y: timerRegion.y + buff.y - anchor.y } });
    return { inputs, inventory, fragmentVisible, buff: !!buff, kind: null as Potion | null, hint: "영역 보정 사용 중",
      fragmentCount: undefined as number | null | undefined, street: null as string | null, minuteTimer: null as number | null };
  }
  /**
   * 화면 일부만 확대해 읽고 좌표를 원래 화면 기준으로 돌린다.
   * 전체 화면 OCR은 1920×1080에서 한 번에 약 6초라 사냥터·수량 확정이 15초 넘게 늦어졌다. 필요한 곳만 읽는다.
   */
  private async readArea(frame: HTMLCanvasElement, area: Box, scale: number) {
    const box = bounded(area, frame.width, frame.height);
    if (!box.w || !box.h) return { lines: [] as TextBox[], words: [] as TextBox[] };
    const result = await this.ocr.read(crop(frame, box, scale));
    const place = (line: TextBox) => ({ ...line, x: box.x + line.x / scale, y: box.y + line.y / scale, w: line.w / scale, h: line.h / scale });
    return { lines: result.lines.map(place), words: result.words.map(place) };
  }
  private async automatic(frame: HTMLCanvasElement, expectedName: string) {
    const pixels = frame.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, frame.width, frame.height);
    const icons = this.ocr.icons!;
    // 인벤토리는 글자(제목·MESO)가 아니라 메소 줄의 아이콘으로 찾는다. 전체 화면 OCR은 확대 방식에 따라 제목을 놓친다.
    const { layout, fragments, header, buff, minuteTimer } = await this.pixels.read({ pixels, icons });
    const inputs: { role: Role; region: Region }[] = [];
    if (layout) inputs.push({ role: "meso", region: layout.amount });
    // 조각이 여러 칸이면 모두 더한다. 개수는 픽셀 숫자 모양으로 읽고, 영역은 증거 이미지로만 남긴다.
    // Never turn an absent icon into zero.
    for (const stack of fragments?.stacks ?? []) inputs.push({ role: "fragments", region: countBand(stack) });
    const fragmentCount = fragments?.total ?? null;
    // 미니맵 머리글 두 줄은 픽셀로 찾고 줄마다 읽는다. 지역 이름은 동명 사냥터를 가르는 데만 쓴다.
    if (header) inputs.push({ role: "map", region: header.name });
    const street = header ? normalizeMap((await this.ocr.read(tile(frame, header.street, "map"), "line")).lines
      .filter(line => line.confidence >= 40).map(line => line.text).join(" ")) : null;
    if (buff && minuteTimer === null) {
      const icon = buff.region;
      // 남은 시간 글자는 아이콘 아래쪽부터 그 밑에 있다. 아이콘 주변만 읽는다.
      const near = await this.readArea(frame, { x: icon.x - icon.w, y: icon.y, w: icon.w * 3, h: icon.h * 2.2 }, 3);
      const label = [...near.words, ...near.lines].filter(line => line.confidence >= 40 && readBuffTimer(line.text) !== null &&
        Math.abs(line.x + line.w / 2 - icon.x - icon.w / 2) < icon.w * .65 && line.w <= icon.w * 2.5 && line.h <= icon.h * .65 &&
        line.y >= icon.y + icon.h * .5 && line.y <= icon.y + icon.h * 2)
        .sort((a, b) => a.y - b.y)[0];
      inputs.push({ role: "timer", region: label ? { x: label.x - 3, y: label.y - 3, w: label.w + 6, h: label.h + 6 }
        : { x: icon.x - icon.w * .4, y: icon.y + icon.h * .5, w: icon.w * 1.8, h: Math.max(20, icon.h) } });
    }
    // Login supplies the record owner. Only an exact name in the bottom-left HUD (Lv.286 이름) is accepted as supporting OCR.
    const hud = await this.readArea(frame, { x: 0, y: frame.height - 60, w: 420, h: 60 }, 3);
    const name = hud.words.find(w => w.confidence >= 60 && compact(w.text) === expectedName);
    if (name) inputs.push({ role: "character", region: name });
    const stacks = fragments?.stacks.length ?? 0;
    return { inputs, inventory: !!layout, fragmentVisible: stacks > 0, buff: !!buff, kind: buff?.kind ?? null, fragmentCount, street, minuteTimer,
      hint: !layout ? "인벤토리를 열고 아래쪽 메소 줄(동전·P 아이콘)이 가리지 않게 보여주세요."
        : !stacks ? "기타 탭을 열어 솔 에르다 조각이 보이게 해주세요."
        : fragmentCount == null ? `조각 ${stacks}칸 중 개수를 못 읽은 칸이 있습니다. 게임 화면을 줄이거나 늘리지 말고 원래 크기로 공유하고, 조각 칸을 가리지 마세요.`
        : stacks > 1 ? `조각 ${stacks}칸 합계 (${fragments!.counts.join(" + ")})`
        : "인벤토리 위치 자동 확인" };
  }
  async read(frame: HTMLCanvasElement, config: Calibration | null, expectedName: string) {
    // Timestamp the captured frame, not the end of a potentially slow OCR operation.
    const now = Date.now();
    await this.init();
    const observation = config ? this.calibrated(frame, config) : await this.automatic(frame, expectedName);
    // 이전 보정에 선택 항목인 사냥터가 없더라도 자동 위치 탐색을 계속한다.
    if (config && !config.regions.map) {
      const pixels = frame.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, frame.width, frame.height);
      const header = findMapHeader(pixels);
      if (header) {
        observation.inputs.push({ role: "map", region: header.name });
        observation.street = normalizeMap((await this.ocr.read(tile(frame, header.street, "map"), "line")).lines.filter(line => line.confidence >= 40).map(line => line.text).join(" "));
      }
    }
    const { inventory, fragmentVisible, buff } = observation;
    const inputs = observation.inputs.map(input => ({ ...input, region: bounded(input.region, frame.width, frame.height) })).filter(input => input.region.w > 0 && input.region.h > 0);
    const text: Partial<Record<Role, string>> = {};
    let image: (() => Promise<Blob>) | null = null;
    if (inputs.length) {
      // Sparse OCR in a local worker; separate bands preserve each crop's identity.
      const sheet = document.createElement("canvas"); sheet.width = 1000; sheet.height = inputs.length * 180;
      const ctx = sheet.getContext("2d")!; ctx.fillStyle = "black"; ctx.fillRect(0, 0, sheet.width, sheet.height);
      const tiles = inputs.map(({ role, region }, index) => { const piece = tile(frame, region, role); ctx.drawImage(piece, 15, index * 180 + 15); return piece; });
      // 판독에 쓴 바로 그 이미지를 수량 증거로 남긴다. PNG 변환은 창이 가려지면 약 1초 걸려 수량이 바뀐 때만 만든다.
      image = () => new Promise<Blob>((resolve, reject) => sheet.toBlob(b => b ? resolve(b) : reject(new Error("이미지 변환 실패")), "image/png"));
      for (let i = 0; i < inputs.length; i++) {
        const role = inputs[i].role;
        if (role === "fragments" && observation.fragmentCount !== undefined) continue;
        const result = await this.ocr.read(tiles[i], role === "meso" || role === "map" ? "line" : role === "fragments" ? "number" : role === "timer" ? "timer" : "sparse");
        for (const line of result.lines) {
          if (line.confidence < 40) continue;
          text[role] = `${text[role] ?? ""}${line.text} `;
        }
      }
    }
    const timer = observation.minuteTimer ?? (config ? parseTimer(text.timer ?? "") : readBuffTimer(text.timer ?? ""));
    const detected = this.detector.read(buff, timer, now);
    const use = detected && (!observation.kind || observation.kind === potionFromTimer(timer)) ? detected : null;
    const name = (text.character ?? "").replace(/\s/g, "");
    const mapText = normalizeMap(text.map);
    return { at: now, use, timer, approximateTimer: observation.minuteTimer !== null, inventory, buff, texts: text, image,
      hint: `${observation.inputs.some(input => input.role === "map") ? mapText ? "" : "사냥터 글자 판독 실패 · " : "미니맵 제목 위치 미확인 · "}${buff && !use ? "재획 버프 사용 중 · 새 사용을 확인하면 자동 시작 · " : ""}${observation.hint}`,
      meso: this.meso.read(inventory ? parseMeso(text.meso ?? "") : null),
      fragments: this.fragments.read(fragmentVisible ? observation.fragmentCount !== undefined ? observation.fragmentCount : parseCount(text.fragments ?? "") : null),
      character: this.character.read(/^[가-힣A-Za-z0-9]{2,12}$/.test(name) ? name : null),
      // 사냥터 이름도 같은 글자가 두 번 연속 읽혀야 쓴다. 툴팁 등에 가려 한 번 못 읽은 프레임은 확인을 처음부터 다시 하게 만들지 않는다.
      // 지역 이름은 동명 사냥터를 가르는 데만 쓴다.
      mapName: mapText ? this.mapName.read(mapText) : null, mapStreet: observation.street };
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("maple-hunting-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("chunks", { keyPath: ["recording", "index"] });
      request.result.createObjectStore("recordings", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function putRecording(store: "recordings" | "chunks", value: unknown) {
  const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export type Recording = { id: string; huntId?: string; startedAt: number; endedAt?: number; mime: string; error?: string };
export async function getRecordings(): Promise<Recording[]> {
  const db = await openDatabase();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction("recordings").objectStore("recordings").getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function recordingBlob(record: Recording) {
  const db = await openDatabase();
  try { return await new Promise<Blob>((resolve, reject) => {
    const request = db.transaction("chunks").objectStore("chunks").getAll(IDBKeyRange.bound([record.id, 0], [record.id, Number.MAX_SAFE_INTEGER]));
    request.onsuccess = () => resolve(new Blob(request.result.map(row => row.blob), { type: record.mime }));
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function deleteRecording(id: string) {
  const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["chunks", "recordings"], "readwrite");
    tx.objectStore("recordings").delete(id);
    tx.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
/** 종료 수량을 확인한 순간의 전체 화면. 1280px로 줄인 WebP라 1장에 약 0.1~0.3MB다. */
export function screenshot(frame: HTMLCanvasElement, width = 1280): Promise<Blob | null> {
  const scale = Math.min(1, width / frame.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(frame.width * scale); canvas.height = Math.round(frame.height * scale);
  canvas.getContext("2d")!.drawImage(frame, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.8));
}
/**
 * 선택 녹화 설정. 인식은 원본 해상도 프레임으로 하고, 녹화만 줄인 캔버스에서 뜬다.
 * 1280px · 5fps · 0.3Mbps ≈ 시간당 135MB. 이전 방식(원본 · 1.5Mbps 상시)은 시간당 약 675MB였다.
 */
export const VIDEO = { width: 1280, fps: 5, bitrate: 300_000, keep: 5 };
/** 미리보기 영상의 재생 여부와 관계없이 공유 트랙에서 현재 화면을 받는다. */
export async function captureFrame(track: MediaStreamTrack): Promise<HTMLCanvasElement> {
  if (track.readyState !== "live" || track.muted) throw new Error("공유 화면을 받지 못하고 있습니다. 메이플 창과 공유 상태를 확인하세요.");
  const Capture = (globalThis as unknown as { ImageCapture?: new (track: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
  if (!Capture) throw new Error("이 브라우저는 직접 화면 수신을 지원하지 않습니다. PC Chrome·Edge에서 연결하세요.");
  let expired = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const pending = new Capture(track).grabFrame().then(bitmap => {
    if (expired) { bitmap.close(); throw new Error("화면 수신 시간 초과"); }
    return bitmap;
  });
  try {
    const bitmap = await Promise.race([pending, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { expired = true; reject(new Error("화면 수신 지연 · 메이플 창과 공유 상태를 확인하세요.")); }, 5000);
    })]);
    try {
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      return canvas;
    } finally { bitmap.close(); }
  } finally { clearTimeout(timeout); }
}
export async function pruneRecordings(keep = VIDEO.keep) {
  const rows = (await getRecordings()).sort((a, b) => b.startedAt - a.startedAt);
  for (const row of rows.slice(keep)) await deleteRecording(row.id);
}
/** 사냥 1차수 녹화를 시작한다. stop()은 마지막 조각까지 저장하고 오래된 영상을 정리한 뒤 끝난다. */
export async function startRecording(source: MediaStreamTrack, huntId: string, onError: (message: string) => void) {
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("이 브라우저에서 WebM 녹화를 지원하지 않습니다.");
  const first = await captureFrame(source);
  const meta: Recording = { id: crypto.randomUUID(), huntId, startedAt: Date.now(), mime };
  await putRecording("recordings", meta);
  const scale = Math.min(1, VIDEO.width / first.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(first.width * scale / 2) * 2); canvas.height = Math.max(2, Math.round(first.height * scale / 2) * 2);
  const ctx = canvas.getContext("2d")!;
  let drawing = false, stopped = false;
  const draw = async () => {
    if (drawing || stopped) return;
    drawing = true;
    try { const frame = await captureFrame(source); if (!stopped) ctx.drawImage(frame, 0, 0, canvas.width, canvas.height); }
    catch { if (!stopped) fail("공유 화면 수신 오류"); }
    finally { drawing = false; }
  };
  ctx.drawImage(first, 0, 0, canvas.width, canvas.height);
  const painter = setInterval(() => void draw(), 1000 / VIDEO.fps);
  const stream = canvas.captureStream(VIDEO.fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO.bitrate });
  let index = 0; let writes = Promise.resolve(); let pending = 0; let failed = false;
  let finished: () => void = () => {};
  const done = new Promise<void>(resolve => { finished = resolve; });
  const stop = () => {
    stopped = true;
    clearInterval(painter);
    if (recorder.state !== "inactive") recorder.stop(); else finished();
    stream.getTracks().forEach(track => track.stop());
    return done;
  };
  const fail = (message: string) => { if (failed) return; failed = true; meta.error = message; onError(message); void stop(); };
  recorder.ondataavailable = event => {
    if (!event.data.size || failed) return;
    const chunk = { recording: meta.id, index: index++, blob: event.data }; pending++;
    if (pending > 12) { fail("저장 지연으로 녹화 중단"); return; }
    writes = writes.then(() => putRecording("chunks", chunk)).catch(() => fail("저장 공간 부족으로 일부 영상 누락")).finally(() => { pending--; });
  };
  recorder.onerror = () => fail("녹화 오류");
  recorder.onstop = () => {
    void writes.then(async () => { meta.endedAt = Date.now(); await putRecording("recordings", meta); await pruneRecordings(); })
      .catch(() => {}).finally(finished);
  };
  recorder.start(5000);
  return { id: meta.id, huntId, stop };
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
