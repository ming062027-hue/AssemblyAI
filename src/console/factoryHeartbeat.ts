// 工業自動化核心：工廠心跳動態引擎 (Factory Heartbeat Engine)
// 讓 CNC-640 控制台真正「Run 起來」：
// - 逐秒加工倒數與零件計數累加 (Cycle Countdown & Parts Counter)
// - 真實五軸切削 G-code / Klartext 單節滾動流 (支援 A109 / B202 / C303 三大工單)
// - 主軸轉速、切削負載、冷卻液壓微幅真實物理抖動
// - 故障演練注入 (414 軸過載 / E-108 主軸過溫 / E-305 冷卻斷流 / 正常復歸)
// - 智能品檢與三次元公差分析 (Ra 粗糙度、真圓度公差、AI 視覺檢測、當班良率 99.71%)
// - 綠色能源與 ESG 碳排計算 (即時 28.4 kW、電費即時跳錶、碳足跡、太陽能綠電比)
// - 設備預測性維護健康矩陣 (主軸震動頻譜 94.2%、潤滑油槽、切削水濃度、廠區空壓)
// - 老闆最在乎的：OEE 稼動率即時計算、警報停機損失即時跳錶 ($50/分鐘)
// - 主管最在乎的：MES 航太工單、24 把刀具磨損預警、AGV 路網坐標
// - 師傅最在乎的：加工剩餘時間、單節行號、主軸負載狀態

import { useEffect, useState, useCallback } from "react";

export interface GCodeBlock {
  n: string;
  code: string;
  comment: string;
  commentEn?: string;
  f: number;
  s: number;
}

export interface WorkOrderConfig {
  id: "A109" | "B202" | "C303";
  code: string;
  partName: string;
  partNameEn?: string;
  material: string;
  materialEn?: string;
  targetPcs: number;
  initialCompleted: number;
  cycleTotalSec: number;
  spindleTargetRpm: number;
  primaryTool: string;
  primaryToolEn?: string;
  gcodeList: GCodeBlock[];
}

// 航太發動機渦輪葉片 (Ti-6Al-4V 鈦合金)
export const GCODE_STREAM_A109: GCodeBlock[] = [
  { n: "N0415", code: "TOOL CALL 3 Z S8500 F1200", comment: "換刀 T03 精銑球刀 R4", commentEn: "Tool Change T03 Ball Endmill R4", f: 1200, s: 8500 },
  { n: "N0416", code: "M03 S8500 M08", comment: "主軸順時針啟動 + 高壓冷卻噴射", commentEn: "Spindle CW Start + High Pressure Coolant", f: 1200, s: 8500 },
  { n: "N0417", code: "G00 X+120.450 Y-45.200 Z+50.000", comment: "快速定位至葉根進刀安全點", commentEn: "Rapid Traverse to Root Clearance", f: 0, s: 8500 },
  { n: "N0418", code: "G01 Z-12.500 F800", comment: "Z 軸切入航太渦輪葉片型面", commentEn: "Z-Axis Profile Plunge", f: 800, s: 8500 },
  { n: "N0419", code: "G01 X+145.230 Y-82.110 F1200", comment: "葉片前緣曲面高速精銑", commentEn: "Leading Edge High Speed Finishing", f: 1200, s: 8500 },
  { n: "N0420", code: "G02 X+160.000 Y-65.000 I+15.0 J0 F1200", comment: "R15 圓弧螺旋插補輪廓", commentEn: "R15 Helical Interpolation", f: 1200, s: 8500 },
  { n: "N0421", code: "G01 X+185.500 Y-65.000 F1500", comment: "尾緣流道微米級平滑修光", commentEn: "Trailing Edge Micron-level Polishing", f: 1500, s: 8500 },
  { n: "N0422", code: "G03 X+210.000 Y-40.000 I0 J+25.0 F1200", comment: "葉根圓角微細切削", commentEn: "Root Fillet Fine Cutting", f: 1200, s: 8500 },
  { n: "N0423", code: "G01 Z+50.000 FMAX M09", comment: "高速退刀至換件安全平面", commentEn: "High-Speed Retract to Clearance Plane", f: 3000, s: 8500 },
  { n: "N0424", code: "M00 (CHECK WORKPIECE SURFACE)", comment: "自動中停：三次元雷射掃描表面", commentEn: "Auto Stop: 3D Laser Surface Scan", f: 0, s: 0 },
];

// 航太高壓燃油閥體 (AL7075-T6 航太鋁合金)
export const GCODE_STREAM_B202: GCodeBlock[] = [
  { n: "N0101", code: "TOOL CALL 2 Z S12000 F2400", comment: "換刀 T02 粗銑刀 Ø16 鋁合金專用", commentEn: "Tool Change T02 Rough Endmill Ø16", f: 2400, s: 12000 },
  { n: "N0102", code: "M03 S12000 M08 M07", comment: "主軸 12000 RPM + 高壓雙噴射冷卻", commentEn: "Spindle 12000 RPM + Dual Coolant", f: 2400, s: 12000 },
  { n: "N0103", code: "G00 X+85.000 Y+60.000 Z+25.000", comment: "定位至燃油腔體主銑削基準點", commentEn: "Position to Fuel Cavity Datum", f: 0, s: 12000 },
  { n: "N0104", code: "G01 Z-28.000 F1600", comment: "螺旋下刀進給開粗主閥腔", commentEn: "Helical Plunge Roughing Main Cavity", f: 1600, s: 12000 },
  { n: "N0105", code: "G02 X+115.000 Y+60.000 I+15.0 J0 F2400", comment: "內腔高精度圓形型腔粗銑", commentEn: "Inner Cavity High-Precision Roughing", f: 2400, s: 12000 },
  { n: "N0106", code: "G01 X+135.000 Y+85.000 F2200", comment: "高壓油道交叉油孔銑削", commentEn: "Cross Hole Milling for Oil Gallery", f: 2200, s: 12000 },
  { n: "N0107", code: "G00 Z+50.000 M09", comment: "安全退刀更換精修螺紋刀", commentEn: "Retract for Thread Mill Change", f: 4000, s: 12000 },
];

// 醫療級人工髖關節球體 (SUS316L 醫療不鏽鋼)
export const GCODE_STREAM_C303: GCodeBlock[] = [
  { n: "N0201", code: "TOOL CALL 1 Z S6800 F900", comment: "換刀 T01 面銑刀 Ø50 球面精密銑", commentEn: "Tool Change T01 Face Mill Ø50", f: 900, s: 6800 },
  { n: "N0202", code: "M03 S6800 M08", comment: "主軸啟動 6800 RPM + 奈米微量潤滑", commentEn: "Spindle 6800 RPM + Nano MQL", f: 900, s: 6800 },
  { n: "N0203", code: "G00 X+0.000 Y+0.000 Z+30.000", comment: "對準人工髖關節球體頂點法向", commentEn: "Align to Hip Joint Sphere Apex", f: 0, s: 6800 },
  { n: "N0204", code: "G01 Z-5.000 F450", comment: "不鏽鋼球面微量進給接觸", commentEn: "Stainless Steel Sphere Micro Feed", f: 450, s: 6800 },
  { n: "N0205", code: "G03 X+45.000 Y+0.000 CR=28.000 F900", comment: "多軸聯動連續球弧插補", commentEn: "Multi-axis Continuous Arc Interpolation", f: 900, s: 6800 },
  { n: "N0206", code: "G01 Z+60.000 FMAX", comment: "超光學級退刀保護工件表面", commentEn: "Optical Grade Retract to Protect Surface", f: 2500, s: 6800 },
];

export const WORK_ORDERS: Record<"A109" | "B202" | "C303", WorkOrderConfig> = {
  A109: {
    id: "A109",
    code: "#WO-2026-A109",
    partName: "航太五軸 鈦合金渦輪葉片 (Ti-6Al-4V)",
    partNameEn: "5-Axis Aerospace Titanium Turbine Blade (Ti-6Al-4V)",
    material: "Ti-6Al-4V 航太鈦合金",
    materialEn: "Ti-6Al-4V Aerospace Titanium",
    targetPcs: 500,
    initialCompleted: 348,
    cycleTotalSec: 270, // 4分30秒
    spindleTargetRpm: 8500,
    primaryTool: "T03 精銑球刀 R4",
    primaryToolEn: "T03 Ball Endmill R4",
    gcodeList: GCODE_STREAM_A109,
  },
  B202: {
    id: "B202",
    code: "#WO-2026-B202",
    partName: "航太高壓燃油閥體 (AL7075-T6)",
    partNameEn: "Aerospace High-Pressure Fuel Valve (AL7075-T6)",
    material: "AL7075-T6 航太鋁合金",
    materialEn: "AL7075-T6 Aerospace Aluminum",
    targetPcs: 600,
    initialCompleted: 412,
    cycleTotalSec: 195, // 3分15秒
    spindleTargetRpm: 12000,
    primaryTool: "T02 粗銑刀 Ø16",
    primaryToolEn: "T02 Rough Endmill Ø16",
    gcodeList: GCODE_STREAM_B202,
  },
  C303: {
    id: "C303",
    code: "#WO-2026-C303",
    partName: "醫療級人工髖關節球體 (SUS316L)",
    partNameEn: "Medical Grade Artificial Hip Joint (SUS316L)",
    material: "SUS316L 醫療植入級不鏽鋼",
    materialEn: "SUS316L Medical Implant Stainless Steel",
    targetPcs: 300,
    initialCompleted: 186,
    cycleTotalSec: 340, // 5分40秒
    spindleTargetRpm: 6800,
    primaryTool: "T01 面銑刀 Ø50",
    primaryToolEn: "T01 Face Mill Ø50",
    gcodeList: GCODE_STREAM_C303,
  },
};

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

export type FaultType = "none" | "414" | "E108" | "E305";

export interface FactoryHeartbeatState {
  // 零件計數與工單
  workOrderId: "A109" | "B202" | "C303";
  workOrder: string;
  partName: string;
  partNameEn?: string;
  material: string;
  materialEn?: string;
  partsToday: number;
  partsTarget: number;
  completionRate: number;
  primaryTool: string;
  primaryToolEn?: string;
  
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
  spindleTempC: number;
  feedRateActual: number;
  coolantPressureBar: number;

  // 現場故障注入狀態
  activeFault: FaultType;
  faultTitle: string;
  faultDesc: string;

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

  // 五站動態流水線即時進度
  dockAProgress: number;
  feedDeliveryProgress: number;
  qcDeliveryProgress: number;
  flowStage: number;

  // 🆕 F6 智能品檢與尺寸公差
  inspectionPartId: string;
  surfaceRoughnessRa: number;
  circularityTolerance: number;
  rootThickness: number;
  burrsCount: number;
  scratchesCount: number;
  qcStatus: "PASS" | "FAIL" | "REWORK";
  shiftPartsInspected: number;
  shiftPartsPassed: number;
  shiftPartsRework: number;
  shiftYieldRate: number;
  lastInspectionTime: string;

  // 🆕 F7 綠色能源與設備健康預測
  realtimePowerKW: number;
  spindlePowerKW: number;
  servoPowerKW: number;
  pumpPowerKW: number;
  auxPowerKW: number;
  cumulativeKWh: number;
  electricityCostNTD: number;
  electricityCostUSD: number;
  carbonKgCO2e: number;
  carbonPerPart: number;
  solarSelfSufficiency: number;
  
  // 設備預測性健康矩陣
  spindleVibrationHealth: number;
  lubricationOilLevel: number;
  coolantBrix: number;
  airPressureMpa: number;

  // 操作控制函式
  switchWorkOrder: (id: "A109" | "B202" | "C303") => void;
  injectFault: (fault: FaultType) => void;
}

export function useFactoryHeartbeat(
  isAlarmProp: boolean,
  onAlarmChange?: (alarm: boolean) => void
): FactoryHeartbeatState {
  // 當前工單
  const [activeOrderId, setActiveOrderId] = useState<"A109" | "B202" | "C303">("A109");
  const currentOrder = WORK_ORDERS[activeOrderId];

  // 當日累計件數與倒數
  const [partsToday, setPartsToday] = useState(currentOrder.initialCompleted);
  const [cycleRemainSec, setCycleRemainSec] = useState(135);

  // 故障注入狀態
  const [activeFault, setActiveFault] = useState<FaultType>("none");

  // G-code 單節索引
  const [gcodeIdx, setGcodeIdx] = useState(2);

  // 物理微幅抖動
  const [jitter, setJitter] = useState(0);

  // 停機計時
  const [downtimeSec, setDowntimeSec] = useState(0);

  // 能耗累計 (kWh)
  const [cumulativeKWh, setCumulativeKWh] = useState(184.6);

  // AGV 進度
  const [agv1Prog, setAgv1Prog] = useState(68);
  const [agv2Prog, setAgv2Prog] = useState(32);

  // 五站動態流水線各站進度
  const [dockAProg, setDockAProg] = useState(76);
  const [feedProg, setFeedProg] = useState(82);
  const [qcProg, setQcProg] = useState(55);
  const [flowStage, setFlowStage] = useState(4);

  // 綜合警報狀態 (外部 isAlarmProp 或內部 activeFault)
  const effectiveAlarm = isAlarmProp || activeFault !== "none";

  // 切換工單
  const switchWorkOrder = useCallback((id: "A109" | "B202" | "C303") => {
    setActiveOrderId(id);
    const order = WORK_ORDERS[id];
    setPartsToday(order.initialCompleted);
    setCycleRemainSec(Math.round(order.cycleTotalSec * 0.6));
    setGcodeIdx(0);
  }, []);

  // 注入故障演練
  const injectFault = useCallback((fault: FaultType) => {
    setActiveFault(fault);
    if (fault !== "none") {
      onAlarmChange?.(true);
    } else {
      onAlarmChange?.(false);
    }
  }, [onAlarmChange]);

  useEffect(() => {
    const timer = setInterval(() => {
      // 物理微幅擾動值 (-2 ~ +2)
      setJitter((Math.random() - 0.5) * 4);

      // 能耗微幅持續累計 (+0.0078 kWh/秒 ≈ 28kW)
      setCumulativeKWh((k) => +(k + 0.0078).toFixed(2));

      // 停機累計
      if (effectiveAlarm) {
        setDowntimeSec((s) => s + 1);
      } else {
        // 加工週期倒數
        setCycleRemainSec((prev) => {
          if (prev <= 1) {
            // 單件完工，件數 +1，重置為單件週期
            setPartsToday((p) => Math.min(currentOrder.targetPcs, p + 1));
            return currentOrder.cycleTotalSec;
          }
          return prev - 1;
        });

        // G-code 滾動
        setGcodeIdx((prev) => (prev + 1) % currentOrder.gcodeList.length);

        // AGV 移動巡航
        setAgv1Prog((prev) => (prev >= 100 ? 0 : prev + 2));
        setAgv2Prog((prev) => (prev >= 100 ? 0 : prev + 1));

        // 五站動態流水線推進
        setDockAProg((prev) => (prev >= 100 ? 15 : prev + 1));
        setFeedProg((prev) => (prev >= 100 ? 10 : prev + 2));
        setQcProg((prev) => (prev >= 100 ? 0 : prev + 3));
        setFlowStage((prev) => (prev >= 5 ? 1 : prev + 1));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [effectiveAlarm, currentOrder]);

  const cycleTotalSec = currentOrder.cycleTotalSec;
  const cycleElapsedSec = cycleTotalSec - cycleRemainSec;
  const activeGCode = currentOrder.gcodeList[gcodeIdx] || currentOrder.gcodeList[0];

  // 主軸轉速、負載、溫度、冷卻液壓依故障狀態動態模擬
  let spindleRpm = 0;
  let spindleLoadPct = 8;
  let spindleTempC = +(42.5 + jitter * 0.2).toFixed(1);
  let feedRateActual = 0;
  let coolantPressureBar = +(4.8 + jitter * 0.05).toFixed(1);
  let faultTitle = "";
  let faultDesc = "";

  if (activeFault === "414" || (isAlarmProp && activeFault === "none")) {
    // 414 / E-402 軸負載過載
    spindleRpm = 0;
    spindleLoadPct = 142;
    feedRateActual = 0;
    coolantPressureBar = 0;
    faultTitle = "🚨 414 / E-402 伺服軸過載";
    faultDesc = "J2 軸負載達 142% 觸發過載硬體連鎖停機";
  } else if (activeFault === "E108") {
    // E-108 主軸軸承過溫
    spindleRpm = 1200; // 降速保護
    spindleLoadPct = 98;
    spindleTempC = +(88.4 + jitter * 0.3).toFixed(1);
    feedRateActual = 200;
    coolantPressureBar = 6.2; // 增壓散熱
    faultTitle = "🌡️ E-108 主軸軸承過溫";
    faultDesc = "主軸後軸承溫度達 88.4°C，系統強制降速保護運轉";
  } else if (activeFault === "E305") {
    // E-305 冷卻液壓力跌破
    spindleRpm = 3000;
    spindleLoadPct = 25;
    feedRateActual = 0; // 進給停止防止斷刀
    coolantPressureBar = +(0.38 + jitter * 0.02).toFixed(2);
    faultTitle = "💧 E-305 冷卻水泵斷流";
    faultDesc = "切削水壓跌破 0.4 bar (<1.2 bar 臨界)，進給已安全鎖定";
  } else {
    // 正常切削運轉
    spindleRpm = activeGCode.s > 0 ? Math.round(activeGCode.s + jitter * 3) : 0;
    spindleLoadPct = activeGCode.s > 0 ? Math.round(74 + jitter * 1.5) : 8;
    feedRateActual = activeGCode.f;
  }

  // OEE 計算
  const oeeAvailability = Math.max(72.0, +(95.4 - downtimeSec * 0.04).toFixed(1));
  const oeePerformance = 95.2;
  const oeeQuality = 99.4;
  const oeeTotal = +((oeeAvailability * oeePerformance * oeeQuality) / 10000).toFixed(1);

  // 停機每分鐘損失 50 美元 ($0.833 / 秒)
  const downtimeCostUSD = +(downtimeSec * 0.833).toFixed(2);
  const completionRate = +((partsToday / currentOrder.targetPcs) * 100).toFixed(1);

  // 能源與 ESG 數據
  const realtimePowerKW = effectiveAlarm
    ? +(5.8 + jitter * 0.1).toFixed(1)
    : +(28.4 + jitter * 0.3).toFixed(1);
  const spindlePowerKW = effectiveAlarm ? 0.8 : +(18.2 + jitter * 0.2).toFixed(1);
  const servoPowerKW = effectiveAlarm ? 1.2 : +(4.8 + jitter * 0.1).toFixed(1);
  const pumpPowerKW = effectiveAlarm ? 0.3 : 3.5;
  const auxPowerKW = 1.9;
  const electricityCostNTD = +(cumulativeKWh * 3.5).toFixed(1);
  const electricityCostUSD = +(cumulativeKWh * 0.11).toFixed(1);
  const carbonKgCO2e = +(cumulativeKWh * 0.495).toFixed(1);
  const carbonPerPart = 0.26;
  const solarSelfSufficiency = 36.8;

  // 智能品檢數據
  const shiftPartsInspected = partsToday;
  const shiftPartsPassed = Math.max(0, partsToday - 1);
  const shiftPartsRework = 1;
  const shiftYieldRate = +((shiftPartsPassed / Math.max(1, shiftPartsInspected)) * 100).toFixed(2);

  return {
    workOrderId: activeOrderId,
    workOrder: currentOrder.code,
    partName: currentOrder.partName,
    partNameEn: currentOrder.partNameEn,
    material: currentOrder.material,
    materialEn: currentOrder.materialEn,
    partsToday,
    partsTarget: currentOrder.targetPcs,
    completionRate,
    primaryTool: currentOrder.primaryTool,
    primaryToolEn: currentOrder.primaryToolEn,

    cycleTotalSec,
    cycleRemainSec,
    cycleElapsedSec,

    gcodeList: currentOrder.gcodeList,
    activeGCodeIdx: gcodeIdx,
    activeGCode,

    spindleRpm,
    spindleLoadPct,
    spindleTempC,
    feedRateActual,
    coolantPressureBar,

    activeFault,
    faultTitle,
    faultDesc,

    oeeAvailability,
    oeePerformance,
    oeeQuality,
    oeeTotal,

    downtimeSec,
    downtimeCostUSD,

    tools: INITIAL_TOOLS,
    agv1Progress: agv1Prog,
    agv2Progress: agv2Prog,

    dockAProgress: dockAProg,
    feedDeliveryProgress: feedProg,
    qcDeliveryProgress: qcProg,
    flowStage,

    // F6 品檢
    inspectionPartId: `Part #${partsToday}`,
    surfaceRoughnessRa: 0.38,
    circularityTolerance: 0.003,
    rootThickness: 18.498,
    burrsCount: 0,
    scratchesCount: 0,
    qcStatus: "PASS",
    shiftPartsInspected,
    shiftPartsPassed,
    shiftPartsRework,
    shiftYieldRate,
    lastInspectionTime: "13:14:48",

    // F7 綠能與預測維護
    realtimePowerKW,
    spindlePowerKW,
    servoPowerKW,
    pumpPowerKW,
    auxPowerKW,
    cumulativeKWh,
    electricityCostNTD,
    electricityCostUSD,
    carbonKgCO2e,
    carbonPerPart,
    solarSelfSufficiency,

    spindleVibrationHealth: 94.2,
    lubricationOilLevel: 68,
    coolantBrix: 8.5,
    airPressureMpa: 0.65,

    switchWorkOrder,
    injectFault,
  };
}

// 輔助格式化函式
export function formatSecondsToMS(totalSec: number): string {
  const m = Math.floor(Math.max(0, totalSec) / 60);
  const s = Math.floor(Math.max(0, totalSec) % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
