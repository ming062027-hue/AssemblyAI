// validate-schema.mjs — 語音線 schema 檢查（不連線、不花錢）
// 用法（在 app/ 目錄跑）：node scripts/validate-schema.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsPath = path.resolve(here, "../src/voice/tools.ts");
const raw = fs.readFileSync(toolsPath, "utf-8");

// tools.ts 目前是純值（無型別註記），去掉 export 即可求值
const js = raw.replaceAll("export const", "const");
const scope = new Function(`${js}; return { TOOLS_S0, TOOLS_S1 };`)();
const { TOOLS_S0, TOOLS_S1 } = scope;

let errors = 0;
const fail = (msg) => { console.error(`FAIL ${msg}`); errors++; };
const pass = (msg) => console.log(`ok ${msg}`);

console.log(`TOOLS_S0: ${TOOLS_S0.map((t) => t.name).join(", ")}`);
console.log(`TOOLS_S1: ${TOOLS_S1.map((t) => t.name).join(", ")}`);

const s0Names = TOOLS_S0.map((t) => t.name);
const s1Names = TOOLS_S1.map((t) => t.name);
for (const n of ["get_machine_status", "lookup_alarm", "get_maintenance_history", "end_conversation"]) {
  if (!s0Names.includes(n)) fail(`TOOLS_S0 缺 ${n}`);
}
if (s0Names.includes("create_repair_ticket")) fail("TOOLS_S0 不該含 create_repair_ticket");
for (const n of [...s0Names, "create_repair_ticket", "resolve_repair_ticket"]) {
  if (!s1Names.includes(n)) fail(`TOOLS_S1 缺 ${n}`);
}
if (errors === 0) pass("S0/S1 組合正確");

const seen = new Map();
for (const t of [...TOOLS_S0, ...TOOLS_S1]) seen.set(t.name, t);
for (const tool of seen.values()) {
  if (tool.type !== "function") fail(`[${tool.name}] type 不是 function`);
  const params = tool.parameters;
  if (!params || params.type !== "object" || !params.properties) {
    fail(`[${tool.name}] parameters 不是 object/properties`);
    continue;
  }
  for (const req of params.required ?? []) {
    if (!(req in params.properties)) fail(`[${tool.name}] required 的 ${req} 不在 properties`);
  }
  for (const [key, field] of Object.entries(params.properties)) {
    if (!field.enum && !field.examples && !field.pattern) {
      fail(`[${tool.name}] 欄位 ${key} 缺 enum/examples/pattern`);
    }
    if (field.pattern && field.examples) {
      const re = new RegExp(`^(?:${field.pattern})$`);
      for (const ex of field.examples) {
        if (re.test(String(ex))) pass(`[${tool.name}] ${key} 例子 ${JSON.stringify(ex)} 符合 ${field.pattern}`);
        else fail(`[${tool.name}] 欄位 ${key} 例子 ${JSON.stringify(ex)} 不符合 ${field.pattern}`);
      }
    }
  }
}

if (errors > 0) { console.error(`\n共 ${errors} 個失敗`); process.exit(1); }
console.log("\n全部通過");
