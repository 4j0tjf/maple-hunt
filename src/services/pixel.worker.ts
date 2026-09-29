import { analyzePixels, createSearchState, type PixelRequest } from "./pixel-analysis";

const state = createSearchState();

self.onmessage = (event: MessageEvent<PixelRequest>) => {
  try { self.postMessage({ result: analyzePixels(event.data, state) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "화면 분석 실패" }); }
};
