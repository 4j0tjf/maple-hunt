import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { huntingAccess, readLimited } from "@/services/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execute = promisify(execFile);
// 여러 사람이 같이 쓰므로 거절 대신 차례대로 처리한다. 대기가 길어지면 인식 주기보다 늦어지니 몇 건까지만 받는다.
const MAX_WAITING = 4;
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

async function recognize(bytes: Buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), "maple-hunt-"));
  try {
    const imagePath = path.join(directory, "frame.png"); await writeFile(imagePath, bytes);
    const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      path.resolve("scripts/ocr.ps1"), "-ImagePath", imagePath, "-MaxFrames", "1"],
    { windowsHide: true, timeout: 20_000, maxBuffer: 1_000_000, encoding: "utf8" });
    return JSON.parse(stdout.replace(/^﻿/, ""));
  } finally {
    if (path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + "maple-hunt-"))
      await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function POST(request: Request) {
  const denied = await huntingAccess(request); if (denied) return denied;
  if (process.platform !== "win32") return Response.json({ error: "Windows 한국어 OCR 서버가 필요합니다." }, { status: 503 });
  if (request.headers.get("content-type") !== "image/png") return Response.json({ error: "PNG만 지원합니다." }, { status: 415 });
  if (waiting >= MAX_WAITING) return Response.json({ error: "OCR 처리 중" }, { status: 429 });
  const bytes = await readLimited(request, 2_000_000).catch(() => null);
  if (!bytes) return Response.json({ error: "이미지가 너무 큽니다." }, { status: 413 });
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(16) > 2400 || bytes.readUInt32BE(20) > 2400) return Response.json({ error: "PNG 크기 오류" }, { status: 400 });
  waiting++;
  const run = queue.then(() => recognize(bytes)); queue = run.catch(() => {});
  try {
    return Response.json(await run, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "화면 인식 실패. Windows 한국어 OCR 설치와 선택 영역을 확인하세요." }, { status: 503 });
  } finally { waiting--; }
}
