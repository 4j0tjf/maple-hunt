"use client";

import { Fragment, useEffect, useState } from "react";
import { fillMissing, fragmentValue, parseCount, type Amount, type Hunt, type Side } from "@/services/domain";
import { apiUrl } from "@/base-path";
import { api, type HuntRow } from "@/services/client";
import { expectations, type Expectation } from "@/services/efficiency";
import { lossText, PlanEditor } from "./HuntEfficiency";
import { button, field, duration, number } from "./ui";

export type Price = { price: string; source: "경매장" | "직접 입력" } | null;
const FIELDS: [Side, Amount, string][] = [["baseline", "meso", "시작 보유 메소"], ["baseline", "fragments", "시작 보유 조각"],
  ["final", "meso", "종료 보유 메소"], ["final", "fragments", "종료 보유 조각"]];

/** 기록되지 않은(null) 보유량만 직접 입력받는다. 이미 기록된 값은 고칠 수 없다. */
export function MissingInputs({ hunt, onFill }: { hunt: Hunt; onFill: (hunt: Hunt) => void }) {
  const [values, setValues] = useState<Record<string, string>>({}); const [error, setError] = useState("");
  const missing = FIELDS.filter(([side, key]) => hunt[side]?.[key] == null && (side === "baseline" || hunt.status !== "hunting"));
  function apply() {
    let next = hunt;
    for (const [side, key, label] of missing) {
      const text = values[`${side}.${key}`]?.trim(); if (!text) continue;
      const value = parseCount(text);
      if (value == null) { setError(`${label}: 숫자만 입력하세요 (쉼표 가능).`); return; }
      next = fillMissing(next, side, key, value);
    }
    if (next === hunt) { setError("입력한 값이 없습니다."); return; }
    setValues({}); setError(""); onFill(next);
  }
  if (!missing.length) return null;
  return <div className="mt-3 rounded-lg bg-surface-0 p-3">
    <p className="text-xs text-ink-muted">기록되지 않은 보유량만 입력할 수 있습니다. 획득량은 종료 보유량 − 시작 보유량으로 계산합니다.{hunt.status === "hunting" ? " 종료 보유량은 사냥이 끝난 뒤 입력합니다." : ""}</p>
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {missing.map(([side, key, label]) => <label key={`${side}.${key}`} className="text-xs">{label}
        <input className={`${field} mt-1 block w-36`} inputMode="numeric" placeholder="예: 1,234,567" value={values[`${side}.${key}`] ?? ""}
          onChange={e => setValues({ ...values, [`${side}.${key}`]: e.target.value })} /></label>)}
      <button className={button} onClick={apply}>직접 입력 반영</button>
    </div>
    {error && <p className="mt-2 text-xs text-warning">{error}</p>}
  </div>;
}

/** 그날 경매장 시세가 없을 때만 조각 개당 가격을 받는다. */
export function PriceInput({ onApply, label = "시세 직접 입력" }: { onApply: (price: string) => void; label?: string }) {
  const [text, setText] = useState(""); const [error, setError] = useState("");
  function apply() {
    const value = parseCount(text.trim());
    if (!value) { setError("1 이상의 숫자만 입력하세요 (쉼표 가능)."); return; }
    setText(""); setError(""); onApply(String(value));
  }
  return <div className="flex flex-wrap items-center gap-2">
    <input className={`${field} w-36`} inputMode="numeric" placeholder="메소 / 개" aria-label="조각 개당 가격" value={text} onChange={e => setText(e.target.value)} />
    <button className={button} onClick={apply}>{label}</button>
    {error && <span className="text-xs text-warning">{error}</span>}
  </div>;
}

const KIND: Record<string, string> = { baseline: "시작 판독", final: "종료 판독", screen: "종료 화면" };

function Evidence({ huntId, token }: { huntId: string; token: string }) {
  const [images, setImages] = useState<{ id: string; kind: string; capturedAt: string; url: string }[] | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    let alive = true; const urls: string[] = [];
    (async () => {
      const { items } = await api<{ items: { id: string; kind: string; capturedAt: string }[] }>(`/api/evidence?hunt=${huntId}`, token);
      const loaded = [];
      for (const item of items) {
        const response = await fetch(apiUrl(`/api/evidence?hunt=${huntId}&id=${item.id}`), { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) continue;
        const url = URL.createObjectURL(await response.blob()); urls.push(url); loaded.push({ ...item, url });
      }
      if (alive) setImages(loaded);
    })().catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : "증거 이미지를 불러오지 못했습니다."); });
    return () => { alive = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [huntId, token]);
  if (error) return <p className="text-xs text-warning">{error}</p>;
  if (!images) return <p className="text-xs text-ink-faint">증거 이미지 불러오는 중…</p>;
  if (!images.length) return <p className="text-xs text-ink-faint">저장된 증거 이미지가 없습니다.</p>;
  // 종료 화면(전체 스크린샷)을 먼저 크게, 판독 이미지는 그 뒤에 작게 보여준다.
  const ordered = [...images].sort((a, b) => Number(b.kind === "screen") - Number(a.kind === "screen"));
  return <div className="flex flex-wrap gap-3">{ordered.map(image => <figure key={image.id} className={image.kind === "screen" ? "w-full max-w-[720px]" : "max-w-[320px]"}>
    {/* eslint-disable-next-line @next/next/no-img-element -- 인증 헤더로 받은 blob URL이라 next/image 최적화를 쓸 수 없다. */}
    <img src={image.url} alt={`${KIND[image.kind] ?? image.kind} 이미지`} className="w-full rounded border border-line" />
    <figcaption className="mt-1 text-xs text-ink-muted">{KIND[image.kind] ?? image.kind} · {new Date(image.capturedAt).toLocaleString("ko-KR")}</figcaption>
  </figure>)}</div>;
}


const STATUS: Record<Hunt["status"], string> = { hunting: "진행 중", finishing: "종료 수량 확인 중", saved: "" };
const statusText = (row: HuntRow) => [STATUS[row.status], row.reason, row.meso === null || row.fragments === null ? "수량 미확인" : "",
  row.manual?.length ? "직접 입력 포함" : "", row.pending ? "업로드 대기" : ""].filter(Boolean).join(" · ");

/** 기록 삭제. 되돌릴 수 없으니 확인을 받고, 실패하면 이유를 보여준다. */
function DeleteRecord({ row, onDelete }: { row: HuntRow; onDelete: (row: HuntRow) => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function remove() {
    const when = new Date(row.startedAt).toLocaleString("ko-KR");
    if (!window.confirm(`${when}${row.plan?.map ? ` · ${row.plan.map}` : ""} 사냥 기록을 삭제할까요?\n서버의 기록과 증거 이미지가 함께 지워지며 되돌릴 수 없습니다.`)) return;
    setBusy(true); setError("");
    try { await onDelete(row); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "삭제하지 못했습니다."); setBusy(false); }
  }
  return <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
    <button className={`${button} text-warning`} disabled={busy} onClick={() => void remove()}>{busy ? "삭제하는 중…" : "이 기록 삭제"}</button>
    {error && <span className="text-xs text-warning">{error}</span>}
  </div>;
}

/** 펼친 기록의 보정·시세 입력·증거 이미지·삭제. 표와 모바일 카드가 같이 쓴다. */
function RowDetail({ row, price, token, onChange, onDelete }: { row: HuntRow; price: Price; token: string; onChange: (hunt: Hunt) => void; onDelete: (row: HuntRow) => Promise<void> }) {
  const [proof, setProof] = useState(false);
  const missing = row.meso === null || row.fragments === null;
  const unrecorded = FIELDS.some(([side, key]) => row[side]?.[key] == null);
  return <div>
    {row.status === "saved" && unrecorded ? <MissingInputs hunt={row} onFill={onChange} /> : <p className="mt-2 text-xs text-ink-faint">{row.status !== "saved" ? "진행 중인 기록은 사냥 화면에서 보정합니다."
      : missing ? "시작·종료 보유량이 모두 기록되었지만 종료 보유량이 더 적어 획득량을 계산하지 않습니다(사냥 중 사용·거래 가능성)." : "시작·종료 보유량이 모두 기록되어 있습니다."}</p>}
    {!price && <div className="mt-3"><p className="mb-2 text-xs text-ink-muted">이날 경매장 시세가 없습니다. 조각 개당 가격을 넣으면 이 기록의 조각 환산에 씁니다.</p>
      <PriceInput onApply={manualPrice => onChange({ ...row, manualPrice })} /></div>}
    {row.status === "saved" && <PlanEditor plan={row.plan} onSave={plan => onChange({ ...row, plan })} />}
    <div className="mt-3">{proof ? <Evidence huntId={row.id} token={token} />
      : <button className={button} disabled={!row.evidence || row.pending} onClick={() => setProof(true)}>증거 이미지 보기 ({row.evidence ?? 0})</button>}</div>
    <DeleteRecord row={row} onDelete={onDelete} />
  </div>;
}

/** 기록 표 위의 합계. 읽지 못한(null) 값은 0으로 더하지 않고 건너뛴다. */
export function RecordSummary({ rows, priceOf }: { rows: HuntRow[]; priceOf: (row: HuntRow) => Price }) {
  if (!rows.length) return null;
  const time = rows.reduce((sum, row) => sum + ((row.endedAt ?? row.startedAt) - row.startedAt), 0);
  const meso = rows.reduce((sum, row) => sum + (row.meso ?? 0), 0);
  const fragments = rows.reduce((sum, row) => sum + (row.fragments ?? 0), 0);
  const value = rows.reduce((sum, row) => { const v = fragmentValue(row.fragments, priceOf(row)?.price); return v ? sum + BigInt(v) : sum; }, 0n);
  // 손실률 합계는 기대값과 실제 획득량이 모두 있는 사냥만 더해 계산한다.
  const expect = expectations(rows);
  const compared = rows.filter(row => row.meso != null && expect.get(row.id)?.expected != null);
  const expected = compared.reduce((sum, row) => sum + expect.get(row.id)!.expected!, 0);
  const actual = compared.reduce((sum, row) => sum + row.meso!, 0);
  const tiles: [string, string][] = [["사냥", `${rows.length}회`], ["사냥 시간", duration(time)], ["획득 메소", number(meso)], ["획득 조각", number(fragments)],
    ["조각 환산", value ? `${number(value.toString())} 메소` : "—"], ["기대 메소", compared.length ? number(expected) : "—"],
    ["손실률", compared.length ? lossText(expected > 0 ? (expected - actual) / expected : null) : "—"]];
  return <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
    {tiles.map(([label, text]) => <div key={label} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`mt-1 text-lg font-bold tabular-nums ${label === "조각 환산" ? "text-accent" : ""}`}>{text}</dd>
    </div>)}
  </dl>;
}

export default function HuntRecords({ rows, token, priceOf, onChange, onDelete }: {
  rows: HuntRow[]; token: string; priceOf: (row: HuntRow) => Price; onChange: (hunt: Hunt) => void; onDelete: (row: HuntRow) => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <p className="py-12 text-center text-ink-faint">저장된 사냥이 없습니다. 재물 획득의 비약 사용을 감지하면 첫 기록이 시작됩니다.</p>;
  const toggle = (id: string) => setOpen(open === id ? null : id);
  const expect = expectations(rows);
  const none: Expectation = { expected: null, loss: null, capped: false };
  const view = rows.map(row => { const price = priceOf(row); return { row, price, value: fragmentValue(row.fragments, price?.price), exp: expect.get(row.id) ?? none }; });
  const lossClass = (loss: number | null) => loss == null ? "text-ink-faint" : loss > 0 ? "text-warning" : "text-accent";
  return <>
    {/* 좁은 화면: 한 기록을 한 장의 카드로. 기록 조회는 주로 휴대폰에서 한다. */}
    <ul className="space-y-3 md:hidden">{view.map(({ row, price, value, exp }) => <li key={row.id} className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{new Date(row.startedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
        <p className="text-sm tabular-nums text-ink-muted">{duration((row.endedAt ?? row.startedAt) - row.startedAt)} · 비약 {row.small + row.large}개</p>
      </div>
      {row.plan?.map && <p className="mt-1 text-xs text-ink-muted">{row.plan.map}</p>}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div><dt className="text-xs text-ink-faint">획득 메소</dt><dd className="tabular-nums">{number(row.meso)}</dd></div>
        <div><dt className="text-xs text-ink-faint">획득 조각</dt><dd className="tabular-nums">{number(row.fragments)}</dd></div>
        <div><dt className="text-xs text-ink-faint">조각 환산</dt><dd className="font-medium tabular-nums text-accent">{value ? number(value) : "—"}</dd></div>
        <div><dt className="text-xs text-ink-faint">기대 메소</dt><dd className="tabular-nums">{number(exp.expected)}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-ink-faint">손실률</dt><dd className={`font-medium tabular-nums ${lossClass(exp.loss)}`}>{lossText(exp.loss)}</dd></div>
      </dl>
      {statusText(row) && <p className="mt-2 text-xs text-ink-muted">{statusText(row)}</p>}
      <button className="mt-2 text-xs text-accent hover:underline" onClick={() => toggle(row.id)}>{open === row.id ? "닫기" : "보정 · 증거 · 삭제"}</button>
      {open === row.id && <RowDetail row={row} price={price} token={token} onChange={onChange} onDelete={onDelete} />}
    </li>)}</ul>

    <div className="hidden overflow-x-auto md:block"><table className="w-full whitespace-nowrap text-left text-sm">
      <thead className="border-b border-line bg-surface-2 text-xs text-ink-muted"><tr>{["시작 시각 · 사냥터", "사냥 시간", "비약 (소형 / 대형)", "획득 메소", "기대 메소", "손실률", "획득 조각", "조각 시세", "조각 환산", "상태", ""].map(h =>
        <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
      <tbody>{view.map(({ row, price, value, exp }) => <Fragment key={row.id}>
        <tr className="border-b border-line/60 transition-colors hover:bg-surface-2/60">
          <td className="px-3 py-4">{new Date(row.startedAt).toLocaleString("ko-KR")}{row.plan?.map && <span className="block text-xs text-ink-muted">{row.plan.map}</span>}</td>
          <td className="px-3 py-4 tabular-nums">{duration((row.endedAt ?? row.startedAt) - row.startedAt)}</td>
          <td className="px-3 py-4">{row.small + row.large}개 ({row.small} / {row.large})</td>
          <td className="px-3 py-4 tabular-nums">{number(row.meso)}</td>
          <td className="px-3 py-4 tabular-nums">{number(exp.expected)}{exp.capped && <span className="block text-xs text-ink-faint">일일 한도</span>}</td>
          <td className={`px-3 py-4 font-semibold tabular-nums ${lossClass(exp.loss)}`}>{lossText(exp.loss)}</td>
          <td className="px-3 py-4 tabular-nums">{number(row.fragments)}</td>
          <td className="px-3 py-4 tabular-nums">{price ? <>{number(price.price)} <span className="text-xs text-ink-faint">{price.source}</span></> : <span className="text-ink-faint">시세 없음</span>}</td>
          <td className="px-3 py-4 font-semibold tabular-nums text-accent">{value ? `${number(value)} 메소` : "—"}</td>
          <td className="px-3 py-4 text-ink-muted">{statusText(row)}</td>
          <td className="px-3 py-4"><button className="text-xs text-accent hover:underline" onClick={() => toggle(row.id)}>{open === row.id ? "닫기" : "보정 · 증거 · 삭제"}</button></td>
        </tr>
        {open === row.id && <tr className="border-b border-line/60"><td colSpan={11} className="whitespace-normal px-3 pb-4"><RowDetail row={row} price={price} token={token} onChange={onChange} onDelete={onDelete} /></td></tr>}
      </Fragment>)}</tbody>
    </table></div>
  </>;
}
