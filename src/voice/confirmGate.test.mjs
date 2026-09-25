// Unit tests for the confirmation gate (總管 2026-09-25).
// Run: node --test src/voice/confirmGate.test.mjs (no extra packages needed).
// The two "real session" cases replay the event order recorded from the real
// AssemblyAI Voice Agent API on 2026-09-25 (transcripts + tool calls only).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONFIRM_REQUIRED_TOOLS, createConfirmGate, isOperatorYes } from "./confirmGate.ts";

/** Feed [kind, text] events into a fresh gate; return what each tool call got. */
function replay(events) {
  const gate = createConfirmGate();
  const calls = [];
  for (const [kind, text] of events) {
    if (kind === "user") gate.onUserTranscript(text);
    else if (kind === "agent") gate.onAgentTranscript();
    else if (kind === "tool") calls.push([text, gate.check(text).allowed]);
  }
  return { gate, calls };
}

describe("isOperatorYes", () => {
  it("accepts clear English yes", () => {
    for (const t of ["Yes.", "Yes, confirm.", "Yes. Confirm.", "Yeah, go ahead.", "Correct.", "That's right.", "That’s right, submit it.", "Yes, no problem."]) {
      assert.equal(isOperatorYes(t), true, t);
    }
  });
  it("accepts short OK / sure only as a whole short answer", () => {
    assert.equal(isOperatorYes("Okay."), true);
    assert.equal(isOperatorYes("Sure, thanks."), true);
    assert.equal(isOperatorYes("OK so the spindle is grinding and severity is high and it cannot run"), false);
  });
  it("rejects answers without a yes", () => {
    for (const t of ["", "Please open a repair ticket.", "The spindle makes a grinding noise. Severity is high. The machine cannot keep running.", "Machine 3 has an alarm."]) {
      assert.equal(isOperatorYes(t), false, t);
    }
  });
  it("rejects a yes that is taken back", () => {
    for (const t of ["No.", "Yes, wait.", "Don't submit it yet.", "Cancel.", "Not yet, hold on."]) {
      assert.equal(isOperatorYes(t), false, t);
    }
  });
  it("handles Chinese", () => {
    for (const t of ["是", "是的。", "對", "好的", "確認", "沒問題，送出"]) assert.equal(isOperatorYes(t), true, t);
    for (const t of ["不要", "先不要開", "等一下", "主軸有異音，嚴重度高，不能繼續跑", "是主軸有異音，嚴重度高，機台不能跑了喔"]) {
      assert.equal(isOperatorYes(t), false, t);
    }
  });
});

describe("createConfirmGate", () => {
  it("only gates ticket creation and alarm clearing", () => {
    assert.deepEqual([...CONFIRM_REQUIRED_TOOLS].sort(), ["clear_machine_alarm", "create_repair_ticket"]);
    const gate = createConfirmGate();
    for (const name of ["get_machine_status", "lookup_alarm", "get_maintenance_history", "resolve_repair_ticket", "switch_console_view", "end_conversation"]) {
      assert.equal(gate.check(name).allowed, true, name);
    }
  });

  it("blocks a ticket when the operator never spoke", () => {
    const r = createConfirmGate().check("create_repair_ticket");
    assert.equal(r.allowed, false);
    assert.match(r.error, /NO ticket was created/);
  });

  it("joins the fragments of one operator turn", () => {
    const { calls } = replay([["agent"], ["user", "Yes."], ["user", "Confirm."], ["tool", "create_repair_ticket"]]);
    assert.deepEqual(calls, [["create_repair_ticket", true]]);
  });

  it("keeps the yes when the agent talks before calling the tool in the same reply", () => {
    const { calls } = replay([["agent"], ["user", "Yes, confirm."], ["agent"], ["tool", "create_repair_ticket"]]);
    assert.deepEqual(calls, [["create_repair_ticket", true]]);
  });

  it("uses one yes only once", () => {
    const { calls } = replay([["agent"], ["user", "Yes."], ["tool", "create_repair_ticket"], ["tool", "create_repair_ticket"]]);
    assert.deepEqual(calls, [["create_repair_ticket", true], ["create_repair_ticket", false]]);
  });

  it("a new operator turn without yes does not reuse the old yes", () => {
    const { calls } = replay([
      ["agent"], ["user", "Yes."], ["tool", "create_repair_ticket"],
      ["agent"], ["user", "Clear the alarm."], ["tool", "clear_machine_alarm"],
      ["agent"], ["user", "Yes, clear it."], ["tool", "clear_machine_alarm"],
    ]);
    assert.deepEqual(calls, [["create_repair_ticket", true], ["clear_machine_alarm", false], ["clear_machine_alarm", true]]);
  });

  it("reset forgets everything", () => {
    const gate = createConfirmGate();
    gate.onUserTranscript("Yes.");
    gate.reset();
    assert.equal(gate.check("create_repair_ticket").allowed, false);
  });

  it("real session 2026-09-25 run 3: ticket after 'Yes.' 'Confirm.' is allowed", () => {
    const { calls } = replay([["agent"],["user","Machine 3 has an alarm."],["tool","get_machine_status"],["tool","lookup_alarm"],["agent"],["agent"],["user","What does alarm 414 mean?"],["agent"],["user","I checked it."],["user","Is still noisy."],["user","Please open a repair ticket."],["user","The spindle makes a grinding noise. Severity is high. The machine cannot keep running."],["agent"],["user","Yes."],["user","Confirm."],["tool","create_repair_ticket"],["agent"],["user","Ticket RT1001 is resolved."],["tool","resolve_repair_ticket"],["agent"],["user","That's all."],["user","Thank you."],["tool","end_conversation"]]);
    assert.deepEqual(calls.find(([n]) => n === "create_repair_ticket"), ["create_repair_ticket", true]);
    assert.ok(calls.every(([, ok]) => ok));
  });

  it("real session 2026-09-25 retake: the agent's premature ticket is blocked, the later yes would pass", () => {
    const { gate, calls } = replay([["agent"],["user","Machine 3 has an alarm."],["tool","get_machine_status"],["agent"],["user","I checked it. It is still noisy. Please open a repair ticket."],["agent"],["user","The spindle makes a grinding noise."],["user","Severity is high."],["user","Machine cannot keep running."],["agent"],["tool","create_repair_ticket"],["agent"],["user","Yes, confirm."]]);
    assert.deepEqual(calls.find(([n]) => n === "create_repair_ticket"), ["create_repair_ticket", false]);
    assert.equal(gate.check("create_repair_ticket").allowed, true);
  });
});
