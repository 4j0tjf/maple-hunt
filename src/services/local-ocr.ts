import type { Worker } from "tesseract.js";
import { apiUrl } from "@/base-path";
import type { Pixels, TextBox } from "./scanner";

/**
 * 캔버스를 24비트 BMP 바이트로 바꾼다. tesseract.js는 캔버스를 받으면 toBlob으로 PNG를 만드는데,
 * 브라우저 창이 게임에 가려지면 toBlob이 한 번에 약 1초씩 늦어져 인식 한 주기가 5~8초가 됐다. getImageData는 늦어지지 않는다.
 */
export function toBmp(canvas: HTMLCanvasElement): Uint8Array<ArrayBuffer> {
  const { width, height, data } = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
  return encodeBmp({ width, height, data });
}
export function encodeBmp({ width, height, data }: Pixels): Uint8Array<ArrayBuffer> {
  const row = Math.ceil(width * 3 / 4) * 4, size = 54 + row * height;
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  bytes[0] = 0x42; bytes[1] = 0x4d; view.setUint32(2, size, true); view.setUint32(10, 54, true);
  view.setUint32(14, 40, true); view.setInt32(18, width, true); view.setInt32(22, height, true);
  view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, row * height, true);
  // BMP는 아래 줄부터, 색은 BGR 순서로 저장한다.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4, to = 54 + (height - 1 - y) * row + x * 3;
    bytes[to] = data[from + 2]; bytes[to + 1] = data[from + 1]; bytes[to + 2] = data[from];
  }
  return bytes;
}

export class LocalOcr {
  private cache: { mode: string; bytes: Uint8Array; result: { lines: TextBox[]; words: TextBox[] } }[] = [];
  private worker: Worker | null = null;
  private pending: Promise<void> | null = null;
  private controller = new AbortController();
  icons: Record<"small" | "large" | "fragment" | "meso" | "point", Pixels> | null = null;

  private async alive<T>(work: Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    if (signal.aborted) throw new Error("스캔이 중지되었습니다.");
    let abort = () => {};
    const stopped = new Promise<never>((_, reject) => { abort = () => reject(new Error("스캔이 중지되었습니다.")); signal.addEventListener("abort", abort, { once: true }); });
    try { return await Promise.race([work, stopped]); }
    finally { signal.removeEventListener("abort", abort); }
  }
  async init(progress: (message: string) => void = () => {}) {
    this.pending ??= (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const base = new URL(apiUrl("/scanner/ocr/"), window.location.href).href;
      const worker = await createWorker("kor+eng", 1, {
        workerPath: `${base}worker.min.js`, corePath: base, langPath: base,
        workerBlobURL: false,
        logger: event => {
          if (!this.controller.signal.aborted && /loading|initializing/.test(event.status)) progress(`인식 준비 중 · ${Math.round(event.progress * 100)}% (처음에는 언어 파일을 내려받습니다)`);
        },
      });
      if (this.controller.signal.aborted) { await worker.terminate(); return; }
      this.worker = worker;
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
      const [small, large, fragment, meso, point] = await Promise.all(["small", "large", "fragment", "meso", "point"].map(async key => {
        // decode()는 브라우저 창이 게임에 가려진(숨김) 동안 끝나지 않아 인식 준비가 멈춘다. load 이벤트는 가려져도 온다.
        const img = new Image();
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error(`아이콘을 불러오지 못했습니다: ${key}`)); img.src = apiUrl(`/scanner/icons/${key}.png`); });
        const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(img, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      }));
      this.icons = { small, large, fragment, meso, point };
    })();
    await this.alive(this.pending);
  }
  /**
   * line: 글자를 제한하지 않는 한 줄(메소 "7451만 5280", 사냥터 이름).
   * 메소에 허용 글자로 한글 단위를 넣으면 오히려 숫자로 바꿔 읽어서 제한하지 않는다.
   */
  async read(canvas: HTMLCanvasElement, mode: "sparse" | "number" | "timer" | "line" = "sparse") {
    await this.init();
    const bytes = toBmp(canvas);
    // 새 프레임에서 자른 글자 영역이 완전히 같을 때만 결과를 재사용한다. 변경된 수량은 반드시 다시 읽는다.
    const cached = this.cache.find(entry => entry.mode === mode && entry.bytes.length === bytes.length && bytes.every((value, index) => value === entry.bytes[index]));
    if (cached) return cached.result;
    const { PSM } = await import("tesseract.js");
    await this.alive(this.worker!.setParameters({ tessedit_pageseg_mode: mode === "sparse" ? PSM.SPARSE_TEXT : PSM.SINGLE_LINE,
      tessedit_char_whitelist: mode === "number" ? "0123456789," : mode === "timer" ? "0123456789:시간분초 " : "" }));
    const result = await this.alive(this.worker!.recognize(new Blob([bytes], { type: "image/bmp" }), {}, { text: true, blocks: true }));
    const lines: TextBox[] = [], words: TextBox[] = [];
    const box = (value: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }): TextBox => ({
      text: value.text, confidence: value.confidence, x: value.bbox.x0, y: value.bbox.y0, w: value.bbox.x1 - value.bbox.x0, h: value.bbox.y1 - value.bbox.y0,
    });
    for (const block of result.data.blocks ?? []) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) {
      lines.push(box(line)); for (const word of line.words) words.push(box(word));
    }
    this.cache.push({ mode, bytes, result: { lines, words } });
    if (this.cache.length > 8) this.cache.shift();
    return { lines, words };
  }
  dispose() {
    this.cache = [];
    this.controller.abort();
    if (this.worker) { void this.worker.terminate(); this.worker = null; }
  }
}
