"use client";

import { useState } from "react";
import { api, ApiError, type Session } from "@/services/client";
import { smallButton, smallField, smallPrimary } from "./ui";

const panel = "w-full rounded-xl border border-line bg-surface-1 p-3 shadow-card";

/**
 * 캐릭터 로그인. 머리글 오른쪽의 작은 패널이다.
 * 없는 캐릭터면 같은 자리에서 비밀번호를 한 번 더 받아 등록한다.
 */
export default function HuntLogin({ onLogin }: { onLogin: (session: Session) => void }) {
  const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [register, setRegister] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (register && password !== confirm) { setError("비밀번호 확인이 일치하지 않습니다."); return; }
    setBusy(true);
    try {
      onLogin(await api<Session>("/api/session", null, { method: "POST", body: JSON.stringify({ name, password, create: register }) }));
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) { setRegister(true); setError("등록되지 않은 캐릭터입니다. 비밀번호를 한 번 더 입력하면 이 비밀번호로 등록합니다."); }
      else setError(failure instanceof Error ? failure.message : "로그인 실패");
    } finally { setBusy(false); }
  }
  const input = `${smallField} min-w-0 flex-1`;
  return <section aria-labelledby="hunt-login" className={`${panel} sm:w-[380px]`}>
    <div className="flex items-baseline justify-between gap-2">
      <h2 id="hunt-login" className="text-sm font-semibold">{register ? "새 캐릭터 등록" : "캐릭터 로그인"}</h2>
      <p className="text-[11px] text-ink-faint">기록은 캐릭터 비밀번호로만 조회</p>
    </div>
    <form className="mt-2 flex flex-wrap gap-2" onSubmit={e => void submit(e)}>
      <input className={`${input} basis-28`} aria-label="캐릭터명" placeholder="캐릭터명" value={name} maxLength={12} autoComplete="username" required
        onChange={e => { setName(e.target.value); setRegister(false); setError(""); }} />
      <input className={`${input} basis-28`} aria-label="비밀번호" placeholder="비밀번호" type="password" value={password} minLength={4} maxLength={64} required
        autoComplete={register ? "new-password" : "current-password"} onChange={e => setPassword(e.target.value)} />
      {register && <input className={`${input} basis-full`} aria-label="비밀번호 확인" placeholder="비밀번호 확인" type="password" value={confirm}
        minLength={4} maxLength={64} required autoComplete="new-password" onChange={e => setConfirm(e.target.value)} />}
      <button className={`${smallPrimary} shrink-0`} disabled={busy}>{register ? "등록" : "로그인"}</button>
      {register && <button type="button" className={`${smallButton} shrink-0`} onClick={() => { setRegister(false); setConfirm(""); setError(""); }}>취소</button>}
    </form>
    {error ? <p role="alert" className="mt-2 text-xs text-warning">{error}</p>
      : <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">처음이면 입력한 비밀번호로 등록됩니다. 메이플 계정 비밀번호와 다르게 정하세요.</p>}
  </section>;
}

/** 로그인한 캐릭터. 로그인 패널과 같은 자리에 선다. */
export function HuntAccount({ name, onLogout, locked }: { name: string; onLogout: () => void; locked: boolean }) {
  return <section aria-label="로그인한 캐릭터" className={`${panel} flex items-center gap-3 sm:w-auto sm:min-w-[280px]`}>
    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-bold text-accent">{name.slice(0, 1)}</span>
    <div className="min-w-0 flex-1">
      <p className="text-[11px] text-ink-faint">로그인한 캐릭터</p>
      <p className="truncate text-sm font-semibold">{name}</p>
    </div>
    <button className={`${smallButton} shrink-0`} disabled={locked} title={locked ? "스캔을 중지한 뒤 로그아웃하세요." : undefined} onClick={onLogout}>로그아웃</button>
  </section>;
}
