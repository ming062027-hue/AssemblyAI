"use client";

// 看板資料線：首頁＝車間控制台風格（自有樣式，不含任何第三方品牌字樣）。
// - 外觀：冷灰底、高對比、hh-card / hh-softkey、自繪 READY / ALARM 燈、雙分屏＋右側 6 鍵、波形。
// - F1–F6 可點、可按鍵盤 F1–F6 真切換；內容只用 src/data 現有 M01–M05 / 警報 / 保養（自編示範資料）。
// - 語音鍵：按住說話（mousedown / mouseup＋觸控），波形為本機示意動畫；不改語音線任何邏輯，
//   不連 AssemblyAI、不讀金鑰。真的語音 Demo 走 /operator（語音線負責）。

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import alarmsData from "../data/alarms.json" with { type: "json" };
import machinesData from "../data/machines.json" with { type: "json" };
import maintenanceData from "../data/maintenance.json" with { type: "json" };

interface Machine {
  id: string;
  name: string;
  location: string;
  status: string;
  current_alarm: string | null;
  material_left: number;
}

interface Alarm {
  code: string;
  title: string;
  likely_causes: string;
  first_checks: string[];
  severity: string;
  needs_technician: boolean;
}

interface MaintenanceRecord {
  machine_id: string;
  date: string;
  item: string;
  technician: string;
}

const machines = machinesData as Machine[];
const alarms = alarmsData as Alarm[];
const maintenanceRecords = maintenanceData as MaintenanceRecord[];

type FuncKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";

const FUNC_KEYS: { key: FuncKey; label: string; hint: string }[] = [
  { key: "F1", label: "Overview", hint: "5 stations" },
  { key: "F2", label: "Transport", hint: "AGV demo" },
  { key: "F3", label: "Axis data", hint: "positions" },
  { key: "F4", label: "Stock", hint: "material" },
  { key: "F5", label: "Contacts", hint: "technicians" },
  { key: "F6", label: "Mute / Reset", hint: "console only" },
];

function lampClass(status: string): string {
  if (status === "alarm") return "hh-lamp hh-lamp-alarm";
  if (status === "stopped") return "hh-lamp hh-lamp-stopped";
  return "hh-lamp hh-lamp-ready";
}

function lampText(status: string): string {
  if (status === "alarm") return "ALARM";
  if (status === "stopped") return "STOP";
  return "READY";
}

export default function Home() {
  const [funcKey, setFuncKey] = useState<FuncKey>("F1");
  const [muted, setMuted] = useState(false);
  const [talking, setTalking] = useState(false);
  const [voiceLine, setVoiceLine] = useState(
    "Hold the voice key and speak. This console shows a local waveform preview only.",
  );
  const [clock, setClock] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);
  const talkingRef = useRef(false);

  const alarmByCode = useCallback((code: string | null) => {
    if (!code) return undefined;
    return alarms.find((a) => a.code === code);
  }, []);

  const alarmCount = machines.filter((m) => m.status === "alarm").length;

  // Clock (console header only).
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      setClock(`${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  // Physical F1–F6 keys switch screens (prevent browser help on F1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, FuncKey> = {
        F1: "F1",
        F2: "F2",
        F3: "F3",
        F4: "F4",
        F5: "F5",
        F6: "F6",
      };
      const target = map[e.key];
      if (target) {
        e.preventDefault();
        setFuncKey(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Waveform preview: local canvas animation only (no audio captured here).
  useEffect(() => {
    talkingRef.current = talking;
  }, [talking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bars = 48;
    let phase = 0;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#101315";
      ctx.fillRect(0, 0, w, h);
      const active = talkingRef.current && !muted;
      phase += active ? 0.55 : 0.05;
      for (let i = 0; i < bars; i++) {
        const base = active
          ? Math.abs(Math.sin(phase + i * 0.45)) * (h * 0.42) + 3
          : 3;
        const x = (w / bars) * i + 1;
        ctx.fillStyle = active ? "#7CFC9A" : "#3a4147";
        ctx.fillRect(x, h / 2 - base / 2, w / bars - 2, base);
      }
      // Center line.
      ctx.fillStyle = "#565e66";
      ctx.fillRect(0, h / 2, w, 1);
      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [muted]);

  const startTalk = useCallback(() => {
    if (muted) {
      setVoiceLine("Console is muted (F6). Unmute before the voice preview.");
      return;
    }
    setTalking(true);
    setVoiceLine("Listening (local preview)… release the key to finish.");
  }, [muted]);

  const stopTalk = useCallback(() => {
    setTalking((was) => {
      if (was) {
        // Demo preview text built from existing data (M03 / 414), no voice logic touched.
        setVoiceLine(
          "Preview: “Machine three has an alarm” → M03 / alarm 414 (Spindle load abnormal (demo)). Real voice demo runs on /operator.",
        );
      }
      return false;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", stopTalk);
    window.addEventListener("touchend", stopTalk);
    return () => {
      window.removeEventListener("mouseup", stopTalk);
      window.removeEventListener("touchend", stopTalk);
    };
  }, [stopTalk]);

  const technicians = Array.from(new Set(maintenanceRecords.map((r) => r.technician)));
  const alarm414 = alarms.find((a) => a.code === "414");
  const otherAlarms = alarms.filter((a) => a.code !== "414").slice(0, 3);

  return (
    <main className="hh-root">
      <style>{`
        .hh-root { background: #c9ced4; color: #16191c; min-height: 100%; display: flex; flex-direction: column; }
        .hh-topbar { background: #23282d; color: #eef1f4; display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 4px solid #0f1113; }
        .hh-title { font-weight: 700; letter-spacing: 0.02em; font-size: 18px; }
        .hh-subtitle { font-size: 12px; color: #aeb6bf; }
        .hh-lamps { display: flex; gap: 8px; margin-left: auto; align-items: center; }
        .hh-lamp { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; border: 2px solid #0f1113; color: #0f1113; background: #8b939c; }
        .hh-lamp::before { content: ""; width: 10px; height: 10px; border-radius: 999px; background: #4a5158; }
        .hh-lamp-ready { background: #2fbf5f; color: #06130a; }
        .hh-lamp-ready::before { background: #d6ffe2; box-shadow: 0 0 6px #d6ffe2; }
        .hh-lamp-alarm { background: #e5484d; color: #fff; animation: hh-blink 1s steps(2) infinite; }
        .hh-lamp-alarm::before { background: #fff; box-shadow: 0 0 8px #fff; }
        .hh-lamp-stopped { background: #f5a524; color: #241500; }
        .hh-lamp-stopped::before { background: #fff7e6; }
        @keyframes hh-blink { 50% { filter: brightness(0.75); } }
        .hh-body { display: grid; grid-template-columns: 1fr 168px; gap: 12px; padding: 12px 16px; flex: 1; }
        @media (max-width: 760px) { .hh-body { grid-template-columns: 1fr; } }
        .hh-screen { background: #1b1f23; color: #e8edf1; border: 3px solid #0f1113; border-radius: 8px; padding: 14px; min-height: 420px; }
        .hh-screen h2 { font-size: 14px; color: #9fb0bd; margin: 0 0 10px; font-weight: 700; letter-spacing: 0.06em; }
        .hh-card { background: #242a30; border: 1px solid #3a424b; border-radius: 6px; padding: 10px 12px; }
        .hh-card h3 { margin: 0 0 4px; font-size: 15px; }
        .hh-meta { font-size: 12px; color: #aeb9c4; }
        .hh-grid5 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
        .hh-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .hh-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .hh-table th, .hh-table td { border: 1px solid #3a424b; padding: 6px 8px; text-align: left; }
        .hh-table th { background: #2b3239; color: #c7d2dc; }
        .hh-keys { display: flex; flex-direction: column; gap: 10px; }
        @media (max-width: 760px) { .hh-keys { flex-direction: row; flex-wrap: wrap; } }
        .hh-softkey { background: linear-gradient(#f2f4f6, #c3c9d0); border: 2px solid #0f1113; border-bottom-width: 5px; border-radius: 8px; padding: 10px 8px; text-align: left; cursor: pointer; color: #14171a; min-height: 64px; }
        .hh-softkey small { display: block; font-size: 11px; color: #4c555e; }
        .hh-softkey strong { font-size: 15px; }
        .hh-softkey[aria-pressed="true"] { background: linear-gradient(#3a424b, #23282d); color: #fff; }
        .hh-softkey[aria-pressed="true"] small { color: #aeb9c4; }
        .hh-voicebar { background: #23282d; border-top: 4px solid #0f1113; padding: 10px 16px 14px; display: grid; grid-template-columns: 220px 1fr; gap: 12px; align-items: center; }
        @media (max-width: 760px) { .hh-voicebar { grid-template-columns: 1fr; } }
        .hh-talk { background: #2fbf5f; border: 2px solid #0b2b16; border-bottom-width: 6px; border-radius: 10px; font-weight: 800; font-size: 16px; padding: 14px; cursor: pointer; color: #06130a; user-select: none; touch-action: none; }
        .hh-talk:active, .hh-talk[data-on="true"] { background: #e5484d; color: #fff; border-color: #4d0f12; }
        .hh-wave { width: 100%; height: 84px; border: 2px solid #0f1113; border-radius: 6px; display: block; background: #101315; }
        .hh-voiceline { color: #d7dee5; font-size: 13px; margin-top: 6px; min-height: 20px; }
        .hh-links { display: flex; gap: 10px; flex-wrap: wrap; font-size: 13px; padding: 0 16px 12px; background: #c9ced4; }
        .hh-links a { background: #fff; border: 2px solid #0f1113; border-radius: 6px; padding: 6px 10px; color: #14171a; font-weight: 600; text-decoration: none; }
        .hh-note { font-size: 12px; color: #3c444c; padding: 0 16px 16px; background: #c9ced4; }
        .hh-clock { font-size: 12px; color: #aeb6bf; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="hh-topbar">
        <div>
          <div className="hh-title">VoiceAndon Smart Factory Console</div>
          <div className="hh-subtitle">Shop-floor demo console · fictional sample data only</div>
        </div>
        <div className="hh-lamps" role="status" aria-label="Shop status">
          <span className="hh-clock">{clock}</span>
          <span className={alarmCount > 0 ? "hh-lamp hh-lamp-alarm" : "hh-lamp hh-lamp-ready"}>
            {alarmCount > 0 ? `ALARM ×${alarmCount}` : "READY"}
          </span>
        </div>
      </div>

      <div className="hh-body">
        <section className="hh-screen" aria-label={`${funcKey} screen`} aria-live="polite">
          {funcKey === "F1" && (
            <div>
              <h2>F1 · OVERVIEW — 5 STATIONS</h2>
              <div className="hh-grid5">
                {machines.map((m) => (
                  <div key={m.id} className="hh-card">
                    <div className="hh-row">
                      <span className={lampClass(m.status)}>{lampText(m.status)}</span>
                      <h3>{m.id}</h3>
                    </div>
                    <div className="hh-meta">{m.name}</div>
                    <div className="hh-meta">{m.location}</div>
                    <div className="hh-meta">
                      Material left: {m.material_left}%{m.current_alarm ? ` · Alarm ${m.current_alarm}` : ""}
                    </div>
                    {m.current_alarm && (
                      <div className="hh-meta">
                        {alarmByCode(m.current_alarm)?.title ?? "Unknown alarm"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {alarm414 && (
                <div className="hh-card" style={{ marginTop: 10 }}>
                  <h3>Alarm 414 · {alarm414.title}</h3>
                  <div className="hh-meta">{alarm414.likely_causes}</div>
                  <ol style={{ fontSize: 13, margin: "8px 0 0", paddingLeft: 18 }}>
                    {alarm414.first_checks.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {funcKey === "F2" && (
            <div>
              <h2>F2 · TRANSPORT — AGV (DEMO ILLUSTRATION)</h2>
              <div className="hh-grid5">
                <div className="hh-card">
                  <h3>AGV-1 · Bay A → Bay B</h3>
                  <div className="hh-meta">Task: blanks to M03 area · status: moving (demo)</div>
                  <div className="hh-meta">Battery 76% · speed 0.8 m/s (demo figures)</div>
                </div>
                <div className="hh-card">
                  <h3>AGV-2 · Bay C loop</h3>
                  <div className="hh-meta">Task: idle at charger (demo)</div>
                  <div className="hh-meta">Battery 94% (demo figure)</div>
                </div>
                <div className="hh-card">
                  <h3>Next pickup</h3>
                  <div className="hh-meta">M04 is stopped with 0% material — demo queue only, no machine is controlled.</div>
                </div>
              </div>
              <p className="hh-meta" style={{ marginTop: 8 }}>
                Positions above are a static demo illustration, not live vehicle data.
              </p>
            </div>
          )}

          {funcKey === "F3" && (
            <div>
              <h2>F3 · AXIS DATA (DEMO FIGURES)</h2>
              <table className="hh-table">
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>X (mm)</th>
                    <th>Y (mm)</th>
                    <th>Z (mm)</th>
                    <th>Load</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.map((m, i) => (
                    <tr key={m.id}>
                      <td>{m.id} · {m.status}</td>
                      <td>{(120.5 + i * 10.25).toFixed(2)}</td>
                      <td>{(45.0 + i * 5.5).toFixed(2)}</td>
                      <td>{(300.75 - i * 8.125).toFixed(2)}</td>
                      <td>{m.status === "alarm" ? "high (demo)" : m.status === "stopped" ? "—" : "normal (demo)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hh-meta" style={{ marginTop: 8 }}>
                Axis numbers are fixed demo figures for the console layout, not sensor readings.
              </p>
            </div>
          )}

          {funcKey === "F4" && (
            <div>
              <h2>F4 · STOCK — MATERIAL LEFT (FROM DEMO DATA)</h2>
              <table className="hh-table">
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>Material left</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.map((m) => (
                    <tr key={m.id}>
                      <td>{m.id} · {m.name}</td>
                      <td>{m.material_left}%</td>
                      <td>{m.material_left === 0 ? "Empty — refill demo queue" : m.material_left < 35 ? "Low (demo)" : "OK (demo)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {funcKey === "F5" && (
            <div>
              <h2>F5 · CONTACTS — SHOP TECHNICIANS (FICTIONAL)</h2>
              <div className="hh-grid5">
                {technicians.map((t) => (
                  <div key={t} className="hh-card">
                    <h3>{t} (demo)</h3>
                    <div className="hh-meta">Maintenance · ext. 8{t.length}0{t.length} (demo)</div>
                    <div className="hh-meta">
                      Latest job: {maintenanceRecords.find((r) => r.technician === t)?.item ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
              {otherAlarms.length > 0 && (
                <div className="hh-card" style={{ marginTop: 10 }}>
                  <h3>Call a technician for (demo table)</h3>
                  <div className="hh-meta">
                    {otherAlarms
                      .filter((a) => a.needs_technician)
                      .map((a) => `${a.code} ${a.title}`)
                      .join(" · ") || "No technician-required demo alarms in this shortlist."}
                  </div>
                </div>
              )}
            </div>
          )}

          {funcKey === "F6" && (
            <div>
              <h2>F6 · MUTE / RESET (CONSOLE ONLY)</h2>
              <div className="hh-grid5">
                <div className="hh-card">
                  <h3>Console sound: {muted ? "MUTED" : "ON"}</h3>
                  <div className="hh-meta">Mute only affects this page preview, not /operator.</div>
                  <button
                    type="button"
                    className="hh-softkey"
                    style={{ marginTop: 8, minHeight: 0 }}
                    aria-pressed={muted}
                    onClick={() => setMuted((v) => !v)}
                  >
                    <strong>{muted ? "Unmute" : "Mute"}</strong>
                    <small>toggle preview sound flag</small>
                  </button>
                </div>
                <div className="hh-card">
                  <h3>Reset preview text</h3>
                  <div className="hh-meta">Clears the voice preview line on this page only. Repair tickets are managed on /dashboard.</div>
                  <button
                    type="button"
                    className="hh-softkey"
                    style={{ marginTop: 8, minHeight: 0 }}
                    onClick={() =>
                      setVoiceLine("Hold the voice key and speak. This console shows a local waveform preview only.")
                    }
                  >
                    <strong>Reset</strong>
                    <small>clear preview line</small>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <nav className="hh-keys" aria-label="Function keys">
          {FUNC_KEYS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="hh-softkey"
              aria-pressed={funcKey === f.key}
              onClick={() => setFuncKey(f.key)}
            >
              <strong>{f.key} · {f.label}</strong>
              <small>{f.hint} — click or press {f.key}</small>
            </button>
          ))}
        </nav>
      </div>

      <div className="hh-voicebar">
        <div>
          <button
            type="button"
            className="hh-talk"
            data-on={talking}
            aria-label="Hold to talk (demo preview)"
            onMouseDown={startTalk}
            onTouchStart={startTalk}
            onMouseUp={stopTalk}
            onMouseLeave={stopTalk}
          >
            {talking ? "● TALKING… release" : "HOLD TO TALK"}
          </button>
          <div className="hh-voiceline">{muted ? "Console muted." : talking ? "Recording preview…" : "Ready."}</div>
        </div>
        <div>
          <canvas ref={canvasRef} className="hh-wave" width={640} height={84} aria-label="Voice waveform preview" />
          <div className="hh-voiceline" aria-live="polite">{voiceLine}</div>
        </div>
      </div>

      <div className="hh-links">
        <Link href="/operator">Try the demo (/operator)</Link>
        <Link href="/dashboard">Supervisor board (/dashboard)</Link>
        <Link href="/pitch">Pitch (/pitch)</Link>
      </div>
      <p className="hh-note">
        All machines, alarm codes, maintenance records and figures on this console are fictional sample data written
        for this project — not from any manufacturer manual, and describing no real machine, brand or company.
        Voice wiring on /operator is owned by the voice line; this page changes no voice logic.
      </p>
    </main>
  );
}
