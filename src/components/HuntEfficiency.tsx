"use client";

import { useMemo, useState } from "react";
import { capOutlook, dailyMesoCap, EMPTY_PLAN, expectedMeso, levelMesoFactor, MAX_DROP_RATE, MAX_MESO_RATE, MESO_BAG_DROP_THRESHOLD, mesoBagRate, mesoPerKill,
  upgradePlan, type Plan } from "@/services/efficiency";
import type { CharacterInfo } from "@/services/nexon";
import { applyCatalogMap, catalogMonsters, findCatalogMap, searchMaps, searchMonsters, type MapCatalog } from "@/services/map-catalog";
import { EXTRAS, LIMITS, PHANTOM_RANKS, rateTotals, setupKnown, type RatePair, type RateSetup } from "@/services/rates";
import { eok, hoursText, number, smallButton, smallField, smallPrimary } from "./ui";

/** 손실률 표시. 양수는 기대보다 덜 얻은 비율, 음수는 더 얻은 비율. */
export const lossText = (loss: number | null | undefined) =>
  loss == null ? "—" : loss >= 0 ? `${(loss * 100).toFixed(1)}% 손실` : `${(-loss * 100).toFixed(1)}% 초과`;
const percentText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

const panel = "min-w-0 rounded-xl border border-line bg-surface-2 p-4";
const panelTitle = "text-center text-base font-bold tracking-tight";

/** 드롭·메획 한 칸. 왼쪽에 항목 이름, 오른쪽에 %. 빈 칸은 0이고, 수동 설정 칸만 비워 둘 수 있다. */
function RateField({ label, value, max, onChange, nullable = false, step = 1 }: {
  label: string; value: number | null; max: number; onChange: (value: number | null) => void; nullable?: boolean; step?: number;
}) {
  return <label className="flex min-w-0 items-stretch overflow-hidden rounded-lg border border-line-strong bg-surface-1 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
    <span className="grid w-12 shrink-0 place-items-center bg-surface-3 text-xs font-semibold text-ink-muted">{label}</span>
    <input type="number" inputMode="decimal" min={0} max={max} step={step} value={value ?? ""} placeholder={`0~${max}`}
      className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 tabular-nums text-ink outline-none placeholder:text-ink-faint"
      onChange={e => {
        if (e.target.value === "") { onChange(nullable ? null : 0); return; }
        const raw = Number(e.target.value); if (!Number.isFinite(raw)) return;
        onChange(Math.min(max, Math.max(0, raw)));
      }} />
    <span className="grid w-8 shrink-0 place-items-center text-xs text-ink-faint">%</span>
  </label>;
}
function PairFields({ value, limit, onChange }: { value: RatePair; limit: RatePair; onChange: (value: RatePair) => void }) {
  return <>
    <RateField label="드롭" value={value.drop} max={limit.drop} onChange={drop => onChange({ ...value, drop: drop ?? 0 })} />
    <RateField label="메획" value={value.meso} max={limit.meso} onChange={meso => onChange({ ...value, meso: meso ?? 0 })} />
  </>;
}

/** 설정 한 묶음. ×는 그 항목을 계산에서 뺀다. */
function Group({ title, hint, onClear, children }: { title: string; hint?: string; onClear?: () => void; children: React.ReactNode }) {
  return <div className="border-t border-line pt-3 first:border-t-0 first:pt-0">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h4 className="min-w-0 text-sm font-semibold">{title}{hint && <span className="ml-1.5 text-[11px] font-normal text-ink-faint">{hint}</span>}</h4>
      {onClear && <button type="button" aria-label={`${title} 빼기`} title="계산에서 빼기" onClick={onClear}
        className="grid size-6 shrink-0 place-items-center rounded-md border border-line-strong text-xs text-ink-muted hover:bg-surface-3">×</button>}
    </div>
    <div className="space-y-1.5">{children}</div>
  </div>;
}

/** 프리셋·등급 고르기. cols는 버튼 수에 맞춘 grid 클래스다. */
function Choice({ label, cols, options, value, onChange }: {
  label: string; cols: string; value: number | null; onChange: (value: number) => void;
  options: { value: number; text: string; sub?: string; title?: string; disabled?: boolean }[];
}) {
  return <div role="group" aria-label={label} className={`grid gap-1 ${cols}`}>
    {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} title={option.title} disabled={option.disabled}
      onClick={() => onChange(option.value)}
      className={`rounded-lg border px-1 py-1 text-xs font-semibold tabular-nums disabled:opacity-40 ${value === option.value
        ? "border-accent bg-accent/15 text-accent" : "border-line-strong bg-surface-1 text-ink-muted hover:bg-surface-3"}`}>
      {option.text}{option.sub && <span className="block text-[10px] font-normal text-ink-faint">{option.sub}</span>}
    </button>)}
  </div>;
}

/** 소비 아이템·추가 설정 켜고 끄기. */
function Toggle({ on, name, effect, onChange }: { on: boolean; name: string; effect: string; onChange: (on: boolean) => void }) {
  return <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
    className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left text-xs ${on ? "border-accent/60 bg-accent/10" : "border-line-strong bg-surface-1 hover:bg-surface-3"}`}>
    <span aria-hidden className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border text-[10px] ${on ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`}>{on ? "✓" : ""}</span>
    <span className="min-w-0"><span className="block font-semibold text-ink">{name}</span><span className="block text-ink-faint">{effect}</span></span>
  </button>;
}

function Row({ label, value, tone, note }: { label: string; value: string; tone?: "accent" | "warning" | "danger"; note?: string }) {
  const color = tone === "accent" ? "text-accent" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-ink";
  return <div className="flex items-baseline justify-between gap-3 py-1.5">
    <dt className="min-w-0 text-xs text-ink-muted">{label}{note && <span className="block text-[11px] text-ink-faint">{note}</span>}</dt>
    <dd className={`shrink-0 text-right text-sm font-semibold tabular-nums ${color}`}>{value}</dd>
  </div>;
}
const presetSub = (rates: RatePair | undefined) => rates ? `드${rates.drop}·메${rates.meso}` : undefined;

/**
 * 사냥 효율. 기본 설정(넥슨 API로 불러온 출처별 값) · 추가 획득 설정(소비 아이템·추가 효과) · 계산하기(사냥터·결과)의 세 칸이다.
 * 여기서 정한 값이 사냥을 시작할 때 기록에 저장된다.
 */
export default function HuntEfficiency({ plan, onChange, setup, onSetup, info, loading, error, onLoad, mapSeen, active, catalog, catalogError, onReloadMaps, filledToday }: {
  plan: Plan; onChange: (plan: Plan) => void; setup: RateSetup; onSetup: (setup: RateSetup) => void;
  info: CharacterInfo | null; loading: boolean; error: string | null; onLoad: () => void;
  mapSeen: string | null; active: boolean; catalog: MapCatalog | null; catalogError: string | null; onReloadMaps: () => void;
  /** 오늘 앞선 사냥들이 일일 한도에 채운 기본 메소. */
  filledToday: number;
}) {
  const [pick, setPick] = useState<"map" | "monster">("map"); const [query, setQuery] = useState("");
  const monsters = useMemo(() => catalog ? catalogMonsters(catalog) : [], [catalog]);
  const mapResults = useMemo(() => catalog && pick === "map" ? searchMaps(catalog, query, plan.characterLevel) : [], [catalog, pick, query, plan.characterLevel]);
  const monsterResults = useMemo(() => pick === "monster" ? searchMonsters(monsters, query, plan.characterLevel) : [], [monsters, pick, query, plan.characterLevel]);

  const edit = (patch: Partial<RateSetup>) => onSetup({ ...setup, ...patch, origin: "manual" });
  const setPlan = (patch: Partial<Plan>) => onChange({ ...plan, ...patch });
  const totals = rateTotals(setup); const known = setupKnown(setup);
  const presets = info?.presets;

  const bag = mesoBagRate(plan.dropRate); const factor = levelMesoFactor(plan.characterLevel, plan.monsterLevel);
  const perKill = mesoPerKill(plan); const cap = dailyMesoCap(plan.characterLevel); const outlook = capOutlook(plan);
  const half = expectedMeso(plan, 30 * 60_000); const hour = expectedMeso(plan, 60 * 60_000); const twoHours = expectedMeso(plan, 120 * 60_000);
  const kills6m = plan.basis === "mobs" ? (plan.mobCount ? plan.mobCount * 48 : null) : plan.kills6m;
  const selected = plan.mapVersion === catalog?.version ? catalog?.maps.find(map => map.id === plan.mapId) : undefined;
  const left = cap != null ? Math.max(0, cap - filledToday) : null;
  const missingInputs = [!plan.monsterLevel && "몬스터 레벨", !kills6m && "6분 마릿수", plan.mesoRate == null && "메소 획득량(넥슨 API 불러오기 또는 직접 입력)"].filter(Boolean);

  return <section className="min-w-0 rounded-2xl border border-line bg-surface-1 p-5 shadow-card" aria-labelledby="hunt-efficiency">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="hunt-efficiency" className="text-base font-bold tracking-tight">사냥 <span className="text-accent">효율</span></h2>
        <p className="mt-0.5 text-xs text-ink-faint">캐릭터의 장비·어빌리티 프리셋으로 메소 획득량·드롭률을 맞추고 사냥터를 고르면 기대 메소를 계산합니다.{active ? " 지금 사냥에 바로 적용됩니다." : " 사냥을 시작할 때의 값이 기록에 저장됩니다."}</p>
      </div>
      <button className={smallButton} disabled={loading} onClick={onLoad}>{loading ? "불러오는 중…" : "넥슨 API에서 다시 불러오기"}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-warning">{error}</p>}

    {/* 세 칸은 같은 높이로 늘여 한 줄로 보이게 한다(참고 디자인과 같다). */}
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      {/* 기본 설정: 넥슨 API로 불러온 출처별 값. 장비·어빌리티는 메획(같으면 드롭)이 가장 높은 프리셋을 자동으로 고른다. */}
      <div className={panel}>
        <h3 className={panelTitle}>기본 설정</h3>
        <div className="mt-3 rounded-lg bg-surface-1 p-2.5 text-xs text-ink-muted">
          {info ? <p><b className="text-ink">{info.name}</b> · Lv.{info.level ?? "—"} {info.className ?? ""}{info.world ? ` · ${info.world}` : ""}
            <span className="text-ink-faint"> · {new Date(info.fetchedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 조회</span></p>
            : <p>{loading ? "넥슨 API에서 캐릭터 정보를 불러오는 중입니다." : "넥슨 API 정보가 없습니다. 값을 직접 넣을 수 있습니다."}</p>}
          {!!info?.missing.length && <p className="mt-1 text-warning">못 불러온 항목: {info.missing.join(", ")} · 직접 넣으세요.</p>}
          {setup.origin === "manual" && <p className="mt-1">직접 고친 값을 씁니다. 자동 불러오기는 덮지 않습니다. <button type="button" className="text-accent underline-offset-2 hover:underline" disabled={loading} onClick={onLoad}>API 값으로 되돌리기</button></p>}
          <label className="mt-2 flex items-center gap-2">캐릭터 레벨
            <input type="number" inputMode="numeric" min={1} max={300} value={plan.characterLevel ?? ""} className={`${smallField} w-20 tabular-nums text-ink`}
              onChange={e => { const level = e.target.value === "" ? null : Math.min(300, Math.max(1, Math.round(Number(e.target.value)))); if (level === null || Number.isFinite(level)) setPlan({ characterLevel: level, source: "manual" }); }} />
            <span className="text-ink-faint">일일 한도·레벨 차이에 씁니다</span>
          </label>
        </div>
        <div className="mt-3 space-y-3">
          <Group title="장비 (프리셋)" hint="잠재·에디 합계" onClear={() => edit({ equipPreset: null, equip: { drop: 0, meso: 0 } })}>
            <Choice label="장비 프리셋" cols="grid-cols-3" value={setup.equipPreset}
              onChange={n => edit({ equipPreset: n, equip: { drop: presets?.equipment?.[n - 1]?.drop ?? 0, meso: presets?.equipment?.[n - 1]?.meso ?? 0 } })}
              options={[1, 2, 3].map(n => ({ value: n, text: `${n}${presets?.equipmentNow === n ? " (착용)" : ""}`, sub: presetSub(presets?.equipment?.[n - 1]), disabled: !presets?.equipment }))} />
            <PairFields value={setup.equip} limit={LIMITS.equip} onChange={equip => edit({ equip })} />
          </Group>
          <Group title="어빌리티 (프리셋)" onClear={() => edit({ abilityPreset: null, ability: { drop: 0, meso: 0 } })}>
            <Choice label="어빌리티 프리셋" cols="grid-cols-3" value={setup.abilityPreset}
              onChange={n => edit({ abilityPreset: n, ability: { drop: presets?.ability?.[n - 1]?.drop ?? 0, meso: presets?.ability?.[n - 1]?.meso ?? 0 } })}
              options={[1, 2, 3].map(n => ({ value: n, text: `${n}${presets?.abilityNow === n ? " (사용)" : ""}`, sub: presetSub(presets?.ability?.[n - 1]), disabled: !presets?.ability }))} />
            <PairFields value={setup.ability} limit={LIMITS.ability} onChange={ability => edit({ ability })} />
          </Group>
          <Group title="홀리 심볼" hint={info ? info.holySymbol != null ? `쓸만한 홀리 심볼 ${info.holySymbol}%` : "5차 스킬 없음" : undefined}>
            <RateField label="드롭" value={setup.holySymbol} max={LIMITS.holySymbol} onChange={holySymbol => edit({ holySymbol: holySymbol ?? 0 })} />
          </Group>
          <Group title="팬텀 유니온" hint="공격대원 효과" onClear={() => edit({ phantom: 0 })}>
            <Choice label="팬텀 유니온 등급" cols="grid-cols-5" value={setup.phantom || null} onChange={phantom => edit({ phantom })}
              options={PHANTOM_RANKS.map(rank => ({ value: rank.meso, text: rank.rank, sub: `메${rank.meso}`, title: `팬텀 레벨 ${rank.level} 이상 · 메소 획득량 +${rank.meso}%` }))} />
          </Group>
          <Group title="유니온 아티팩트">
            <PairFields value={setup.artifact} limit={LIMITS.artifact} onChange={artifact => edit({ artifact })} />
          </Group>
          <Group title="그랜드 어센틱심볼">
            <PairFields value={setup.grandSymbol} limit={LIMITS.grandSymbol} onChange={grandSymbol => edit({ grandSymbol })} />
          </Group>
        </div>
      </div>

      {/* 추가 획득 설정: 사냥할 때 켜는 소비 아이템과 추가 효과. 재물 획득의 비약은 사냥 기록의 기준이라 늘 켠다. */}
      <div className={panel}>
        <h3 className={panelTitle}>추가 획득 설정</h3>
        <h4 className="mt-3 text-sm font-semibold">소비 아이템</h4>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-start gap-2 rounded-lg border border-accent/60 bg-accent/10 p-2 text-xs">
            <span aria-hidden className="mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-accent bg-accent text-[10px] text-accent-ink">✓</span>
            <span className="min-w-0"><span className="block font-semibold text-ink">재물 획득의 비약 <span className="ml-1 rounded-full bg-accent px-1.5 py-px text-[10px] text-accent-ink">항상 적용</span></span>
              <span className="block text-ink-faint">메소 ×1.2(곱연산) · 아이템 드롭률 +20% · 사냥 기록은 비약 한 차수 단위입니다</span></span>
          </div>
          {EXTRAS.filter(extra => extra.group === "item").map(extra => <Toggle key={extra.key} on={setup.extras[extra.key]} name={extra.name} effect={extra.effect}
            onChange={on => onSetup({ ...setup, extras: { ...setup.extras, [extra.key]: on } })} />)}
        </div>
        <h4 className="mt-4 border-t border-line pt-3 text-sm font-semibold">추가 설정</h4>
        <div className="mt-2 space-y-1.5">
          {EXTRAS.filter(extra => extra.group === "extra").map(extra => <Toggle key={extra.key} on={setup.extras[extra.key]} name={extra.name} effect={extra.effect}
            onChange={on => onSetup({ ...setup, extras: { ...setup.extras, [extra.key]: on } })} />)}
        </div>
        <dl className="mt-4 rounded-lg bg-surface-1 p-3 text-xs text-ink-muted">
          <div className="flex justify-between gap-2"><dt>합연산 드롭률</dt><dd className="tabular-nums text-ink">{percentText(totals.sumDrop)} + 비약 20%</dd></div>
          <div className="mt-1 flex justify-between gap-2"><dt>합연산 메소 획득량</dt><dd className="tabular-nums text-ink">{percentText(totals.sumMeso)} → ×1.2</dd></div>
          {(setup.manualDrop != null || setup.manualMeso != null) && <p className="mt-2 text-warning">수동 설정 값이 있어 위 합계 대신 그 값을 씁니다.</p>}
        </dl>
      </div>

      {/* 계산하기: 사냥터·몬스터를 고르고 결과를 본다. 값이 바뀌면 바로 다시 계산한다. */}
      <div className={panel}>
        <h3 className={panelTitle}>계산하기</h3>
        <div className="mt-3 grid grid-cols-2 gap-1" role="group" aria-label="고르는 방식">
          {([["map", "사냥터 선택"], ["monster", "몬스터 선택"]] as const).map(([mode, label]) =>
            <button key={mode} type="button" aria-pressed={pick === mode} onClick={() => { setPick(mode); setQuery(""); }}
              className={pick === mode ? smallPrimary : smallButton}>{label}</button>)}
        </div>
        <div className="mt-2 flex gap-1.5">
          <input aria-label={pick === "map" ? "사냥터 검색" : "몬스터 검색"} className={`${smallField} min-w-0 flex-1`} value={query} onChange={e => setQuery(e.target.value)}
            placeholder={pick === "map" ? "사냥터·지역 이름 (예: 거대 산호 군락)" : "몬스터 이름"} />
          <button type="button" className={smallButton} onClick={onReloadMaps} title="공유 사냥터 목록을 다시 불러옵니다">새로고침</button>
        </div>
        {catalogError && <p role="alert" className="mt-2 text-xs text-warning">{catalogError}</p>}
        <ul className="mt-2 h-52 overflow-y-auto rounded-lg border border-line bg-surface-1 text-xs" aria-label={pick === "map" ? "사냥터 검색 결과" : "몬스터 검색 결과"}>
          {!catalog ? <li className="p-3 text-ink-faint">사냥터 목록을 불러오는 중입니다.</li>
            : !catalog.maps.length ? <li className="p-3 text-ink-faint">등록된 사냥터 데이터가 없습니다. 아래에 몬스터 레벨과 6분 마릿수를 직접 넣으세요.</li>
            : pick === "map" ? mapResults.length ? mapResults.map(({ map, share, factor }) =>
              <li key={map.id}><button type="button" onClick={() => onChange(applyCatalogMap(plan, map, catalog.version))}
                className={`flex w-full items-center justify-between gap-2 border-b border-line/60 px-3 py-2 text-left hover:bg-surface-3 ${plan.mapId === map.id ? "bg-accent/10" : ""}`}>
                <span className="min-w-0"><span className="block font-medium text-ink">Lv.{Number.isInteger(map.monsterLevel) ? map.monsterLevel : map.monsterLevel.toFixed(1)} | {map.name} ({map.mobCount})</span>
                  <span className="block text-ink-faint">{map.streetName ?? ""}{factor < 100 ? ` · 레벨 차이 ${factor}%` : ""}</span></span>
                <span className={`shrink-0 tabular-nums ${share >= 0.999 ? "font-bold text-accent" : share > 0.95 ? "text-success" : share > 0.85 ? "text-warning" : "text-ink-faint"}`}>{Math.round(share * 100)}%</span>
              </button></li>)
              : <li className="p-3 text-ink-faint">{query.trim() ? "검색 결과가 없습니다." : "캐릭터 레벨을 넣으면 레벨 차이 배율 100%인 사냥터를 메소 순으로 보여줍니다."}</li>
            : monsterResults.length ? monsterResults.map(mob =>
              <li key={mob.id}><button type="button" onClick={() => setPlan({ monsterLevel: mob.level, mapId: undefined, mapVersion: undefined })}
                className={`flex w-full items-center justify-between gap-2 border-b border-line/60 px-3 py-2 text-left hover:bg-surface-3 ${plan.monsterLevel === mob.level && !plan.mapId ? "bg-accent/10" : ""}`}>
                <span className="min-w-0 font-medium text-ink">Lv.{mob.level} | {mob.name}</span>
                <span className="shrink-0 text-ink-faint">사냥터 {mob.maps}곳</span>
              </button></li>)
              : <li className="p-3 text-ink-faint">{query.trim() ? "검색 결과가 없습니다." : "캐릭터 레벨을 넣으면 ±10레벨 몬스터를 보여줍니다."}</li>}
        </ul>
        {pick === "map" && !!mapResults.length && <p className="mt-1 text-[11px] text-ink-faint">오른쪽 %는 목록 1위 대비 1젠당 메소입니다. 선택하면 몬스터 레벨과 1젠 몬스터 수가 채워집니다.</p>}

        <div className="mt-3 space-y-2 rounded-lg bg-surface-1 p-3">
          <label className="block text-xs text-ink-muted">사냥터
            <input className={`${smallField} mt-1 block w-full text-ink`} maxLength={40} placeholder="미니맵의 사냥터 이름" value={plan.map ?? ""}
              onChange={e => setPlan({ map: e.target.value.trim() ? e.target.value : null, mapId: undefined, mapVersion: undefined })} />
          </label>
          {selected && <p className="text-[11px] text-ink-faint">{selected.streetName ? `${selected.streetName} · ` : ""}1젠 {selected.mobCount}마리{selected.monsters ? ` · ${selected.monsters.map(mob => `${mob.name} Lv.${mob.level}`).join(", ")}` : ""}</p>}
          {mapSeen && mapSeen !== plan.map && <button type="button" className={smallButton} onClick={() => {
            // 공유 사냥터 목록에 있으면 그 레벨·몹 수까지 채운다.
            const found = catalog ? findCatalogMap(catalog, mapSeen) : null;
            onChange(found && catalog ? applyCatalogMap(plan, found, catalog.version)
              : { ...plan, map: mapSeen, monsterLevel: null, mobCount: null, kills6m: null, mapId: undefined, mapVersion: undefined });
          }}>화면에서 읽은 사냥터 적용: {mapSeen}</button>}
          <label className="block text-xs text-ink-muted">몬스터 레벨
            <span className="mt-1 flex items-center gap-1.5">
              <input type="number" inputMode="decimal" min={1} max={300} step={0.01} value={plan.monsterLevel ?? ""} className={`${smallField} w-full tabular-nums text-ink`} placeholder="몬스터 선택 또는 직접 입력"
                onChange={e => { const raw = e.target.value === "" ? null : Math.min(300, Math.max(1, Number(e.target.value))); if (raw === null || Number.isFinite(raw)) setPlan({ monsterLevel: raw, mapId: undefined, mapVersion: undefined }); }} />
              <span className="shrink-0">레벨</span>
            </span>
          </label>
          <label className="block text-xs text-ink-muted">6분 마릿수
            <span className="mt-1 flex items-center gap-1.5">
              <input type="number" inputMode="numeric" min={1} max={100_000} value={kills6m ?? ""} className={`${smallField} w-full tabular-nums text-ink`} placeholder="6분 동안 잡는 마릿수"
                onChange={e => { const raw = e.target.value === "" ? null : Math.min(100_000, Math.max(1, Math.round(Number(e.target.value)))); if (raw === null || Number.isFinite(raw)) setPlan({ basis: "kills6m", kills6m: raw }); }} />
              <span className="shrink-0">마리/6분</span>
            </span>
            <span className="mt-1 block text-[11px] text-ink-faint">{plan.basis === "mobs" && plan.mobCount ? `1젠 ${plan.mobCount}마리 × 48 (7.5초마다 전부 처치 가정)` : "전투 분석의 6분 마릿수를 넣으면 더 정확합니다."}</span>
          </label>
        </div>

        <div className="mt-3 space-y-1.5 rounded-lg bg-surface-1 p-3">
          <p className="text-center text-xs font-semibold">드롭/메소 획득량 수동 설정</p>
          <RateField label="드롭" value={setup.manualDrop} max={MAX_DROP_RATE} nullable onChange={manualDrop => onSetup({ ...setup, manualDrop })} />
          <RateField label="메획" value={setup.manualMeso} max={MAX_MESO_RATE} step={0.1} nullable onChange={manualMeso => onSetup({ ...setup, manualMeso })} />
          <p className="text-[11px] leading-snug text-ink-faint">※ 수동 값이 있으면 왼쪽의 선택·입력 값 대신 씁니다. 메획은 재물 획득의 비약까지 곱한 최종 값입니다.<br />※ 게임 최대치(드롭 {MAX_DROP_RATE}%, 메획 {MAX_MESO_RATE}%)를 넘으면 최대치까지만 반영합니다.</p>
        </div>

        <div className="mt-3 rounded-lg border border-accent/40 bg-surface-1 p-3">
          <p className="text-center text-sm font-bold">계산 결과</p>
          <dl className="mt-1 divide-y divide-line/60">
            <Row label="아이템 드롭률" value={plan.dropRate != null ? percentText(plan.dropRate) : "—"} note={totals.dropCapped ? `최대 ${MAX_DROP_RATE}%로 반영` : undefined} />
            <Row label="메소 획득량" value={plan.mesoRate != null ? percentText(plan.mesoRate) : "—"} note={totals.mesoCapped ? `최대 ${MAX_MESO_RATE}%로 반영` : "재물 획득의 비약 포함"} />
            <Row label="메소 주머니 드롭률" value={percentText(Math.round(bag * 1000) / 10)} tone={bag < 0.9 ? "danger" : bag < 1 ? "warning" : undefined}
              note={plan.dropRate == null ? `드롭률을 모르면 ${MESO_BAG_DROP_THRESHOLD}% 초과(100%)로 봅니다` : bag < 1 ? `드롭률 ${MESO_BAG_DROP_THRESHOLD}% 초과면 100%` : undefined} />
            <Row label="레벨 차이 배율" value={factor != null ? `${factor}%` : "—"} tone={factor != null && factor < 100 ? "warning" : undefined}
              note={plan.characterLevel != null && plan.monsterLevel != null ? `캐릭터 Lv.${plan.characterLevel} · 몬스터 Lv.${number(plan.monsterLevel)}` : undefined} />
            <Row label="마리당 메소" value={perKill != null ? number(Math.round(perKill)) : "—"} />
            <Row label="30분 획득 메소" value={half ? `약 ${eok(half.expected)}` : "—"} />
            <Row label="시간당 획득 메소" value={hour ? `약 ${eok(hour.expected)}` : "—"} tone="accent" />
            <Row label="1재획(2시간) 획득 메소" value={twoHours ? `약 ${eok(twoHours.expected)}` : "—"} note={twoHours?.capped ? "일일 한도에서 멈춤" : undefined} />
            <Row label="일일 메소 제한" value={cap != null ? eok(cap) : "—"} note="메획 적용 전 기본 메소 기준" />
            <Row label="메소제한까지 획득 시 메소" value={outlook ? `약 ${eok(outlook.meso)}` : "—"} />
            <Row label="메소제한까지 걸리는 시간" value={outlook ? `약 ${hoursText(outlook.timeMs)}` : "—"} />
            {filledToday > 0 && cap != null && <Row label="오늘 채운 한도" value={`${eok(filledToday)} / ${eok(cap)}`}
              note={left != null && outlook ? left > 0 ? `남은 한도까지 약 ${hoursText(outlook.timeMs * left / cap)}` : "오늘 한도를 모두 채웠습니다" : "오늘 기록 기준 추정"} tone={left === 0 ? "warning" : undefined} />}
          </dl>
          {!known && setup.manualMeso == null && <p className="mt-2 text-xs text-warning">메소 획득량을 모릅니다. 넥슨 API에서 불러오거나 값을 직접 넣으세요.</p>}
          {!!missingInputs.length && (known || setup.manualMeso != null) && <p className="mt-2 text-xs text-ink-muted">{missingInputs.join(" · ")} 값이 있어야 기대 메소를 계산합니다.</p>}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-faint">마리당 메소 = 몬스터 레벨 × 7.5 × 주머니 확률(60% × (1 + 드롭률), 최대 100%) × (1 + 메소 획득량) × 레벨 차이 배율. 일일 한도는 메획·레벨 차이를 적용하기 전의 기본 메소로 찹니다.</p>
      </div>
    </div>
  </section>;
}

function NumberField({ label, value, onChange, min, max, step = 1, integer = false, suffix, hint }: {
  label: string; value: number | null; onChange: (value: number | null) => void; min: number; max: number;
  step?: number; integer?: boolean; suffix?: string; hint?: string;
}) {
  return <label className="block text-xs text-ink-muted">{label}
    <span className="mt-1 flex items-center gap-1.5">
      <input type="number" inputMode={integer ? "numeric" : "decimal"} min={min} max={max} step={step} value={value ?? ""}
        className={`${smallField} w-full tabular-nums text-ink`}
        onChange={e => {
          if (e.target.value === "") { onChange(null); return; }
          const raw = Number(e.target.value); if (!Number.isFinite(raw)) return;
          // 서버가 받는 범위로 맞춘다. 범위를 벗어나면 기록 저장이 거부되기 때문이다.
          onChange(Math.min(max, Math.max(min, integer ? Math.round(raw) : raw)));
        }} />
      {suffix && <span className="shrink-0">{suffix}</span>}
    </span>
    {hint && <span className="mt-1 block text-[11px] leading-snug text-ink-faint">{hint}</span>}
  </label>;
}

/**
 * 저장된 기록의 계산 조건 고치기. 사냥터·몬스터 정보를 나중에 알게 됐을 때 쓴다.
 * 예전 방식(비약 제외 메획)의 기록은 열 때 지금 방식(비약 포함 최종 값)으로 바꿔 보여준다.
 */
export function PlanEditor({ plan, onSave }: { plan: Plan | undefined; onSave: (plan: Plan) => void }) {
  const [draft, setDraft] = useState<Plan>(() => upgradePlan(plan ?? EMPTY_PLAN));
  const set = (patch: Partial<Plan>) => setDraft({ ...draft, ...patch });
  const factor = levelMesoFactor(draft.characterLevel, draft.monsterLevel);
  return <div className="mt-3 rounded-xl border border-line p-3">
    <p className="text-xs font-semibold text-ink-muted">기대 메소 계산 조건</p>
    {draft.mapId && <p className="mt-1 text-xs text-ink-faint">저장 당시 데이터: {draft.mapVersion} · 맵 {draft.mapId}</p>}
    {plan && plan.formula !== 2 && <p className="mt-1 text-xs text-ink-faint">예전 방식으로 저장된 기록입니다. 메획은 비약 ×1.2를 곱한 값, 드롭률은 비약 20%를 더한 값으로 바꿔 보여줍니다.</p>}
    <div className="mt-2 grid gap-3 sm:grid-cols-3">
      <label className="block text-xs text-ink-muted">사냥터
        <input className={`${smallField} mt-1 block w-full text-ink`} maxLength={40} value={draft.map ?? ""} onChange={e => set({ map: e.target.value.trim() ? e.target.value : null, mapId: undefined, mapVersion: undefined })} />
      </label>
      <NumberField label="캐릭터 레벨" value={draft.characterLevel} min={1} max={300} integer onChange={characterLevel => set({ characterLevel })} />
      <NumberField label="몬스터 레벨 (혼합 맵은 평균)" value={draft.monsterLevel} min={1} max={300} step={0.01} onChange={monsterLevel => set({ monsterLevel, mapId: undefined, mapVersion: undefined })} />
      <NumberField label="메소 획득량 (비약 포함 최종)" value={draft.mesoRate} min={0} max={MAX_MESO_RATE} step={0.1} suffix="%" onChange={mesoRate => set({ mesoRate })} />
      <NumberField label="아이템 드롭률 (비약 포함)" value={draft.dropRate} min={0} max={MAX_DROP_RATE} step={0.1} suffix="%" onChange={dropRate => set({ dropRate })}
        hint={`${MESO_BAG_DROP_THRESHOLD}% 이하이면 메소 주머니가 덜 떨어집니다.`} />
      {draft.basis === "mobs"
        ? <NumberField label="1젠당 몬스터 수" value={draft.mobCount} min={1} max={500} integer suffix="마리" onChange={mobCount => set({ mobCount, mapId: undefined, mapVersion: undefined })}
          hint="6분 마릿수 = 1젠당 몬스터 수 × 48" />
        : <NumberField label="6분 마릿수" value={draft.kills6m} min={1} max={100_000} integer suffix="마리" onChange={kills6m => set({ kills6m })} />}
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <span>처치 기준</span>
      {([["mobs", "1젠 몬스터 수"], ["kills6m", "6분 마릿수"]] as const).map(([basis, label]) =>
        <button key={basis} type="button" aria-pressed={draft.basis === basis} className={draft.basis === basis ? smallPrimary : smallButton} onClick={() => set({ basis })}>{label}</button>)}
      <span className="ml-auto">레벨 차이 배율 {factor ?? 100}% (자동)</span>
    </div>
    <button className={`${smallPrimary} mt-3`} onClick={() => onSave({ ...draft, formula: 2, levelFactor: factor ?? 100, source: draft.source ?? "manual" })}>조건 저장</button>
  </div>;
}
