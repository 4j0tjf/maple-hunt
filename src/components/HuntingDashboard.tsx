"use client";

import { useEffect, useRef, useState } from "react";
import { addPotion, createHunt, DURATION, finishHunt, fragmentValue, koreaDay, noteInventory, NOTHING_SEEN, observeInventory, saveHunt, withPreStart,
  type Hunt, type Potion, type Seen } from "@/services/domain";
import { captureFrame, crop, deleteRecording, download, getRecordings, Recognition, recordingBlob, ROLES, screenshot, signature, startRecording, steadyInterval, VIDEO,
  type Calibration, type Recording, type Region, type Role } from "@/services/browser";
import { api, ApiError, LEGACY_RECORDS, loadManualPrice, loadPlanStore, loadSession, planFrom, readOutbox, rememberPlan, storeManualPrice, storePlanStore, storeSession, writeOutbox,
  type HuntRow, type PlanStore, type Session } from "@/services/client";
import { EMPTY_PLAN, expectations, filledOn, lossRate, mapKey, type Plan } from "@/services/efficiency";
import { applyRates, EMPTY_SETUP, setupFromApi, type RateSetup } from "@/services/rates";
import type { CharacterInfo } from "@/services/nexon";
import { applyCatalogMap, findCatalogMap, type MapCatalog } from "@/services/map-catalog";
import type { EvidenceKind } from "@/services/records";
import { apiUrl } from "@/base-path";
import CurrentHunt from "./CurrentHunt";
import HuntEfficiency from "./HuntEfficiency";
import HuntHelp from "./HuntHelp";
import HuntLogin, { HuntAccount } from "./HuntLogin";
import HuntSteps from "./HuntSteps";
import HuntRecords, { MissingInputs, PriceInput, RecordSummary, type Price } from "./HuntRecords";
import { button, card, duration, number, primary, QUOTE_STATUS, smallButton } from "./ui";

const ACTIVE = "maple-hunting-active-v1";
const CONFIG = "maple-hunting-calibration-v1";
const VIDEO_PREF = "maple-hunting-video-v1";
const REJECTED = "maple-hunting-rejected-v1";
/** 페이지 안의 탭. 기록 목록은 주소 끝 #records로 바로 열 수 있다. */
const TABS = [["hunt", "사냥"], ["records", "기록 목록"]] as const;
type Tab = (typeof TABS)[number][0];
/** 사냥 시작 후 이 시간 안에 새로 확정된 사냥터는 그 사냥의 사냥터로 바꾼다(비약을 쓰고 사냥터에 들어온 경우). */
const MAP_SETTLE_MS = 3 * 60_000;
type Quote = { status: string; average: string | null; sales?: number; quantity?: string; capturedAt?: string; basis?: string; truncated?: boolean; error?: string };
type Outbox = ReturnType<typeof readOutbox>;
type Evidence = { huntId: string; kind: EvidenceKind; image: Blob; tries: number };
/** 서버 응답에 붙은 표시용 필드를 떼고 Hunt만 남긴다. */
const plain = (row: HuntRow): Hunt => { const { auctionPrice: _a, evidence: _e, pending: _p, ...hunt } = row; void _a; void _e; void _p; return hunt; };
const upsertRow = (rows: HuntRow[], hunt: Hunt): HuntRow[] => {
  const previous = rows.find(row => row.id === hunt.id);
  return [{ ...previous, ...hunt, pending: false }, ...rows.filter(row => row.id !== hunt.id)].sort((a, b) => b.startedAt - a.startedAt);
};
const sameAmounts = (a: Hunt["baseline"], b: Hunt["baseline"]) => a?.meso === b?.meso && a?.fragments === b?.fragments;

/** 사냥에 꼭 필요한 인식 영역. 다른 종류 버프 아이콘·시간은 선택이다. */
const REQUIRED: Role[] = ["buffArea", "buffIcon", "timer", "character", "inventory", "meso", "fragmentIcon", "fragments"];
const shortRole = (role: Role) => ROLES[role].replace(/ \(.*\)$/, "");
function RegionSummary({ config }: { config: Calibration | null }) {
  const missing = REQUIRED.filter(role => !config?.regions[role]);
  return <details className="mt-4 text-sm">
    <summary className={`cursor-pointer ${missing.length ? "text-ink-muted" : "text-accent"}`}>
      {missing.length === REQUIRED.length ? "저장된 보정 영역 없음 · 자동 인식에는 필요하지 않습니다"
        : missing.length ? `인식 영역 ${REQUIRED.length - missing.length}/${REQUIRED.length} 지정 · 남은 항목: ${missing.map(shortRole).join(", ")}` : `✓ 인식 영역 지정 완료 (${REQUIRED.length}/${REQUIRED.length})`}
    </summary>
    <div className="mt-3 flex flex-wrap gap-2">{Object.entries(ROLES).map(([key, label]) => <span key={key} className={`rounded-full border px-3 py-1 text-xs ${config?.regions[key as Role] ? "border-accent/30 text-accent" : "border-line text-ink-faint"}`}>{config?.regions[key as Role] ? "✓ " : "○ "}{label}</span>)}</div>
  </details>;
}

export default function HuntingDashboard() {
  const lastFrame = useRef<HTMLCanvasElement | null>(null); const scanPreview = useRef<HTMLCanvasElement>(null); const preview = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recognition = useRef(new Recognition()); const configRef = useRef<Calibration | null>(null);
  const scanReady = useRef(false); const connecting = useRef(false); const scanGeneration = useRef(0); const manualMode = useRef(false);
  const current = useRef<Hunt | null>(null);
  const sessionRef = useRef<Session | null>(null); const characterRef = useRef<Session["character"] | null>(null);
  const busy = useRef(false); const calibrating = useRef(false);
  const sound = useRef<AudioContext | null>(null);
  const mounted = useRef(true); const lastObservation = useRef(0); const ocrName = useRef<string | null>(null);
  const sent = useRef(new Map<string, string>()); const flushing = useRef(false); const flushAgain = useRef(false);
  /** 이 화면에서 지운 기록. 업로드 대기열·업로드 도중인 기록이 지운 뒤 다시 올라가 되살아나지 않게 한다. */
  const deleted = useRef(new Set<string>());
  const evidence = useRef<Evidence[]>([]); const seen = useRef<Seen>(NOTHING_SEEN);
  const videoOn = useRef(false); const videoRec = useRef<{ id: string; huntId: string; stop: () => Promise<void> } | null>(null); const videoBusy = useRef(false);
  const quoteRef = useRef<Quote>({ status: "NOT_REQUESTED", average: null }); const manualPriceRef = useRef<string | null>(null);
  // 기대 메소 계산 조건. 스캔 도중(비동기) 읽으므로 최신 값은 ref에도 둔다.
  const planStore = useRef<PlanStore | null>(null); const planRef = useRef<Plan>(EMPTY_PLAN); const mapSeenRef = useRef<string | null>(null); const mapStreetRef = useRef<string | null>(null);
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN); const [mapSeen, setMapSeen] = useState<string | null>(null);
  // 메획·아획 출처별 설정(기본 설정·추가 획득 설정). 계산 조건의 메획·아획은 여기서 나온다.
  const setupRef = useRef<RateSetup>(EMPTY_SETUP); const [setup, setSetup] = useState<RateSetup>(EMPTY_SETUP);
  const [tab, setTab] = useState<Tab>("hunt");
  const catalogRef = useRef<MapCatalog | null>(null);
  const [catalog, setCatalog] = useState<MapCatalog | null>(null); const [catalogError, setCatalogError] = useState<string | null>(null);
  const [charInfo, setCharInfo] = useState<CharacterInfo | null>(null); const [charLoading, setCharLoading] = useState(false); const [charError, setCharError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null); const [rows, setRows] = useState<HuntRow[]>([]); const [outbox, setOutbox] = useState<Outbox>({});
  const [active, setActive] = useState<Hunt | null>(null);
  const [config, setConfig] = useState<Calibration | null>(null); const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false); const [useCalibration, setUseCalibration] = useState(false);
  const [message, setMessage] = useState("캐릭터로 로그인한 뒤 화면을 연결하세요.");
  const [diagnostic, setDiagnostic] = useState(""); const [frozen, setFrozen] = useState(false); const [syncError, setSyncError] = useState("");
  const [role, setRole] = useState<Role>("buffArea"); const [now, setNow] = useState(0);
  const [videos, setVideos] = useState<Recording[]>([]); const [recordVideo, setRecordVideo] = useState(false);
  const [quote, setQuote] = useState<Quote>({ status: "NOT_REQUESTED", average: null }); const [manualPrice, setManualPrice] = useState<string | null>(null);
  const [legacyCount, setLegacyCount] = useState(0); const [canCapture, setCanCapture] = useState(true); const [seenView, setSeen] = useState<Seen>(NOTHING_SEEN);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const problem = (error: unknown) => setMessage(error instanceof Error ? error.message : String(error));
  quoteRef.current = quote; manualPriceRef.current = manualPrice;

  function notify(text: string) {
    setMessage(text);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("메이플 사냥 기록", { body: text });
    const ctx = sound.current;
    if (ctx && ctx.state === "running") {
      const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.frequency.value = 740; gain.gain.setValueAtTime(0.15, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      oscillator.start(); oscillator.stop(ctx.currentTime + 0.6);
    }
  }
  function changeOutbox(change: (box: Outbox) => void) {
    const box = readOutbox(); change(box);
    try { writeOutbox(box); } catch { setSyncError("브라우저 저장 공간이 부족해 업로드 대기 기록을 보관하지 못했습니다."); }
    if (mounted.current) setOutbox(box);
  }
  /** 바뀐 기록만 업로드 대기열에 넣는다. 인식 주기마다 부르지만 내용이 같으면 아무것도 하지 않는다. */
  function queue(hunt: Hunt) {
    const characterId = characterRef.current?.id ?? sessionRef.current?.character.id; if (!characterId || deleted.current.has(hunt.id)) return;
    const text = JSON.stringify(hunt);
    if (sent.current.get(hunt.id) === text || JSON.stringify(readOutbox()[hunt.id]?.hunt) === text) return;
    changeOutbox(box => { box[hunt.id] = { characterId, hunt }; });
    void flush();
  }
  async function flush() {
    const auth = sessionRef.current; if (!auth) return;
    if (flushing.current) { flushAgain.current = true; return; }
    flushing.current = true; let rejected = false;
    try {
      for (const [id, entry] of Object.entries(readOutbox())) {
        if (entry.characterId !== auth.character.id) continue;
        if (deleted.current.has(id)) { changeOutbox(box => { delete box[id]; }); continue; }
        const text = JSON.stringify(entry.hunt);
        try {
          await api("/api/records", auth.token, { method: "PUT", body: text });
          // 올리는 도중에 지웠으면 방금 올라간 기록을 다시 지운다.
          if (deleted.current.has(id)) { await api(`/api/records?id=${id}`, auth.token, { method: "DELETE" }); changeOutbox(box => { delete box[id]; }); continue; }
        }
        catch (error) {
          // 형식 오류·남의 기록처럼 다시 보내도 안 되는 건은 따로 보관하고 다음 기록을 막지 않는다.
          if (!(error instanceof ApiError) || ![400, 403, 413].includes(error.status)) throw error;
          try { localStorage.setItem(REJECTED, JSON.stringify({ ...JSON.parse(localStorage.getItem(REJECTED) ?? "{}"), [id]: entry })); } catch { /* 보관 실패해도 대기열은 비운다 */ }
          changeOutbox(box => { delete box[id]; }); rejected = true;
          if (mounted.current) setSyncError(`서버가 기록 1건을 거부했습니다: ${error.message} (브라우저 저장소 ${REJECTED}에 보관)`);
          continue;
        }
        sent.current.set(id, text);
        changeOutbox(box => { if (JSON.stringify(box[id]?.hunt) === text) delete box[id]; });
        if (mounted.current) setRows(list => upsertRow(list, entry.hunt));
      }
      // 증거는 기록이 서버에 생긴 뒤에 올린다. 사진은 보조 자료라 몇 번 실패하면 버린다.
      while (evidence.current.length) {
        const item = evidence.current[0];
        try {
          await api(`/api/evidence?hunt=${item.huntId}&kind=${item.kind}`, auth.token, { method: "POST", body: item.image, headers: { "Content-Type": item.image.type || "image/png" } });
          if (mounted.current) setRows(list => list.map(row => row.id === item.huntId ? { ...row, evidence: (row.evidence ?? 0) + 1 } : row));
        } catch (error) { if (error instanceof ApiError && error.status === 401) throw error; if (++item.tries < 3) break; }
        evidence.current.shift();
      }
      if (mounted.current && !rejected) setSyncError("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire();
      else if (mounted.current) setSyncError(`서버 저장 실패 · 이 브라우저에 보관했다가 다시 올립니다. (${error instanceof Error ? error.message : error})`);
    } finally {
      flushing.current = false;
      if (flushAgain.current) { flushAgain.current = false; void flush(); }
    }
  }
  function persist(hunt: Hunt | null) {
    current.current = hunt; setActive(hunt);
    try { localStorage.setItem(ACTIVE, JSON.stringify({ active: hunt, observedAt: lastObservation.current, characterId: characterRef.current?.id ?? null })); }
    catch { setMessage("브라우저 저장 공간이 부족합니다. 진행 중 기록을 복구용으로 보관하지 못했습니다."); }
    if (hunt) queue(hunt);
    void reconcileVideo();
  }
  /**
   * 계산 조건을 고친다. 메획·아획·레벨 차이 배율은 출처별 설정에서 다시 계산한다.
   * 캐릭터 공통값·사냥터 값으로 나눠 기억하고, 진행 중인 사냥에도 바로 반영한다.
   */
  function commitPlan(next: Plan) {
    const full = applyRates(next, setupRef.current);
    planRef.current = full; setPlan(full);
    const id = characterRef.current?.id ?? sessionRef.current?.character.id;
    if (id && planStore.current) { planStore.current = rememberPlan(planStore.current, full); storePlanStore(id, planStore.current); }
    const hunt = current.current;
    if (hunt && hunt.status !== "saved") persist({ ...hunt, plan: full });
  }
  /** 메획·아획 출처별 설정을 고친다. 캐릭터별로 이 브라우저에 기억하고 계산 조건에 바로 반영한다. */
  function commitSetup(next: RateSetup) {
    setupRef.current = next; setSetup(next);
    const id = characterRef.current?.id ?? sessionRef.current?.character.id;
    if (id && planStore.current) { planStore.current = { ...planStore.current, setup: next }; storePlanStore(id, planStore.current); }
    commitPlan(planRef.current);
  }
  /** 다른 사냥터로 옮겼으면 그 사냥터에 기억해 둔 몬스터 레벨·몹 수를 불러온다. */
  function planForMap(map: string | null, street = mapStreetRef.current): Plan {
    if (!map || !planStore.current || mapKey(map) === mapKey(planRef.current.map)) return planRef.current;
    const saved = planFrom(planStore.current, map);
    const found = catalogRef.current && findCatalogMap(catalogRef.current, map, street);
    return applyRates(found && saved.monsterLevel == null && saved.mobCount == null
      ? applyCatalogMap(saved, found, catalogRef.current!.version) : saved, setupRef.current);
  }
  async function loadMaps(auth: Session) {
    setCatalogError(null);
    try {
      const loaded = await api<MapCatalog>("/api/maps", auth.token);
      if (!mounted.current || sessionRef.current?.token !== auth.token) return;
      catalogRef.current = loaded; setCatalog(loaded);
      const base = planRef.current;
      const found = findCatalogMap(loaded, base.map);
      if (found && base.monsterLevel == null && base.mobCount == null && !current.current)
        commitPlan(applyCatalogMap(base, found, loaded.version));
    } catch (error) {
      if (mounted.current && sessionRef.current?.token === auth.token)
        setCatalogError(error instanceof Error ? error.message : "사냥터 목록을 불러오지 못했습니다.");
    }
  }
  /**
   * 넥슨 API의 레벨과 메획·아획 출처별 값. 장비·어빌리티는 메획(같으면 드롭)이 가장 높은 프리셋을 고른다.
   * 직접 고친 값은 자동으로는 덮지 않고, 불러오기 버튼(force)은 덮는다.
   */
  async function loadCharacter(auth: Session, force: boolean) {
    setCharLoading(true); setCharError(null);
    try {
      const info = await api<CharacterInfo>(`/api/character${force ? "?refresh=1" : ""}`, auth.token);
      if (!mounted.current || sessionRef.current?.character.id !== auth.character.id) return;
      setCharInfo(info);
      const next = setupFromApi(info, setupRef.current, force);
      if (next !== setupRef.current) {
        setupRef.current = next; setSetup(next);
        if (planStore.current) { planStore.current = { ...planStore.current, setup: next }; storePlanStore(auth.character.id, planStore.current); }
      }
      const base = planRef.current;
      commitPlan(force || base.source !== "manual" ? { ...base, characterLevel: info.level ?? base.characterLevel, source: "api" } : base);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire();
      else if (mounted.current) setCharError(error instanceof Error ? error.message : "캐릭터 정보를 가져오지 못했습니다.");
    } finally { if (mounted.current) setCharLoading(false); }
  }
  function preparePlan(auth: Session) {
    catalogRef.current = null; setCatalog(null); setCatalogError(null);
    planStore.current = loadPlanStore(auth.character.id);
    setupRef.current = planStore.current.setup ?? EMPTY_SETUP; setSetup(setupRef.current);
    const next = applyRates(planFrom(planStore.current, null), setupRef.current); planRef.current = next; setPlan(next); setCharInfo(null);
    void loadCharacter(auth, false);
    void loadMaps(auth);
  }
  function archive(hunt: Hunt) { queue(saveHunt(hunt)); ocrName.current = null; persist(null); }
  function fillActive(next: Hunt) {
    persist(next);
    if (next.status === "finishing" && next.final?.meso != null && next.final.fragments != null) { archive(next); notify("종료 보유량을 받아 사냥 기록을 저장했습니다."); }
  }
  /** 녹화 옵션이 켜져 있으면 진행 중인 사냥 1차수만 녹화한다. 상태가 바뀔 때마다 불러 맞춘다. */
  async function reconcileVideo() {
    if (videoBusy.current) return; videoBusy.current = true;
    try {
      for (;;) {
        const hunt = current.current; const source = stream.current?.getVideoTracks()[0];
        const want = hunt && hunt.status !== "saved" && videoOn.current && source?.readyState === "live" ? hunt.id : null;
        const recording = videoRec.current;
        if (recording && recording.huntId !== want) { videoRec.current = null; await recording.stop(); if (mounted.current) setVideos(await getRecordings()); continue; }
        if (!recording && want && source) {
          videoRec.current = await startRecording(source, want, text => notify(`${text}. 녹화를 멈춥니다.`));
          const latest = current.current;
          if (latest?.id === want && latest.recordingId !== videoRec.current.id) persist({ ...latest, recordingId: videoRec.current.id });
          if (mounted.current) setVideos(await getRecordings());
          continue;
        }
        break;
      }
    } catch (error) { videoOn.current = false; if (mounted.current) setRecordVideo(false); problem(error); }
    finally { videoBusy.current = false; }
  }
  function startPotion(potion: Potion, source: Hunt["source"], at = Date.now()) {
    if (source === "manual") recognition.current.acknowledge(at);
    let hunt = current.current;
    if (hunt && (hunt.status === "finishing" || at >= hunt.expiresAt)) {
      archive(hunt.status === "hunting" ? finishHunt(hunt, hunt.expiresAt, "비약 종료") : hunt); hunt = null;
    }
    if (hunt) persist(addPotion(hunt, potion, at));
    else {
      // 비약을 쓰기 직전에 확인한 수량이 있으면 그 값으로 시작한다.
      const next = withPreStart(createHunt(crypto.randomUUID(), potion, at, characterRef.current?.name ?? null, source), seen.current);
      // 이 사냥의 기대 메소 계산 조건(사냥터는 화면에서 읽은 이름 우선).
      const huntPlan = planForMap(mapSeenRef.current); planRef.current = huntPlan; setPlan(huntPlan); next.plan = huntPlan;
      if (!quoteRef.current.average && manualPriceRef.current) next.manualPrice = manualPriceRef.current;
      ocrName.current = null; persist(next);
      const kind = potion === "small" ? "소형" : "일반(대형)";
      const base = next.baseline;
      notify(base?.meso != null && base.fragments != null
        ? `${kind} 재획 시작. 사냥 전 수량(메소 ${number(base.meso)} · 조각 ${number(base.fragments)})으로 기록합니다.`
        : `${kind} 재획 시작. 사냥 전 수량이 확인되지 않았습니다. 30초 안에 인벤토리를 열어 메소와 조각 수량을 보여주세요.`);
      void requestPrice();
    }
  }
  async function requestPrice(retry = false) {
    try { setQuote(await api<Quote>("/api/price", sessionRef.current?.token ?? null, { method: "POST", body: JSON.stringify({ retry }) })); }
    catch (error) { setQuote(q => ({ ...q, error: error instanceof Error ? error.message : "시세 조회 실패" })); }
  }
  async function scan() {
    if (busy.current || !scanReady.current || calibrating.current || !stream.current) return;
    busy.current = true;
    const expectedStream = stream.current;
    const generation = scanGeneration.current;
    try {
      const frame = await captureFrame(expectedStream.getVideoTracks()[0]);
      if (stream.current !== expectedStream || generation !== scanGeneration.current) return;
      lastFrame.current = frame;
      if (scanPreview.current?.closest<HTMLDetailsElement>("details")?.open) {
        const thumb = scanPreview.current; thumb.width = 640; thumb.height = Math.round(frame.height * 640 / frame.width);
        thumb.getContext("2d")!.drawImage(frame, 0, 0, thumb.width, thumb.height);
      }
      const read = await recognition.current.read(frame, manualMode.current ? configRef.current : null, characterRef.current?.name ?? "");
      if (!mounted.current || stream.current !== expectedStream || calibrating.current || generation !== scanGeneration.current) return;
      lastObservation.current = read.at;
      setDiagnostic(`${frame.width}×${frame.height} · 버프 ${read.buff ? "발견" : "미확인"} · 시간 ${read.timer == null ? "미확인" : `${read.approximateTimer ? "약 " : ""}${duration(read.timer)}`} · 인벤토리 ${read.inventory ? "열림" : "미확인"} · 메소 ${number(read.meso)} · 조각 ${number(read.fragments)} · 사냥터 ${read.mapName ?? (read.texts.map ? `${read.texts.map.trim()} (확인 중)` : "미확인")} · ${read.hint}`);
      // 사냥 여부와 관계없이 확정된 보유량을 적어 둔다. 다음 사냥의 시작값(사냥 전 확인)으로 쓴다.
      if (read.meso != null || read.fragments != null) { seen.current = noteInventory(seen.current, read); setSeen(seen.current); }
      // 공유 사냥터 목록에 있는 이름이면 그 표기로 맞춘다(한 글자 오독 보정).
      const listed = read.mapName && catalogRef.current ? findCatalogMap(catalogRef.current, read.mapName, read.mapStreet) : null;
      const mapName = listed?.name ?? read.mapName;
      if (mapName && mapName !== mapSeenRef.current) {
        mapSeenRef.current = mapName; mapStreetRef.current = read.mapStreet; setMapSeen(mapName);
        const hunting = current.current;
        // 사냥 중이 아니면 옮긴 사냥터의 값으로 바꾼다. 사냥 중에는 사냥터가 비었거나, 시작 직후(비약을 먼저 쓰고 이동)이거나,
        // 목록에 없는 곳(마을 등)에서 목록의 사냥터로 옮겼을 때만 바꾼다. 사냥 중 잠깐 마을에 들러도 사냥터는 그대로다.
        const listedMap = (name: string | null | undefined) => !!catalogRef.current && !!findCatalogMap(catalogRef.current, name ?? null);
        if (!hunting) { const next = planForMap(mapName); planRef.current = next; setPlan(next); }
        else if (!hunting.plan?.map || read.at - hunting.startedAt < MAP_SETTLE_MS || (listed && !listedMap(hunting.plan.map)))
          commitPlan(planForMap(mapName));
      }
      if (read.use) startPotion(read.use, "automatic", read.approximateTimer ? read.at : read.at - (DURATION[read.use] - (read.timer ?? DURATION[read.use])));
      const hunt = current.current;
      if (hunt) {
        // 로그인 이름과 OCR 이름을 비교하면 늘 같은 오독에도 끊긴다. 사냥 중 처음 읽은 이름이 바뀔 때만 교체로 본다.
        if (read.character && ocrName.current && read.character !== ocrName.current) {
          archive(finishHunt(hunt, read.at, "캐릭터 변경 · 종료 수량 미확인")); notify("화면의 캐릭터가 바뀌어 이전 사냥을 저장했습니다."); return;
        }
        if (read.character) ocrName.current ??= read.character;
        const next = observeInventory(hunt, read);
        persist(next);
        const changed = (["baseline", "final"] as const).filter(side => !sameAmounts(hunt[side], next[side]));
        if (read.image && changed.length) void read.image().then(image => {
          for (const kind of changed) evidence.current = [...evidence.current.slice(-19), { huntId: next.id, kind, image, tries: 0 }];
        }).catch(problem);
        // 비약이 끝나고 종료 수량을 새로 읽은 그 화면을 통째로 남긴다. 영상 녹화를 켜지 않아도 남는다.
        if (!sameAmounts(hunt.final, next.final)) void screenshot(frame).then(image => {
          if (!image) return;
          evidence.current = [...evidence.current.slice(-19), { huntId: next.id, kind: "screen", image, tries: 0 }];
          void flush();
        });
        if (next.status === "finishing" && next.final?.meso != null && next.final.fragments != null) {
          archive(next); notify("종료 수량을 확인해 사냥 기록을 저장했습니다.");
        }
      }
    } catch (error) { if (mounted.current && stream.current === expectedStream) problem(error); }
    finally { busy.current = false; }
  }
  const live = useRef({ scan, flush, archive, notify, persist, stop: () => {} });

  async function loadRecords(auth: Session) {
    try { const data = await api<{ records: HuntRow[] }>("/api/records", auth.token); if (mounted.current) setRows(data.records); }
    catch (error) { if (error instanceof ApiError && error.status === 401) expire(); else problem(error); }
  }
  function login(next: Session) {
    storeSession(next); sessionRef.current = next; setSession(next); setRows([]); preparePlan(next);
    setMessage(`${next.character.name} 캐릭터로 로그인했습니다. 화면을 연결하세요.`);
    void loadRecords(next).then(() => flush());
  }
  /** 세션 만료. 진행 중 사냥은 이 브라우저에 쌓아 두었다가 다시 로그인하면 올린다. */
  function expire() {
    storeSession(null); sessionRef.current = null;
    if (mounted.current) { setSession(null); setMessage("로그인이 만료되었습니다. 다시 로그인하면 남은 기록을 이어서 올립니다."); }
  }
  function logout() {
    storeSession(null); sessionRef.current = null; characterRef.current = null; setSession(null); setRows([]);
    planStore.current = null; planRef.current = EMPTY_PLAN; setPlan(EMPTY_PLAN); setCharInfo(null); setCharError(null);
    setupRef.current = EMPTY_SETUP; setSetup(EMPTY_SETUP);
    setMessage("로그아웃했습니다.");
  }
  function importLegacy() {
    const auth = sessionRef.current; if (!auth) return;
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_RECORDS) ?? "{}") as { records?: Hunt[]; active?: Hunt | null };
      const all = [...(legacy.records ?? []), ...(legacy.active ? [saveHunt(finishHunt(legacy.active, legacy.active.startedAt, "페이지 종료로 중단"))] : [])];
      const mine = all.filter(row => row.character === auth.character.name || row.character == null);
      changeOutbox(box => { for (const hunt of mine) box[hunt.id] = { characterId: auth.character.id, hunt: { ...hunt, character: auth.character.name } }; });
      const rest = all.filter(row => !mine.includes(row));
      if (rest.length) localStorage.setItem(LEGACY_RECORDS, JSON.stringify({ records: rest, active: null })); else localStorage.removeItem(LEGACY_RECORDS);
      setLegacyCount(rest.length); setMessage(`이전 기록 ${mine.length}건을 ${auth.character.name} 캐릭터로 올립니다.${rest.length ? ` 다른 캐릭터 기록 ${rest.length}건은 그 캐릭터로 로그인해 가져오세요.` : ""}`);
      void flush();
    } catch (error) { problem(error); }
  }

  useEffect(() => {
    mounted.current = true;
    // 휴대폰 브라우저는 화면 공유(getDisplayMedia)가 없다. 그때는 기록 목록 탭을 먼저 보여준다.
    const capture = !!navigator.mediaDevices?.getDisplayMedia;
    setCanCapture(capture);
    if (window.location.hash === "#records" || !capture) setTab("records");
    try {
      const calibration = JSON.parse(localStorage.getItem(CONFIG) ?? "null") as Calibration | null;
      configRef.current = calibration; setConfig(calibration);
      videoOn.current = localStorage.getItem(VIDEO_PREF) === "on"; setRecordVideo(videoOn.current);
      setManualPrice(loadManualPrice());
      // 새로고침·브라우저 종료로 끊긴 사냥은 마지막 인식 시점까지의 중단 기록으로 올린다.
      const saved = JSON.parse(localStorage.getItem(ACTIVE) ?? "{}") as { active?: Hunt | null; observedAt?: number; characterId?: string | null };
      if (saved.active && saved.characterId) {
        const hunt = saveHunt(finishHunt(saved.active, saved.observedAt || saved.active.startedAt, "페이지 종료로 중단"));
        const box = readOutbox(); box[hunt.id] = { characterId: saved.characterId, hunt }; writeOutbox(box);
      }
      localStorage.removeItem(ACTIVE);
      setOutbox(readOutbox());
      const legacy = JSON.parse(localStorage.getItem(LEGACY_RECORDS) ?? "{}") as { records?: Hunt[]; active?: Hunt | null };
      setLegacyCount((legacy.records?.length ?? 0) + (legacy.active ? 1 : 0));
    } catch { setMessage("저장된 설정을 읽지 못했습니다. 스캔을 시작하면 자동 인식을 사용합니다."); }
    const restored = loadSession();
    if (restored) { sessionRef.current = restored; setSession(restored); preparePlan(restored); setMessage(`${restored.character.name} 캐릭터로 로그인되어 있습니다.`); void loadRecords(restored).then(() => live.current.flush()); }
    void getRecordings().then(setVideos).catch(problem);
    const poll = async () => {
      try { const r = await fetch(apiUrl("/api/price")); const q = await r.json(); if (mounted.current) setQuote(q); }
      catch { /* keep the last known quote, with its observation time */ }
    };
    void poll(); const priceTimer = setInterval(() => void poll(), 15_000);
    const stopScan = steadyInterval(() => void live.current.scan(), 2500);
    const syncTimer = setInterval(() => void live.current.flush(), 30_000);
    const tick = setInterval(() => {
      const time = Date.now(); setNow(time); const hunt = current.current;
      if (hunt?.status === "hunting" && time >= hunt.expiresAt) {
        live.current.persist(finishHunt(hunt, hunt.expiresAt, "비약 종료"));
        live.current.notify(`${hunt.potion === "small" ? "소형 재물 획득의 비약" : "재물 획득의 비약"}이 종료되었습니다. 인벤토리를 열어주세요. 60초 뒤 자동 저장합니다.`);
      } else if (hunt?.status === "finishing" && time >= hunt.endedAt! + 60_000) live.current.archive(hunt);
    }, 1000);
    const unload = (event: BeforeUnloadEvent) => { if (stream.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => {
      mounted.current = false; stopScan(); clearInterval(tick); clearInterval(priceTimer); clearInterval(syncTimer);
      window.removeEventListener("beforeunload", unload); live.current.stop();
    };
    // The live callbacks go through refs so capture is not restarted by React renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    if (connecting.current || stream.current) return;
    connecting.current = true; setStarting(true); const generation = ++scanGeneration.current;
    try {
      if (!sessionRef.current) throw new Error("먼저 캐릭터로 로그인하세요.");
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Chrome/Edge에서 HTTPS 또는 localhost로 접속하세요.");
      const fps = videoOn.current ? VIDEO.fps : 1;
      const selected = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: fps, max: fps } }, audio: false });
      if (!mounted.current || generation !== scanGeneration.current) { selected.getTracks().forEach(track => track.stop()); return; }
      stream.current = selected; lastFrame.current = await captureFrame(selected.getVideoTracks()[0]);
      if (generation !== scanGeneration.current) return;
      characterRef.current = sessionRef.current.character;
      sound.current ??= new AudioContext(); await sound.current.resume();
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
      recognition.current.dispose(); recognition.current = new Recognition(); ocrName.current = null; seen.current = NOTHING_SEEN; setSeen(NOTHING_SEEN);
      selected.getVideoTracks()[0].onended = () => live.current.stop();
      setRunning(true); setDiagnostic(""); setMessage("선택한 화면에서 인식을 준비하고 있습니다.");
      await recognition.current.init(message => { if (mounted.current && generation === scanGeneration.current) setMessage(message); });
      if (!mounted.current || generation !== scanGeneration.current) return;
      scanReady.current = true;
      setMessage("스캔 중입니다. 인벤토리의 기타 탭을 열어 시작 수량을 확인한 뒤 비약을 사용하세요.");
      void live.current.scan();
    } catch (error) { if (generation === scanGeneration.current) { stop(); problem(error); } }
    finally { if (generation === scanGeneration.current) { connecting.current = false; setStarting(false); } }
  }
  function stop() {
    scanGeneration.current++; scanReady.current = false; connecting.current = false; recognition.current.dispose();
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream.current = null;
    calibrating.current = false;
    if (current.current) archive(finishHunt(current.current, Date.now(), "화면 연결 종료")); else void reconcileVideo();
    if (mounted.current) { setRunning(false); setStarting(false); setFrozen(false); setDiagnostic(""); setMessage("스캔이 중지되었습니다. 다시 시작하면 메이플 창을 선택합니다."); }
  }
  live.current = { scan, flush, archive, notify, persist, stop };
  function toggleVideo(on: boolean) {
    videoOn.current = on; setRecordVideo(on);
    const track = stream.current?.getVideoTracks()[0];
    if (track) void track.applyConstraints({ frameRate: { ideal: on ? VIDEO.fps : 1, max: on ? VIDEO.fps : 1 } }).catch(problem);
    try { localStorage.setItem(VIDEO_PREF, on ? "on" : "off"); } catch { /* 이번 화면에서만 적용 */ }
    if (on) void navigator.storage?.persist?.();
    void reconcileVideo();
  }
  /** 탭 바꾸기. 기록 목록은 주소에 #records를 남겨 새로고침·공유해도 그 탭으로 연다. */
  function chooseTab(next: Tab) {
    setTab(next);
    try { window.history.replaceState(null, "", next === "records" ? "#records" : window.location.pathname + window.location.search); } catch { /* 주소만 그대로 */ }
  }
  /** 탭 목록의 방향키·Home·End 이동(WAI-ARIA 탭 패턴). */
  function tabKey(event: React.KeyboardEvent) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex(([key]) => key === tab);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    const next = TABS[nextIndex][0]; chooseTab(next); document.getElementById(`hunt-tab-${next}`)?.focus();
  }
  function applyManualPrice(price: string) {
    storeManualPrice(price); setManualPrice(price); manualPriceRef.current = price;
    const today = koreaDay(Date.now());
    const hunt = current.current;
    if (hunt && koreaDay(hunt.startedAt) === today && !hunt.manualPrice) persist({ ...hunt, manualPrice: price });
    for (const row of visibleRows) if (koreaDay(row.startedAt) === today && !priceOf(row)) updateRecord({ ...row, manualPrice: price });
    setMessage(`오늘 조각 시세를 ${number(price)} 메소로 적용했습니다. 경매장 시세가 확인되면 그 값을 우선합니다.`);
  }
  function updateRecord(row: HuntRow) { const hunt = plain(row); queue(hunt); setRows(list => upsertRow(list, hunt)); }
  /** 기록 삭제. 서버 기록과 증거 이미지를 지우고, 이 브라우저의 업로드 대기열과 올릴 증거에서도 뺀다. 녹화 영상은 보관함에 그대로 둔다. */
  async function removeRecord(row: HuntRow) {
    const auth = sessionRef.current; if (!auth) return;
    deleted.current.add(row.id);
    changeOutbox(box => { delete box[row.id]; });
    evidence.current = evidence.current.filter(item => item.huntId !== row.id);
    try { await api(`/api/records?id=${row.id}`, auth.token, { method: "DELETE" }); }
    catch (error) { if (error instanceof ApiError && error.status === 401) expire(); throw error; }
    if (mounted.current) setRows(list => list.filter(item => item.id !== row.id));
    setMessage(`${new Date(row.startedAt).toLocaleString("ko-KR")} 사냥 기록을 삭제했습니다.`);
  }
  function freeze() {
    if (!lastFrame.current || !preview.current) return;
    const canvas = preview.current; canvas.width = lastFrame.current.width; canvas.height = lastFrame.current.height;
    canvas.getContext("2d")!.drawImage(lastFrame.current, 0, 0);
    scanGeneration.current++; calibrating.current = true; setFrozen(true);
  }
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width, Math.round((event.clientX - rect.left) * canvas.width / rect.width))),
      y: Math.max(0, Math.min(canvas.height, Math.round((event.clientY - rect.top) * canvas.height / rect.height))) };
  }
  function selectRegion(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current || !preview.current) return;
    const end = point(event); const start = drag.current; drag.current = null;
    const region: Region = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
    if (region.w < 4 || region.h < 4) return;
    if (["buffIcon", "alternateIcon", "inventory", "fragmentIcon"].includes(role)) region.pixels = signature(crop(preview.current, region));
    const previous = configRef.current;
    const next: Calibration = { width: preview.current.width, height: preview.current.height,
      regions: { ...(previous?.width === preview.current.width && previous.height === preview.current.height ? previous.regions : {}), [role]: region } };
    configRef.current = next; setConfig(next); localStorage.setItem(CONFIG, JSON.stringify(next));
    setMessage(`${ROLES[role]} 영역을 저장했습니다. 다른 영역을 선택하거나 인식을 재개하세요.`);
  }

  const today = now ? koreaDay(now) : null;
  const priceOf = (row: Hunt & { auctionPrice?: string | null }): Price => {
    const auction = row.auctionPrice ?? (koreaDay(row.startedAt) === today ? quote.average : null);
    return auction ? { price: auction, source: "경매장" } : row.manualPrice ? { price: row.manualPrice, source: "직접 입력" } : null;
  };
  const character = session?.character;
  const pending: HuntRow[] = Object.values(outbox).filter(entry => entry.characterId === character?.id)
    .map(entry => ({ ...rows.find(row => row.id === entry.hunt.id), ...entry.hunt, pending: true }));
  const visibleRows = [...pending, ...rows.filter(row => !outbox[row.id])].filter(row => row.id !== active?.id).sort((a, b) => b.startedAt - a.startedAt);
  const activePrice = active ? priceOf(active) : null; const activeValue = fragmentValue(active?.fragments, activePrice?.price);
  // 기록과 진행 중 사냥의 기대 메소·손실률(같은 날 앞선 사냥 획득분을 일일 한도에서 뺀다).
  const expected = expectations(active ? [...visibleRows, active] : visibleRows, now);
  const activeExpectation = active ? expected.get(active.id) ?? null : null;
  // 오늘 사냥들이 일일 메소 한도(기본 메소 기준)에 채운 양. 진행 중인 사냥은 지금까지의 기대값으로 더한다.
  const filledToday = today ? filledOn(active ? [...visibleRows, active] : visibleRows, today, now) : 0;
  const priceMissing = !quote.average && !["RUNNING", "NOT_REQUESTED"].includes(quote.status);
  const liveHunt = active?.status === "hunting" ? `사냥 ${duration(now - active.startedAt)} · 비약 ${duration(active.expiresAt - now)} 남음`
    : active?.status === "finishing" ? "비약 종료 · 인벤토리를 열어 종료 수량을 확인하세요" : null;

  return <main className="mx-auto w-full min-w-0 max-w-[1400px] space-y-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
    {/* 제목은 왼쪽, 캐릭터 로그인은 오른쪽의 작은 패널. 좁은 화면에서는 제목 아래로 내려간다. */}
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-6">
            <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" />
          </svg>
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">사냥 <span className="text-accent">기록</span></h1>
          <p className="mt-1 text-sm text-ink-muted">재물 획득의 비약 한 차수의 사냥 시간, 메소, 솔 에르다 조각을 화면 인식으로 기록합니다.</p>
        </div>
      </div>
      {character ? <HuntAccount name={character.name} locked={running || starting} onLogout={logout} /> : <HuntLogin onLogin={login} />}
    </header>

    {/* 스크롤해도 보이도록 메뉴(높이 51px: 링크 50px + 테두리 1px) 아래 8px에 붙는다. 비약 종료 같은 알림을 놓치지 않게 한다. */}
    <div role="status" aria-live="polite" className="sticky top-[59px] z-20 rounded-xl border border-line bg-surface-1/95 px-4 py-3 shadow-card backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className={`inline-flex shrink-0 items-center gap-2 font-semibold ${running ? "text-accent" : "text-ink-faint"}`}>
          <span aria-hidden className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-accent" : "bg-ink-faint"}`} />{starting ? "인식 준비 중" : frozen ? "영역 보정 중" : running ? "스캔 중" : "스캔 대기"}
        </span>
        {liveHunt && <span className="shrink-0 font-semibold tabular-nums">{liveHunt}</span>}
        <span className="min-w-0 flex-1 text-ink-muted">{message}</span>
      </div>
      {syncError && <p className="mt-2 text-sm text-warning">{syncError}</p>}
    </div>

    {/* 페이지 안의 탭. 패널을 숨기기만 하므로 탭을 바꿔도 스캔·기록은 계속된다. */}
    <div role="tablist" aria-label="사냥 기록 화면" className="flex gap-1 border-b border-line" onKeyDown={tabKey}>
      {TABS.map(([key, label]) => <button key={key} id={`hunt-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`hunt-panel-${key}`}
        tabIndex={tab === key ? 0 : -1} onClick={() => chooseTab(key)}
        className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${tab === key
          ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>
        {label}
        {key === "hunt" && running && <span aria-hidden className="ml-1.5 inline-block size-2 animate-pulse rounded-full bg-accent align-middle" />}
        {key === "records" && session && <span className="ml-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-ink-muted">{visibleRows.length}</span>}
      </button>)}
    </div>

    <div role="tabpanel" id="hunt-panel-hunt" aria-labelledby="hunt-tab-hunt" hidden={tab !== "hunt"} className="space-y-6">
      {/* 왼쪽: 스캔 화면과 지금 사냥. 오른쪽: 순서 안내와 조각 시세. 스캔 화면을 보면서 순서를 따라가게 나란히 둔다. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {!canCapture && <section className={card}><h2 className="text-base font-bold tracking-tight">이 기기에서는 기록 조회만 됩니다</h2>
            <p className="mt-2 text-sm text-ink-muted">화면 연결은 PC의 Chrome·Edge에서만 됩니다. 사냥 기록은 PC에서 하고, 여기서는 로그인해 기록과 증거 이미지를 볼 수 있습니다.</p></section>}

          <section className={canCapture ? card : "hidden"}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-auto text-base font-bold tracking-tight">메이플 화면 <span className="text-accent">스캔</span></h2>
              <button className={session && !running ? primary : button} disabled={running || starting || !session} onClick={() => void connect()}>{starting ? "인식 준비 중…" : "스캔 시작"}</button>
              <button className={button} disabled={!running && !starting} onClick={stop}>스캔 중지</button>
            </div>
            <p className="mt-2 text-sm text-ink-muted">메이플 창을 선택하면 버프와 인벤토리를 자동으로 찾습니다. 게임의 버프 시간을 ‘분+초’로 표시하고, 수량이 두 번 확인될 때까지 인벤토리를 열어 두세요.</p>
            {!running && !frozen && <div className="mt-4 grid min-h-40 place-items-center rounded-xl border border-dashed border-line-strong bg-surface-2 p-6 text-center text-sm text-ink-muted">
              <p>{session ? "‘스캔 시작’을 누르고 메이플 창을 선택하세요. 별도 영역 지정 없이 인식합니다." : "위쪽 캐릭터 로그인 칸에서 로그인하면 스캔을 시작할 수 있습니다."}<br />화면 스캔은 PC의 Chrome·Edge에서만 됩니다.</p>
            </div>}
            <details className={running && !frozen ? "mt-3 text-xs text-ink-muted" : "hidden"}>
              <summary className="cursor-pointer">인식 화면 확인 (선택)</summary>
              <p className="mt-2">최근 수신 화면입니다. 접어 두어도 스캔은 계속됩니다.</p>
              <canvas ref={scanPreview} className="mt-2 w-full max-w-sm rounded-lg bg-black" />
            </details>
            <p className="mt-3 text-xs text-ink-muted" aria-live="polite">{diagnostic || "스캔을 시작하면 버프·인벤토리·메소·조각의 인식 결과가 표시됩니다. 읽지 못한 수량은 null로 남습니다."}</p>
            <label className="mt-4 flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 accent-(--accent)" checked={recordVideo} onChange={e => toggleVideo(e.target.checked)} />
              <span>사냥 중 영상 녹화 (선택)<span className="mt-0.5 block text-xs text-ink-muted">꺼 두어도 종료 화면은 사진으로 남습니다. 켜면 비약 시작부터 저장까지만 녹화합니다(시간당 약 135MB, 이 브라우저에 최근 {VIDEO.keep}개).</span></span>
            </label>
            <details className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm" open={frozen || undefined}>
              <summary className="cursor-pointer text-xs font-semibold text-ink-muted">인식 보정 (선택) · 자동 인식이 안 될 때</summary>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-(--accent)" checked={useCalibration} disabled={starting || !config} onChange={e => { manualMode.current = e.target.checked; setUseCalibration(e.target.checked); scanGeneration.current++; }} />저장한 영역으로 인식하기</label>
                <button className={button} disabled={!running || starting} onClick={freeze}>현재 화면에서 영역 지정</button>
              </div>
              <RegionSummary config={config} />
              <div className={frozen ? "mt-4 space-y-3" : "hidden"}>
              <label className="text-sm">지정할 영역 <select value={role} onChange={e => setRole(e.target.value as Role)} className="ml-2 rounded-lg border border-line-strong bg-surface-1 p-2">{Object.entries(ROLES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <p className="text-sm text-ink-muted">아래 정지 화면에서 해당 부분을 드래그하세요. 버프 아이콘과 남은 시간은 같은 버프를 지정합니다. 메소·조각은 숫자만, 조각 아이콘은 숫자를 빼고 지정하세요.</p>
              <canvas ref={preview} className="w-full touch-none rounded-lg border border-accent" onPointerDown={e => { drag.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={selectRegion} />
              <div className="flex gap-2"><button className={primary} disabled={!config} onClick={() => { manualMode.current = true; setUseCalibration(true); calibrating.current = false; setFrozen(false); }}>보정 영역으로 인식 재개</button>
                <button className={button} onClick={() => { manualMode.current = false; setUseCalibration(false); calibrating.current = false; setFrozen(false); }}>자동 인식으로 돌아가기</button></div>
              </div>
            </details>
          </section>

          {canCapture && <CurrentHunt active={active} now={now} running={running} seen={seenView} value={activeValue} expectation={activeExpectation}
            onStart={potion => startPotion(potion, "manual")} onSave={() => current.current && archive(current.current)}
            onFinish={() => { if (current.current) { persist(finishHunt(current.current, Date.now(), "직접 종료")); notify("사냥을 종료했습니다. 인벤토리를 열어주세요. 60초 뒤 저장합니다."); } }}>
            {active && <MissingInputs key={`${active.id}-${active.status}`} hunt={active} onFill={fillActive} />}
          </CurrentHunt>}
        </div>

        <aside className="min-w-0 space-y-6">
          {canCapture && <HuntSteps loggedIn={!!session} running={running} seen={seenView} active={active} now={now}><HuntHelp /></HuntSteps>}
          <section className={card}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold tracking-tight">솔 에르다 <span className="text-accent">조각</span></h2>
                <p className="mt-0.5 text-xs text-ink-faint">루나 · 개당 시세</p>
              </div>
              <button className={smallButton} onClick={() => void requestPrice(true)}>오늘 시세 확인</button>
            </div>
            <p className="mt-4 text-3xl font-bold tracking-tight text-accent tabular-nums">{number(quote.average ?? manualPrice)} <span className="text-sm font-medium text-ink-muted">메소{!quote.average && manualPrice ? " · 직접 입력" : ""}</span></p>
            <p className="mt-2 text-sm text-ink-muted">{QUOTE_STATUS[quote.status] ?? quote.status} · 판매 {number(quote.sales ?? 0)}건 · {number(quote.quantity ?? 0)}개{quote.truncated ? " · 일부 표본" : ""}</p>
            <p className="mt-1 text-xs text-ink-faint">당일 판매 완료 수량 가중 평균 · 수수료 차감 전{quote.capturedAt ? ` · ${new Date(quote.capturedAt).toLocaleString("ko-KR")} 조회` : ""}</p>
            {quote.error && <p className="mt-3 text-sm text-warning">{quote.error}</p>}
            {priceMissing && <div className="mt-4 rounded-xl bg-surface-2 p-3"><p className="mb-2 text-sm">경매장 시세를 가져오지 못했습니다. 조각 개당 가격을 직접 입력하면 오늘 사냥의 조각 환산에 씁니다.</p><PriceInput onApply={applyManualPrice} label={manualPrice ? "다시 입력" : "오늘 시세로 적용"} /></div>}
          </section>
        </aside>
      </div>

      {/* 사냥 효율은 세 칸(기본 설정 · 추가 획득 설정 · 계산하기)이라 전체 폭을 쓴다. */}
      {session ? <HuntEfficiency plan={plan} onChange={commitPlan} setup={setup} onSetup={commitSetup} mapSeen={mapSeen} info={charInfo} loading={charLoading} error={charError}
        catalog={catalog} catalogError={catalogError} onReloadMaps={() => { if (sessionRef.current) void loadMaps(sessionRef.current); }}
        onLoad={() => { if (sessionRef.current) void loadCharacter(sessionRef.current, true); }} active={!!active} filledToday={filledToday} />
        : <section className={`${card} text-center`}>
          <h2 className="text-base font-bold tracking-tight">사냥 <span className="text-accent">효율</span></h2>
          <p className="mt-2 text-sm text-ink-muted">로그인하면 넥슨 API로 캐릭터의 장비·어빌리티 프리셋을 불러와 사냥터별 기대 메소를 계산합니다.</p>
        </section>}
    </div>

    <div role="tabpanel" id="hunt-panel-records" aria-labelledby="hunt-tab-records" hidden={tab !== "records"} className="space-y-6">
      {session ? <section className={card}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold tracking-tight">기록 <span className="text-accent">목록</span><span className="ml-2 rounded-full bg-surface-2 px-2.5 py-0.5 align-middle text-xs font-medium text-ink-muted">{session.character.name}</span></h2>
          <div className="flex flex-wrap gap-2">
            {legacyCount > 0 && <button className={smallButton} onClick={importLegacy}>이 브라우저의 이전 기록 가져오기 ({legacyCount})</button>}
            <button className={smallButton} onClick={() => download(new Blob([JSON.stringify(visibleRows.map(row => { const price = priceOf(row); const exp = expected.get(row.id); return { ...plain(row), fragmentPrice: price?.price ?? null, priceSource: price?.source ?? null, fragmentValue: fragmentValue(row.fragments, price?.price), expectedMeso: exp?.expected ?? null, lossRate: lossRate(exp?.expected, row.meso) }; }), null, 2)], { type: "application/json" }), `maple-hunting-${session.character.name}.json`)}>JSON 내보내기</button>
          </div>
        </div>
        <RecordSummary rows={visibleRows} priceOf={priceOf} />
        <HuntRecords rows={visibleRows} token={session.token} priceOf={priceOf} onChange={updateRecord} onDelete={removeRecord} />
        <p className="mt-4 text-xs text-ink-faint">수량이 기록되지 않은 사냥은 ‘보정 · 증거 · 삭제’에서 직접 입력할 수 있습니다. 잘못된 기록은 같은 곳에서 삭제합니다.</p>
      </section>
        : <section className={`${card} text-center`}>
          <h2 className="text-base font-bold tracking-tight">기록 <span className="text-accent">목록</span></h2>
          <p className="mt-2 text-sm text-ink-muted">위쪽 캐릭터 로그인 칸에서 로그인하면 그 캐릭터의 사냥 기록과 합계가 여기에 표시됩니다.</p>
        </section>}

      {(recordVideo || videos.length > 0) && <section className={card}>
        <h2 className="text-base font-bold tracking-tight">녹화 <span className="text-accent">보관함</span></h2>
        <p className="mt-2 text-xs text-ink-faint">이 브라우저에만 있고 최근 {VIDEO.keep}개만 남습니다. 보관할 영상은 내려받으세요.</p>
        <div className="mt-4 space-y-3">{[...videos].sort((a, b) => b.startedAt - a.startedAt).map(row => <div key={row.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3">
          <span className="mr-auto text-sm">{new Date(row.startedAt).toLocaleString("ko-KR")} · {row.error ?? (row.endedAt ? "녹화 완료" : "진행 중 또는 중단된 영상")}</span>
          <button className={smallButton} disabled={row.id === videoRec.current?.id} onClick={() => void recordingBlob(row).then(blob => download(blob, `maple-${row.id}.webm`)).catch(problem)}>WebM 다운로드</button>
          <button className={smallButton} disabled={row.id === videoRec.current?.id} onClick={() => { if (window.confirm("이 녹화 영상을 삭제할까요? 사냥 기록은 유지됩니다.")) void deleteRecording(row.id).then(() => getRecordings()).then(setVideos).catch(problem); }}>영상 삭제</button>
        </div>)}</div>
      </section>}
    </div>
  </main>;
}
