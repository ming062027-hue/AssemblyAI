import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interpret } from "./commands.ts";
import { configureTicketStorage, memoryTicketStorage } from "../tools/handlers.ts";

describe("15 Universal Quick Actions for CNC-640 Console", () => {
  const ctx = { lang: "zh", pendingView: null, alarm: null, machine: "M03" };

  it("1. 智慧戰情報告 -> F1, 結構化分析", () => {
    const res = interpret("智慧戰情報告", ctx);
    assert.equal(res.actionId, "report.briefing");
    assert.equal(res.navigate, "f1");
    assert.match(res.response, /CNC-640 產線智慧戰情報告/);
  });

  it("2. 最新品檢報告 -> F6, CMM 測量數據", () => {
    const res = interpret("最新品檢報告", ctx);
    assert.equal(res.actionId, "qc.report");
    assert.equal(res.navigate, "f6");
    assert.match(res.response, /Part #348/);
  });

  it("3. 廠房即時能耗 -> F7, 耗電功率與 ESG 碳排", () => {
    const res = interpret("廠房即時能耗", ctx);
    assert.equal(res.actionId, "energy.report");
    assert.equal(res.navigate, "f7");
    assert.match(res.response, /28.4 kW/);
  });

  it("4. 設備預測健康 -> F7, 軸承與切削水頻譜診斷", () => {
    const res = interpret("設備預測健康", ctx);
    assert.equal(res.actionId, "health.report");
    assert.equal(res.navigate, "f7");
    assert.match(res.response, /設備預測健康度診斷/);
  });

  it("5. 換切燃油閥體 -> F1, MES 切換工單 B202", () => {
    const res = interpret("換切燃油閥體", ctx);
    assert.equal(res.actionId, "workorder.switch");
    assert.equal(res.navigate, "f1");
    assert.equal(res.workOrder, "B202");
    assert.match(res.response, /WO-2026-B202/);
  });

  it("6. 查 414 警報 -> alarm lookup & 414 推播", () => {
    const res = interpret("查 414 警報", ctx);
    assert.equal(res.actionId, "alarm.lookup");
    assert.ok(res.alarm);
    assert.equal(res.alarm.code, "414");
    assert.match(res.response, /【異常推播】警報 414/);
  });

  it("7. F3 手臂軸向 -> F3 手臂畫面", () => {
    const res = interpret("F3 手臂軸向", ctx);
    assert.equal(res.actionId, "nav.view");
    assert.equal(res.navigate, "f3");
  });

  it("8. 開立維修單 -> 真實開立單據與通知看板", () => {
    configureTicketStorage(memoryTicketStorage());
    const res = interpret("開立維修單", ctx);
    assert.equal(res.actionId, "ticket.create");
    assert.ok(res.ticketId);
    assert.match(res.response, /已為 M03 開出高優先度維修單/);
  });

  it("9. 解除警報 -> 警報清除", () => {
    const res = interpret("解除警報", ctx);
    assert.equal(res.actionId, "alarm.clear");
    assert.equal(res.clearAlarm, true);
    assert.match(res.response, /警報已解除/);
  });

  it("10. 解除 RT-1001 -> 結案維修單閉環", () => {
    configureTicketStorage(memoryTicketStorage());
    const res = interpret("解除 RT-1001", ctx);
    assert.equal(res.actionId, "ticket.resolve");
    assert.ok(res.ticketResolveId);
    assert.match(res.response, /維修單 RT-1001 已解除/);
  });

  it("11. 今日工廠日報 -> F1, 統計報表", () => {
    const res = interpret("今日工廠日報", ctx);
    assert.equal(res.actionId, "report.daily");
    assert.equal(res.navigate, "f1");
    assert.match(res.response, /今日報表/);
  });

  it("12. 刀具磨損預警 -> F3, 刀庫狀態", () => {
    const res = interpret("刀具磨損預警", ctx);
    assert.equal(res.actionId, "tool.status");
    assert.equal(res.navigate, "f3");
    assert.match(res.response, /T03 精銑球刀/);
  });

  it("13. 今日產量進度 -> F1, 生產達成率", () => {
    const res = interpret("今日產量進度", ctx);
    assert.equal(res.actionId, "production.progress");
    assert.equal(res.navigate, "f1");
    assert.match(res.response, /當班目標 500 件/);
  });

  it("14. 切削倒數時間 -> F1, 剩餘單節時間", () => {
    const res = interpret("切削倒數時間", ctx);
    assert.equal(res.actionId, "cycle.remaining");
    assert.equal(res.navigate, "f1");
    assert.match(res.response, /單節 N0420/);
  });

  it("15. OEE與停機損失 -> F1, 稼動率計算", () => {
    const res = interpret("OEE與停機損失", ctx);
    assert.equal(res.actionId, "oee.status");
    assert.equal(res.navigate, "f1");
    assert.match(res.response, /總體 OEE 87.5%/);
  });

  it("16. 現在要做什麼事 -> F1, 現場即時任務指引", () => {
    const res = interpret("現在要做什麼事", ctx);
    assert.equal(res.actionId, "action.guidance");
    assert.equal(res.navigate, "f1");
    assert.match(res.response, /當前第一優先任務|待辦維修事項|產線順暢推進/);
  });
});
