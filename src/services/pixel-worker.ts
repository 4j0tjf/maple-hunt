import type { PixelRequest, PixelResult } from "./pixel-analysis";
import { apiUrl } from "../base-path";

/** 픽셀 탐색은 UI 스레드를 점유하지 않는다. 원본 버퍼는 복사하지 않고 워커에 넘긴다. */
export class PixelWorker {
  private worker: Worker | null = null;
  private cancel: ((error: Error) => void) | null = null;
  private disposed = false;
  read(request: PixelRequest): Promise<PixelResult> {
    if (this.disposed) return Promise.reject(new Error("스캔이 중지되었습니다."));
    if (this.cancel) return Promise.reject(new Error("이전 화면 분석이 진행 중입니다."));
    this.worker ??= new Worker(apiUrl("/scanner/pixel-worker.js?v=3"));
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timeout); this.cancel = null; worker.onmessage = null; worker.onerror = null; };
      const fail = (error: Error) => { finish(); worker.terminate(); this.worker = null; reject(error); };
      const timeout = setTimeout(() => fail(new Error("화면 분석 시간이 초과되었습니다.")), 20_000);
      this.cancel = fail;
      worker.onerror = () => fail(new Error("화면 분석 워커를 실행하지 못했습니다. 새로고침 후 다시 연결하세요."));
      worker.onmessage = (event: MessageEvent<{ result: PixelResult; error?: string }>) => {
        if (event.data.error) { fail(new Error(event.data.error)); return; }
        finish(); resolve(event.data.result);
      };
      try { worker.postMessage(request, [request.pixels.data.buffer as ArrayBuffer]); }
      catch (error) { fail(error instanceof Error ? error : new Error("화면 전송 실패")); }
    });
  }
  dispose() { this.disposed = true; this.cancel?.(new Error("스캔이 중지되었습니다.")); this.worker?.terminate(); this.worker = null; }
}
