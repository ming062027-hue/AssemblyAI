// 工業自動化核心：工廠心跳動態引擎 (Factory Heartbeat Engine)
// 讓 CNC-640 控制台真正「Run 起來」：
// - 逐秒加工倒數與零件計數累加 (Cycle Countdown & Parts Counter)
// - 真實五軸切削 G-code / Klartext 單節滾動流
// - 主軸轉速、切削負載、冷卻液壓微幅真實物理抖動
// - 老闆最在乎的：OEE 稼動率即時計算、警報停機損失即時跳錶 ($50/分鐘)
// - 主管最在乎的：MES 航太工單、24 把刀具磨損預警、AGV 路網坐標
// - 師傅最在乎的：加工剩餘時間、單節行號、主軸負載狀態

import { useEffect, useState } from "react";

export interface GCodeBlock {
  n: string;
  code: string;
  comment: string;
  f: number;
  s: number;
}

export const GCODE_STREAM: GCodeBlock[] = [
  { n: "N0415", code: "TOOL CALL 3 Z S8500 F1200", comment: "換刀 T03 精銑球刀 R4", f: 1200, s: 8500 },
  { n: "N0416", code: "M03 S8500 M08", comment: "主軸順時針啟動 + 高壓冷卻噴射", f: 1200, s: 8500 },
  { n: "N0417", code: "G00 X+120.450 Y-45.200 Z+50.000", comment: "快速定位至葉根進刀安全點", f: 0, s: 8500 },
  { n: "N0418", code: "G01 Z-12.500 F800", comment: "Z 軸切入航太渦輪葉片型面", f: 800, s: 8500 },
  { n: "N0419", code: "G01 X+145.230 Y-82.110 F1200", comment: "葉片前緣曲面高速精銑", f: 1200, s: 8500 },
  { n: "N0420", code: "G02 X+160.000 Y-65.000 I+15.0 J0 F1200", comment: "R15 圓弧螺旋插補輪廓", f: 1200, s: 8500 },
  { n: "N0421", code: "G01 X+185.500 Y-65.000 F1500", comment: "尾緣流道微米級平滑修光", f: 1500, s: 8500 },
  { n: "N0422", code: "G03 X+210.000 Y-40.000 I0 J+25.0 F1200", comment: "葉根圓角微細切削", f: 1200, s: 8500 },
  { n: "N0423", code: "G01 Z+50.000 FMAX M09", comment: "高速退刀至換件安全平面", f: 3000, s: 8500 },
  { n: "N0424", code: "M00 (CHECK WORKPIECE SURFACE)", comment: "自動中停：三次元雷射掃描表面", f: 0, s: 0 },
];

export interface ToolItem {
  id: string;
  name: string;
  spec: string;
  life: number; // 0-100%
  status: "good" | "warning" | "danger";
  partsMade: number;
}

export const INITIAL_TOOLS: ToolItem[] = [
  { id: "T01", name: "面銑刀", spec: "Ø50 面銑 5刃", life: 82, status: "good", partsMade: 410 },
  { id: "T02", name: "粗銑刀", spec: "Ø16 鎢鋼端銑", life: 65, status: "good", partsMade: 290 },
  { id: "T03", name: "精銑球刀", spec: "R4 航太專用球刀", life: 12, status: "danger", partsMade: 580 },
  { id: "T04", name: "中心鑽", spec: "Ø8.5 內冷鑽頭", life: 74, status: "good", partsMade: 330 },
  { id: "T05", name: "微螺絲攻", spec: "M10 盲孔絲攻", life: 88, status: "good", partsMade: 210 },
  { id: "T06", name: "倒角刀", spec: "45° 鎢鋼倒角", life: 91, status: "good", partsMade: 140 },
];

export interface FactoryHeartbeatState {
  // 零件計數與工單
  workOrder: string;
  partName: string;
  partsToday: number;
  partsTarget: number;
  completionRate: number;
  
  // 切削週期與時間
  cycleTotalSec: number;
  cycleRemainSec: number;
  cycleElapsedSec: number;

  // G-code 流
  gcodeList: GCodeBlock[];
  activeGCodeIdx: number;
  activeGCode: GCodeBlock;

  // 即時遙測數據 (含微幅物理擾動)
  spindleRpm: number;
  spindleLoadPct: number;
  feedRateActual: number;
  coolantPressureBar: number;

  // 老闆經營 OEE 指標
  oeeAvailability: number;
  oeePerformance: number;
  oeeQuality: number;
  oeeTotal: number;

  // 停機損失跳錶
  downtimeSec: number;
  downtimeCostUSD: number;

  // 刀具與物流
  tools: ToolItem[];
  agv1Progress: number;
  agv2Progress: number;
}

export function useFactoryHeartbeat(isAlarm: boolean): FactoryHeartbeatState {
  // 當日累計件數 (目標 500 件)
  const [partsToday, setPartsToday] = useState(348);
  const partsTarget = 500;

  // 加工週期 (預設單件 04:30 = 270 秒)
  const cycleTotalSec = 270;
  const [cycleRemainSec, setCycleRemainSec] = useState(135);

  // G-code 單節索引
  const [gcodeIdx, setGcodeIdx] = useState(2);

  // 物理微幅抖動
  const [jitter, setJitter] = useState(0);

  // 停機計時
  const [downtimeSec, setDowntimeSec] = useState(0);

  // AGV 進度
  const [agv1Prog, setAgv1Prog] = useState(68);
  const [agv2Prog, setAgv2Prog] = useState(32);

  useEffect(() => {
    const timer = setInterval(() => {
      // 物理微幅擾動值 (-2 ~ +2)
      setJitter((Math.random() - 0.5) * 4);

      // 停機累計
      if (isAlarm) {
        setDowntimeSec((s) => s + 1);
      } else {
        // 加工週期倒數
        setCycleRemainSec((prev) => {
          if (prev <= 1) {
            // 單件完工，件數 +1，重置為 270 秒
            setPartsToday((p) => Math.min(partsTarget, p + 1));
            return cycleTotalSec;
          }
          return prev - 1;
        });

        // G-code 每 4 秒滾動一節
        setGcodeIdx((prev) => (prev + 1) % GCODE_STREAM.length);

        // AGV 移動巡航
        setAgv1Prog((prev) => (prev >= 100 ? 0 : prev + 2));
        setAgv2Prog((prev) => (prev >= 100 ? 0 : prev + 1));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isAlarm, cycleTotalSec]);

  const cycleElapsedSec = cycleTotalSec - cycleRemainSec;
  const activeGCode = GCODE_STREAM[gcodeIdx] || GCODE_STREAM[0];

  // 主軸轉速與負載波動
  const spindleRpm = isAlarm
    ? 0
    : activeGCode.s > 0
      ? Math.round(activeGCode.s + jitter * 3)
      : 0;

  const spindleLoadPct = isAlarm
    ? 142
    : activeGCode.s > 0
      ? Math.round(74 + jitter * 1.5)
      : 8;

  const feedRateActual = isAlarm ? 0 : activeGCode.f;
  const coolantPressureBar = isAlarm ? 0 : +(4.8 + jitter * 0.05).toFixed(1);

  // OEE 計算
  const oeeAvailability = Math.max(72.0, +(95.4 - downtimeSec * 0.04).toFixed(1));
  const oeePerformance = 95.2;
  const oeeQuality = 99.4;
  const oeeTotal = +((oeeAvailability * oeePerformance * oeeQuality) / 10000).toFixed(1);

  // 停機每分鐘損失 50 美元 ($0.833 / 秒)
  const downtimeCostUSD = +(downtimeSec * 0.833).toFixed(2);
  const completionRate = +((partsToday / partsTarget) * 100).toFixed(1);

  return {
    workOrder: "#WO-2026-A109",
    partName: "航太五軸 鈦合金渦輪葉片 (Ti-6Al-4V)",
    partsToday,
    partsTarget,
    completionRate,
    cycleTotalSec,
    cycleRemainSec,
    cycleElapsedSec,
    gcodeList: GCODE_STREAM,
    activeGCodeIdx: gcodeIdx,
    activeGCode,
    spindleRpm,
    spindleLoadPct,
    feedRateActual,
    coolantPressureBar,
    oeeAvailability,
    oeePerformance,
    oeeQuality,
    oeeTotal,
    downtimeSec,
    downtimeCostUSD,
    tools: INITIAL_TOOLS,
    agv1Progress: agv1Prog,
    agv2Progress: agv2Prog,
  };
}

// 輔助格式化函式
export function formatSecondsToMS(totalSec: number): string {
  const m = Math.floor(Math.max(0, totalSec) / 60);
  const s = Math.floor(Math.max(0, totalSec) % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
