import { DURATION, PRE_START_MS, type Hunt, type Potion, type Seen } from "@/services/domain";
import type { Expectation } from "@/services/efficiency";
import { lossText } from "./HuntEfficiency";
import { button, card, duration, number, primary } from "./ui";

const POTION: Record<Potion, string> = { small: "소형 재물 획득의 비약", large: "재물 획득의 비약" };

function Amounts({ rows }: { rows: [string, string][] }) {
  return <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
    {rows.map(([label, value]) => <div key={label}><dt className="text-xs text-ink-faint">{label}</dt><dd className="mt-0.5 font-medium tabular-nums">{value}</dd></div>)}
  </dl>;
}

/**
 * 지금 사냥 한 차수. 대기 중 · 사냥 중 · 종료 수량 확인 중에 따라 필요한 것만 보여준다.
 * children에는 기록되지 않은 보유량 직접 입력이 들어온다.
 */
export default function CurrentHunt({ active, now, running, seen, value, expectation, onStart, onFinish, onSave, children }: {
  active: Hunt | null; now: number; running: boolean; seen: Seen; value: string | null; expectation: Expectation | null;
  onStart: (potion: Potion) => void; onFinish: () => void; onSave: () => void; children?: React.ReactNode;
}) {
  const correction = (label: string) => <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
    <span>{label}</span>
    <button className={button} onClick={() => onStart("small")}>소형 사용 보정</button>
    <button className={button} onClick={() => onStart("large")}>일반 사용 보정</button>
  </div>;

  if (!active) {
    const fresh = (entry: Seen["meso"]) => entry && now - entry.at <= PRE_START_MS ? entry.value : null;
    const meso = fresh(seen.meso); const fragments = fresh(seen.fragments);
    return <section className={card}>
      <h2 className="text-base font-bold tracking-tight">현재 <span className="text-accent">사냥</span></h2>
      <p className="mt-4 text-2xl font-semibold text-ink-muted">대기 중</p>
      <p className="mt-2 text-sm text-ink-muted">{running ? "사냥 전 수량을 확인하고 재물 획득의 비약을 사용하면 시작됩니다." : "화면을 연결하면 재물 획득의 비약 사용을 감지합니다."}</p>
      {(meso != null || fragments != null) && <p className="mt-3 text-sm">사냥 전 확인 수량 · 메소 <span className="tabular-nums">{number(meso)}</span> · 조각 <span className="tabular-nums">{number(fragments)}</span></p>}
      {running && correction("이미 비약을 쓴 상태라면")}
    </section>;
  }

  const source = active.source === "automatic" ? "자동 감지" : "수동 시작";
  if (active.status === "hunting") {
    const left = Math.max(0, active.expiresAt - now);
    const ratio = Math.min(1, left / DURATION[active.potion]);
    return <section className={card}>
      <div className="flex items-center justify-between gap-3"><h2 className="text-base font-bold tracking-tight">현재 <span className="text-accent">사냥</span></h2><span className="text-xs text-ink-faint">{active.character ?? "캐릭터 미확인"} · {source}</span></div>
      <p className="mt-4 text-xs text-ink-faint">사냥 시간</p>
      <p className="text-4xl font-semibold tabular-nums">{duration(now - active.startedAt)}</p>
      <div className="mt-4" role="progressbar" aria-label="비약 남은 시간" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <div className="h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${ratio * 100}%` }} /></div>
        <p className="mt-2 text-sm text-ink-muted"><span className="tabular-nums">{duration(left)}</span> 남음 · {POTION[active.potion]} · 사용 소형 {active.small} / 일반 {active.large}</p>
      </div>
      <Amounts rows={[["시작 메소", number(active.baseline?.meso)], ["시작 조각", number(active.baseline?.fragments)],
        ["기대 메소 (지금까지)", expectation?.expected != null ? number(expectation.expected) : "—"]]} />
      {expectation?.expected == null && <p className="mt-2 text-xs text-ink-faint">사냥 효율 카드에 몬스터 레벨·메소 획득량·몹 수를 넣으면 기대 메소가 표시됩니다.</p>}
      <div className="mt-4"><button className={button} onClick={onFinish}>사냥 종료</button></div>
      {children}
      {running && correction("비약을 다시 썼는데 감지되지 않았다면")}
    </section>;
  }

  const secondsLeft = Math.max(0, Math.ceil(((active.endedAt ?? now) + 60_000 - now) / 1000));
  return <section className={`${card} border-accent/60`}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-bold tracking-tight">현재 <span className="text-accent">사냥</span></h2><span className="text-xs text-ink-faint">{active.character ?? "캐릭터 미확인"} · {source}</span></div>
    <p className="mt-4 text-2xl font-semibold text-accent">종료 수량 확인 중</p>
    <p className="mt-2 text-sm text-ink-muted">인벤토리를 열어 메소와 조각이 보이게 해 주세요. <span className="tabular-nums">{secondsLeft}</span>초 뒤 자동으로 저장합니다.</p>
    <Amounts rows={[
      ["사냥 시간", duration((active.endedAt ?? now) - active.startedAt)], ["시작 메소", number(active.baseline?.meso)], ["종료 메소", number(active.final?.meso)],
      ["조각 환산", value ? `${number(value)} 메소` : "—"], ["시작 조각", number(active.baseline?.fragments)], ["종료 조각", number(active.final?.fragments)],
      ["획득 메소", number(active.meso)], ["획득 조각", number(active.fragments)],
      ["기대 메소", expectation?.expected != null ? `${number(expectation.expected)}${expectation.capped ? " (일일 한도)" : ""}` : "—"], ["손실률", lossText(expectation?.loss)],
    ]} />
    <div className="mt-4"><button className={primary} onClick={onSave}>지금 저장</button></div>
    {children}
  </section>;
}
