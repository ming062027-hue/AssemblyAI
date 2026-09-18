// P6 acceptance test: 7 cases (5 from the dispatch pack + 2 from spec §4.2).
// Run: node --test src/tools/handlers.test.mjs (no extra packages needed).
// Plain .mjs (not type-checked) importing the TS handlers, which Node
// runs via built-in type stripping. tsc --noEmit still checks handlers.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  configureTicketStorage,
  create_repair_ticket,
  get_machine_status,
  get_maintenance_history,
  lookup_alarm,
  memoryTicketStorage,
} from "./handlers.ts";

describe("tool handlers (demo data)", () => {
  it("1.查 M03 的狀態：alarm 中、目前警報 414", () => {
    const res = get_machine_status({ machine_id: "M03" });
    assert.ok(!("error" in res), `expected machine, got ${JSON.stringify(res)}`);
    assert.equal(res.status, "alarm");
    assert.equal(res.current_alarm, "414");
  });

  it("2.查警報 414：找得到、自編示範內容", () => {
    const res = lookup_alarm({ alarm_code: "414" });
    assert.ok(!("error" in res), `expected alarm, got ${JSON.stringify(res)}`);
    assert.equal(res.code, "414");
    assert.equal(res.first_checks.length, 3);
  });

  it("3.查警報 9999：回 error、不亂編", () => {
    const res = lookup_alarm({ alarm_code: "9999" });
    assert.ok("error" in res, "expected an error result");
    assert.match(res.error, /9999/);
  });

  it("4.查 M01 的保養紀錄：3 筆、新的排前面", () => {
    const res = get_maintenance_history({ machine_id: "M01" });
    assert.ok(!("error" in res), `expected records, got ${JSON.stringify(res)}`);
    assert.equal(res.records.length, 3);
    assert.ok(res.records[0].date >= res.records[1].date);
    assert.ok(res.records[1].date >= res.records[2].date);
  });

  it("5.沒確認就開單：回 error、不開單", () => {
    configureTicketStorage(memoryTicketStorage());
    const res = create_repair_ticket({
      machine_id: "M03",
      symptom: "spindle grinding noise",
      severity: "medium",
      can_keep_running: "no",
      operator_confirmed: "no",
    });
    assert.ok("error" in res, "expected an error result");
    assert.match(res.error, /not "yes"/);
  });

  it("6.同一個存放層連開 2 張：單號 RT-1001、RT-1002 遞增", () => {
    configureTicketStorage(memoryTicketStorage());
    const base = {
      machine_id: "M03",
      symptom: "spindle grinding noise",
      severity: "medium",
      can_keep_running: "no",
      operator_confirmed: "yes",
    };
    const first = create_repair_ticket({ ...base });
    const second = create_repair_ticket({ ...base });
    assert.ok(!("error" in first));
    assert.ok(!("error" in second));
    assert.equal(first.ticket_id, "RT-1001");
    assert.equal(second.ticket_id, "RT-1002");
  });

  it('7.lookup_alarm("4 1 4")：去空格後查到 414', () => {
    const res = lookup_alarm({ alarm_code: "4 1 4" });
    assert.ok(!("error" in res), `expected alarm, got ${JSON.stringify(res)}`);
    assert.equal(res.code, "414");
  });
});
