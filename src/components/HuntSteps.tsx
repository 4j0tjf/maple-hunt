import { PRE_START_MS, type Hunt, type Seen } from "@/services/domain";
import { card, number } from "./ui";

type Step = { title: string; body: string; done: boolean; current: boolean; detail?: string };

/**
 * 사냥 순서 안내. 지금 상태로 어느 단계인지 표시한다.
 * 스캔 시작 → 사냥 전 수량 확인 → 재물 획득의 비약 사용 → 종료 수량 확인.
 * 오른쪽 사이드바에 세로로 놓여 스캔 화면을 보면서 따라갈 수 있다.
 */
export default function HuntSteps({ loggedIn, running, seen, active, now, children }: {
  loggedIn: boolean; running: boolean; seen: Seen; active: Hunt | null; now: number; children?: React.ReactNode;
}) {
  const fresh = (entry: Seen["meso"]) => entry && now - entry.at <= PRE_START_MS ? entry : null;
  const meso = fresh(seen.meso); const fragments = fresh(seen.fragments);
  const checked = active ? active.baseline?.meso != null && active.baseline.fragments != null : !!meso && !!fragments;
  const oldest = Math.min(meso?.at ?? Infinity, fragments?.at ?? Infinity);
  const left = Number.isFinite(oldest) ? Math.max(0, Math.ceil((oldest + PRE_START_MS - now) / 1000)) : 0;
  const steps: Step[] = [
    { title: "스캔 시작", body: "‘스캔 시작’을 누르고 메이플 창을 선택하세요. 게임의 버프 시간은 ‘분+초’로 표시하세요.",
      done: running, current: loggedIn && !running },
    { title: "사냥 전 수량 확인", body: "비약을 쓰기 전에 인벤토리(기타 탭)를 열어 메소와 솔 에르다 조각이 보이게 두세요.",
      done: checked, current: running && !active && !checked,
      detail: active ? undefined : meso || fragments
        ? `확인됨 · 메소 ${number(meso?.value)} · 조각 ${number(fragments?.value)}${meso && fragments ? ` · ${Math.floor(left / 60)}분 ${left % 60}초 안에 비약을 사용하세요` : " · 나머지 항목도 보이게 해 주세요"}`
        : undefined },
    { title: "재물 획득의 비약 사용", body: "소형·일반 비약을 쓰면 사냥 시간이 시작됩니다. 이미 쓴 비약은 ‘사용 보정’으로 시작하세요.",
      done: !!active, current: running && !active && checked },
    { title: "종료 수량 확인", body: "비약이 끝나면 알림이 옵니다. 인벤토리를 열면 종료 수량과 화면이 자동으로 저장됩니다.",
      done: false, current: active?.status === "finishing" },
  ];
  return <section className={card} aria-labelledby="hunt-steps">
    <h2 id="hunt-steps" className="text-base font-bold tracking-tight">사냥 <span className="text-accent">순서</span></h2>
    <ol className="mt-4 space-y-1">
      {steps.map((step, index) => <li key={step.title} aria-current={step.current ? "step" : undefined}
        className={`relative flex gap-3 rounded-xl p-2.5 ${step.current ? "bg-accent/10 ring-1 ring-accent/40" : ""}`}>
        <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${step.current ? "bg-accent text-accent-ink"
          : step.done ? "bg-success/15 text-success" : "bg-surface-2 text-ink-faint ring-1 ring-line"}`}>{step.done ? "✓" : index + 1}</span>
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${step.done && !step.current ? "text-ink-muted" : "text-ink"}`}>
            {step.title}
            {step.current && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-[11px] font-semibold text-accent-ink">지금</span>}
            <span className="sr-only">{step.done ? " (완료)" : ""}</span>
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{step.body}</p>
          {step.detail && <p className="mt-1.5 text-xs font-semibold text-accent tabular-nums">{step.detail}</p>}
        </div>
      </li>)}
    </ol>
    {children}
  </section>;
}
