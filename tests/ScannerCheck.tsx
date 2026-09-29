"use client";
import { useRef, useState } from "react";
import { Recognition } from "../src/services/browser";
import { COUNT_DIGITS } from "../src/services/scanner";
import { apiUrl } from "../src/base-path";

/** Development fixture. Run through a temporary dev route; no capture permission or account needed. */
export default function ScannerCheck() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [log, setLog] = useState("Ready");
  const [busy, setBusy] = useState(false);
  async function run(kind: "small" | "large") {
    setBusy(true); const scanner = new Recognition(); const rows: string[] = [];
    const report = (value: unknown) => { rows.push(JSON.stringify(value)); setLog(rows.join("\n")); };
    try {
      await scanner.init(setLog);
      const images = await Promise.all(["small", "large", "fragment", "meso", "point"].map(async key => {
        const img = new Image();
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = apiUrl(`/scanner/icons/${key}.png`); });
        return img;
      }));
      const frame = canvas.current!, ctx = frame.getContext("2d")!;
      // 인벤토리 개수 글꼴(어두운 테두리·밝은 채움)을 픽셀 그대로 그린다.
      const count = (text: string, x: number, y: number) => {
        for (const digit of text) {
          COUNT_DIGITS[digit].forEach((row, dy) => [...row].forEach((tone, dx) => {
            if (tone === ".") return; ctx.fillStyle = tone === "#" ? "#000000" : "#ffffff"; ctx.fillRect(x + dx, y + dy, 1, 1);
          }));
          x += COUNT_DIGITS[digit][0].length;
        }
      };
      const draw = (buff: boolean, panel = true, dx = 0) => {
        ctx.fillStyle = "#243d36"; ctx.fillRect(0, 0, 1280, 720);
        // 미니맵 머리글: 청회색 바탕, 밝은 테두리의 지도 아이콘, 그 오른쪽에 지역과 사냥터 이름 두 줄
        ctx.fillStyle = "#344650"; ctx.fillRect(0, 0, 205, 72);
        ctx.fillStyle = "#f0f0f0"; ctx.fillRect(7, 29, 36, 36); ctx.fillStyle = "#785aa0"; ctx.fillRect(9, 31, 32, 32);
        ctx.fillStyle = "#d7e2e6"; ctx.font = '12px "Malgun Gothic", sans-serif'; ctx.fillText("카르시온", 51, 41); ctx.fillText("잔잔한 해안가 2", 51, 59);
        if (panel) {
          // 실제 인벤토리처럼 아이템 칸에 조각 두 칸(30 + 12 = 42), 아래 메소 줄에 동전·P 아이콘을 둔다.
          ctx.fillStyle = "#dbdbdb"; ctx.fillRect(460 + dx, 150, 790, 500);
          ctx.drawImage(images[2], 560 + dx, 300); count("30", 553 + dx, 324);
          ctx.drawImage(images[2], 654 + dx, 346); count("12", 647 + dx, 370);
          ctx.fillStyle = "#ffffff"; ctx.fillRect(464 + dx, 594, 172, 24); ctx.fillRect(645 + dx, 594, 150, 24);
          ctx.drawImage(images[3], 470 + dx, 600); ctx.drawImage(images[4], 651 + dx, 600);
          ctx.fillStyle = "#555555"; ctx.font = 'bold 13px "Malgun Gothic", sans-serif'; ctx.textAlign = "right";
          ctx.fillText("1억 2345만 6789", 628 + dx, 611); ctx.textAlign = "left";
        }
        if (buff) { ctx.drawImage(images[kind === "small" ? 0 : 1], 1000, 16); ctx.fillStyle = "white"; ctx.font = "14px Arial"; ctx.fillText(kind === "small" ? "29:58" : "119:58", 997, 61); }
      };
      for (const step of ["before1", "before2", "potion1", "potion2", "moved", "closed"]) {
        draw(step.startsWith("potion"), step !== "closed", step === "moved" ? -300 : 0);
        const reading = await scanner.read(frame, null, "테스트");
        const { image, ...rest } = reading; void image; report({ step, ...rest });
        if (step === "before2" && (reading.meso !== 123456789 || reading.fragments !== 42)) throw new Error("Inventory assertion failed");
        if (step === "before2" && !reading.mapName) throw new Error("Map name assertion failed");
        if (step === "potion2" && reading.use !== kind) throw new Error("Potion assertion failed");
        if (step === "moved" && reading.meso !== 123456789) throw new Error("Moved inventory assertion failed");
        if (step === "closed" && (reading.meso !== null || reading.fragments !== null || reading.inventory)) throw new Error("Closed inventory assertion failed");
      }
      report(`PASS (${kind}): browser worker, inventory icons, 억·만 meso, fragment stacks summed, minimap name, potion start, moved panel, null when hidden`);
    } catch (error) { report(String(error)); }
    finally { scanner.dispose(); setBusy(false); }
  }
  return <main><h1>Browser scanner synthetic check</h1><button disabled={busy} onClick={() => void run("small")}>Check small potion</button><button disabled={busy} onClick={() => void run("large")}>Check large potion</button><pre style={{ whiteSpace: "pre-wrap" }}>{log}</pre><canvas ref={canvas} width={1280} height={720} style={{ width: "100%" }} /></main>;
}
