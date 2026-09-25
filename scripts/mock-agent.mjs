// scripts/mock-agent.mjs — 模擬助理伺服器（開發用，不連線、不花錢）
//
// 規格：方案/完整規格書_v1_2026-09-17.md §4.6
// 事件名與欄位跟交接/線_語音.md 記的官方格式一致
// （transcript.user／transcript.agent／tool.call／tool.result／reply.audio／
//  reply.done／session.update／session.ready／session.end／session.ended）。
// ⚠️ reply.audio、transcript.* 回傳物件的「欄位形狀」交接檔只記了事件名，
//    細節等 P3 真連線時再跟真的 AssemblyAI 對一次，前端到時可能要微調。
//
// 用法（在 app/ 目錄跑）：
//   1. 先裝 ws（第一次安裝要大銘點頭，規格書 §1 #20）：npm install --save-dev ws
//   2. node scripts/mock-agent.mjs              # 開在 ws://localhost:8787
//   3. 自我檢查（不用裝 ws 也能跑）：node scripts/mock-agent.mjs --self-test
//
// 客戶端把 {"type":"mock.say","text":"..."} 當作操作員講了一句話；
// 結束時送 {"type":"session.end"}。input.audio 會直接忽略（模擬層不聽真聲音）。

import { isOperatorYes } from "../src/voice/confirmGate.ts";

const PORT = 8787;
const newSessionId = () => `mock-session-${Date.now().toString(36)}`;
let callSeq = 0;
const nextCallId = () => `mock-call-${++callSeq}`;

// 0.2 秒靜音：PCM16、單聲道、24kHz（跟官方聲音格式同規格，內容全 0）
const silenceB64 = () => Buffer.alloc(4800 * 2).toString("base64");

const NUMBER_WORDS = {
  zero: "0", oh: "0", o: "0",
  one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9",
};
const NUMBER_WORD_RE = /\b(zero|oh|o|one|two|three|four|five|six|seven|eight|nine)\b/g;
const MACHINE_RE = /\bmachine\s*(three|3)\b|\bm03\b/;

// 把英文數字單字串成數字字串，例如 "four one four" -> "414"
function wordsToDigits(text) {
  const hits = [...text.matchAll(NUMBER_WORD_RE)].map((m) => NUMBER_WORDS[m[1]]);
  return hits.length > 0 ? hits.join("") : null;
}

// 關鍵字路由（純函式，不碰網路，--self-test 直接測這一支）。
// 順序有講究：先把「machine three」這種機台指稱拿掉，剩下的數字才算警報碼，
// 不然 "Machine three has an alarm." 裡的 three 會被誤判成警報碼 3。
// awaiting：上一句 AI 在等哪種確認（"ticket"／"clear_alarm"），由連線那邊記住再傳進來。
// 開單、清警報一律「先複述、操作員說 yes／是 才執行」，跟網頁的確認關卡（src/voice/confirmGate.ts）同一套判斷。
function route(text, awaiting = null) {
  const lower = String(text ?? "").toLowerCase();
  const yes = isOperatorYes(String(text ?? ""));

  if (lower.includes("that's all") || lower.includes("that is all")) {
    return {
      action: "end",
      tool: "end_conversation",
      arguments: {},
      agent: ["You are welcome. Goodbye."],
    };
  }

  if (/(clear|reset).*alarm|alarm.*(clear|reset)|解除.*警報/.test(lower)) {
    if (!yes) {
      return {
        action: "ask_clear_alarm",
        tool: null,
        arguments: null,
        awaiting: "clear_alarm",
        agent: ["I will clear alarm 414 on machine 3. Say yes to confirm."],
      };
    }
    return {
      action: "clear_alarm",
      tool: "clear_machine_alarm",
      arguments: { machine_id: "M03" },
      agent: ["Machine alarm has been cleared and reset. System status returned to normal."],
    };
  }

  if (lower.includes("resolve") || lower.includes("resolved") || lower.includes("clear ticket") || lower.includes("fixed") || (lower.includes("解除") && (lower.includes("rt") || lower.includes("1001") || lower.includes("工單")))) {
    const hit = lower.match(/rt-?\d{4}/i);
    const num = hit ? hit[0].replace(/[^0-9]/g, "") : "1001";
    const ticketId = `RT-${num}`;
    return {
      action: "resolve",
      tool: "resolve_repair_ticket",
      arguments: { ticket_id: ticketId },
      agent: [`Repair ticket ${ticketId} has been resolved and closed. Anything else?`],
    };
  }

  if (lower.includes("開立維修單") || lower.includes("維修單") || lower.includes("開單") || lower.includes("報修") || lower.includes("open a ticket") || lower.includes("repair ticket")) {
    if (!yes) {
      const zh = /[\u4e00-\u9fff]/.test(lower);
      return {
        action: "repair",
        tool: "get_maintenance_history",
        arguments: { machine_id: "M03", limit: 3 },
        awaiting: "ticket",
        agent: [
          zh
            ? "我先複述：機台 M03，414 軸過載，嚴重度高，不能繼續生產。請說「是」確認，我才開單。"
            : "Let me read back: machine 3, spindle grinding noise, high, cannot keep running. Say yes to confirm.",
        ],
      };
    }
    return {
      action: "create_ticket",
      tool: "create_repair_ticket",
      arguments: {
        machine_id: "M03",
        symptom: "414 J2 軸伺服負載 142% 過載卡死",
        severity: "high",
        can_keep_running: "no",
        operator_confirmed: "yes",
      },
      agent: ["已為機台 M03 開立高優先度維修單（414 軸過載），主管看板已即時同步收到。"],
    };
  }

  if (/(現在要做什麼|做什麼事|要做什麼|要幹嘛|該做什麼|接下來.*做什麼|我要做什麼|我們要做什麼|有什麼.*事|待辦|任務|下一步|what to do|what should i do)/i.test(lower)) {
    return {
      action: "switch_view",
      tool: "switch_console_view",
      arguments: { view: "f1" },
      agent: ["目前產線第一優先任務：04 加工區 M03 處於 414 軸過載警報停機中，建議先排查主軸或開立維修單。"],
    };
  }

  if (/\barms?\b|\btorque\b|\bf3\b|手臂|刀具|刀庫|磨損/.test(lower)) {
    return {
      action: "switch_view",
      tool: "switch_console_view",
      arguments: { view: "f3" },
      agent: ["Switching console display to robotic arm torque telemetry and tool wear monitoring."],
    };
  }
  if (/\bcoolant\b|\braw material\b|\bf4\b|庫存|切削液/.test(lower)) {
    return {
      action: "switch_view",
      tool: "switch_console_view",
      arguments: { view: "f4" },
      agent: ["Switching console display to raw material inventory and coolant levels."],
    };
  }
  if (/\bfleet\b|\bagvs?\b|\bf2\b|車隊/.test(lower)) {
    return {
      action: "switch_view",
      tool: "switch_console_view",
      arguments: { view: "f2" },
      agent: ["Switching console display to AGV fleet dispatch."],
    };
  }
  if (/\bquality\b|\bcmm\b|\binspection\b|\bf6\b|品檢|公差|粗糙度/.test(lower)) {
    return {
      action: "switch_view",
      tool: "switch_console_view",
      arguments: { view: "f6" },
      agent: ["Switching console display to AI vision and CMM precision quality inspection."],
    };
  }
  if (/\benergy\b|\bcarbon\b|\bhealth\b|\bf7\b|能源|能耗|耗電|電費|碳排|健康|預測健康/.test(lower)) {
    return {
      action: "switch_view",
      tool: "switch_console_view",
      arguments: { view: "f7" },
      agent: ["Switching console display to green energy telemetry and predictive machine health."],
    };
  }
  if (/\boverview\b|\bprocess\b|\bf1\b|總覽|戰情|工單|閥體|產量|倒數|oee|日報|報表/.test(lower)) {
    return {
      action: "switch_view",
      tool: "switch_console_view",
      arguments: { view: "f1" },
      agent: ["Switching console display to process overview and live factory operations."],
    };
  }
  if (/\bshow tickets\b|\bf5\b|通訊/.test(lower)) {
    return {
      action: "switch_view",
      tool: "switch_console_view",
      arguments: { view: "f5" },
      agent: ["Switching console display to repair tickets and external contacts."],
    };
  }

  const machineHit = lower.match(MACHINE_RE);
  const rest = machineHit ? lower.replace(machineHit[0], " ") : lower;

  const digitHit = rest.match(/\d[\d ]*/);
  const wordDigits = digitHit ? null : wordsToDigits(rest);
  const rawCode = digitHit ? digitHit[0] : wordDigits;
  if (rawCode) {
    const code = rawCode.replaceAll(" ", "");
    return {
      action: "alarm",
      tool: "lookup_alarm",
      arguments: { alarm_code: code, machine_id: "M03" },
      agent: [
        `Alarm ${code} means spindle load abnormal, demo data. ` +
          "First, stop the machine and check the tool for chipping. " +
          "Second, verify the speed and feed of this cut. " +
          "Third, check the spindle lubrication oil level.",
      ],
      agentNotFound: [
        "I could not find that alarm code in the table. Could you read the number again?",
      ],
    };
  }

  if (machineHit) {
    return {
      action: "status",
      tool: "get_machine_status",
      arguments: { machine_id: "M03" },
      agent: ["Machine 3 is in alarm. The active alarm code is 414."],
    };
  }

  if (lower.includes("repair") || lower.includes("ticket")) {
    return {
      awaiting: "ticket",
      action: "repair",
      tool: "get_maintenance_history",
      arguments: { machine_id: "M03", limit: 3 },
      agent: [
        "I can open a repair ticket for machine 3. I have pulled the last 3 maintenance records. " +
          "How severe is it, low, medium, or high? And can the machine keep running? " +
          "Let me read back: machine 3, spindle grinding noise, medium, cannot keep running. " +
          "Say yes to confirm.",
      ],
    };
  }

  if (yes && awaiting === "clear_alarm") {
    return {
      action: "clear_alarm",
      tool: "clear_machine_alarm",
      arguments: { machine_id: "M03" },
      agent: ["Machine alarm has been cleared and reset. System status returned to normal."],
    };
  }

  if (yes) {
    return {
      action: "confirm",
      tool: "create_repair_ticket",
      arguments: {
        machine_id: "M03",
        symptom: "spindle grinding noise",
        severity: "medium",
        can_keep_running: "no",
        operator_confirmed: "yes",
      },
      agent: ["Your repair ticket is created. Anything else I can help with?"],
    };
  }

  return {
    action: "fallback",
    tool: null,
    arguments: null,
    agent: ["Sorry, I did not catch that. Could you say it again?"],
  };
}

// 看 tool.result 判斷警報碼有沒有查到（給 --self-test 和連線流程共用）
function isAlarmNotFound(toolResult) {
  if (!toolResult || typeof toolResult !== "object") return false;
  if (toolResult.is_error === true) return true;
  return /not found|unknown code|no record|查無/i.test(JSON.stringify(toolResult.result ?? ""));
}

function decideAgentText(r, toolResultMsg) {
  if (toolResultMsg?.is_error && (r.tool === "create_repair_ticket" || r.tool === "clear_machine_alarm")) {
    return ["Not done yet. Please say yes to confirm first."];
  }
  if (r.action === "alarm" && r.agentNotFound) {
    let parsed = null;
    try {
      parsed = JSON.parse(toolResultMsg?.result ?? "null");
    } catch {
      parsed = null;
    }
    const guess = { is_error: toolResultMsg?.is_error, result: parsed ?? toolResultMsg?.result };
    if (isAlarmNotFound({ is_error: guess.is_error, result: guess.result })) return r.agentNotFound;
  }
  return r.agent;
}

// ---- 自我檢查（不用裝 ws，測上面兩個純函式） ----
function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const eq = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      console.log(`ok ${name}`);
      pass++;
    } else {
      console.error(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`);
      fail++;
    }
  };

  let r = route("Machine three has an alarm.");
  eq("machine-three -> get_machine_status", [r.tool, r.arguments], ["get_machine_status", { machine_id: "M03" }]);

  r = route("What does alarm four one four mean?");
  eq("four-one-four -> lookup_alarm 414", [r.tool, r.arguments], ["lookup_alarm", { alarm_code: "414", machine_id: "M03" }]);

  r = route("Machine 3 is showing alarm 414.");
  eq("machine-3 + 414 -> lookup_alarm 414", [r.tool, r.arguments], ["lookup_alarm", { alarm_code: "414", machine_id: "M03" }]);

  r = route("What about alarm 9999?");
  eq("9999 -> lookup_alarm 9999", [r.tool, r.arguments], ["lookup_alarm", { alarm_code: "9999", machine_id: "M03" }]);
  eq(
    "9999 查無 -> 追問重唸",
    decideAgentText(r, { result: JSON.stringify({ error: "alarm code not found" }), is_error: true }),
    r.agentNotFound,
  );

  r = route("What does alarm four one four mean?");
  eq(
    "414 查到 -> 講三步檢查",
    decideAgentText(r, { result: JSON.stringify({ alarm_code: "414" }) })[0].slice(0, 11),
    "Alarm 414 m".slice(0, 11),
  );

  r = route("I checked. Still noisy. Open a repair ticket.");
  eq("repair -> get_maintenance_history", [r.tool, r.arguments], ["get_maintenance_history", { machine_id: "M03", limit: 3 }]);

  r = route("Yes, confirm.");
  eq("yes -> create_repair_ticket", [r.tool, r.arguments?.operator_confirmed], ["create_repair_ticket", "yes"]);

  r = route("Ticket RT-1001 is resolved.");
  eq("resolve -> resolve_repair_ticket", [r.tool, r.arguments?.ticket_id], ["resolve_repair_ticket", "RT-1001"]);

  r = route("Switch to robotic arm torque telemetry.");
  eq("arm -> switch_console_view f3", [r.tool, r.arguments?.view], ["switch_console_view", "f3"]);

  r = route("Clear machine alarm.");
  eq("clear alarm 沒說 yes -> 先問、不送 tool", [r.tool, r.awaiting], [null, "clear_alarm"]);
  r = route("Yes.", "clear_alarm");
  eq("等清警報時說 yes -> clear_machine_alarm", [r.tool, r.arguments?.machine_id], ["clear_machine_alarm", "M03"]);
  r = route("Yes, clear the alarm.");
  eq("yes + clear alarm -> clear_machine_alarm", r.tool, "clear_machine_alarm");

  r = route("幫我開單");
  eq("中文開單沒說是 -> 先複述（查維修紀錄）", [r.tool, r.awaiting], ["get_maintenance_history", "ticket"]);
  r = route("是", "ticket");
  eq("中文說是 -> create_repair_ticket", r.tool, "create_repair_ticket");
  eq(
    "開單被確認關卡擋下 -> 照實說還沒做",
    decideAgentText(route("Yes, confirm."), { result: JSON.stringify({ error: "NOT DONE" }), is_error: true }),
    ["Not done yet. Please say yes to confirm first."],
  );

  r = route("That's all, thanks.");
  eq("that's-all -> end_conversation", r.tool, "end_conversation");

  r = route("Blah blah blah.");
  eq("聽不懂 -> fallback 不送 tool", r.tool, null);

  if (fail > 0) {
    console.error(`\nSELF-TEST ${pass} passed, ${fail} FAILED`);
    process.exit(1);
  }
  console.log(`\nSELF-TEST ALL ${pass} PASSED`);
}

// ---- WebSocket 伺服器（要先裝 ws） ----
async function startServer() {
  let WebSocketServer;
  try {
    ({ WebSocketServer } = await import("ws"));
  } catch {
    console.error(
      'FAIL 找不到 ws 套件。請大銘點頭後跑：npm install --save-dev ws（規格書 §1 #20），再重開本伺服器。',
    );
    process.exit(1);
  }

  const wss = new WebSocketServer({ port: PORT });
  console.log(`[mock-agent] listening on ws://localhost:${PORT}`);

  wss.on("connection", (ws) => {
    const sessionId = newSessionId();
    let pending = null; // 還沒回 tool.result 的那一通 { callId, route }
    let awaiting = null; // 上一句在等哪種確認（"ticket"／"clear_alarm"）
    console.log(`[mock-agent] connected, session ${sessionId}`);

    const send = (obj) => ws.send(JSON.stringify(obj));

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        console.log("[mock-agent] 收到非 JSON，直接忽略");
        return;
      }

      if (msg.type === "session.update") {
        pending = null;
        send({ type: "session.ready", session_id: sessionId });
        return;
      }

      if (msg.type === "mock.say") {
        const text = String(msg.text ?? "");
        send({ type: "transcript.user", text });
        const r = route(text, awaiting);
        awaiting = r.awaiting ?? null;
        if (!r.tool) {
          for (const line of r.agent) send({ type: "transcript.agent", text: line });
          send({ type: "reply.audio", data: silenceB64() }); // 官方格式：聲音在 data 欄位（2026-09-25 總管對過文件）
          send({ type: "reply.done" });
          return;
        }
        const callId = nextCallId();
        pending = { callId, route: r };
        send({ type: "tool.call", call_id: callId, name: r.tool, arguments: r.arguments });
        return;
      }

      if (msg.type === "tool.result") {
        if (!pending || msg.call_id !== pending.callId) {
          console.log(`[mock-agent] tool.result 的 call_id 對不上（${msg.call_id}），忽略`);
          return;
        }
        const lines = decideAgentText(pending.route, msg);
        pending = null;
        for (const line of lines) send({ type: "transcript.agent", text: line });
        send({ type: "reply.audio", data: silenceB64() }); // 官方格式：聲音在 data 欄位（2026-09-25 總管對過文件）
        send({ type: "reply.done" });
        return;
      }

      if (msg.type === "session.end") {
        pending = null;
        send({ type: "session.ended", session_id: sessionId });
        return;
      }

      if (msg.type === "input.audio") return; // 模擬層不聽真聲音
      console.log(`[mock-agent] 未知事件 ${msg.type}，忽略`);
    });
  });
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  await startServer();
}
