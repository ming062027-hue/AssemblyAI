// Tool handler functions for the shop-floor voice demo (dashboard line).
//
// All demo data (machines, alarms, maintenance) are fictional sample data.
// Reads: src/data/*.json (read-only). Writes: repair tickets via the
// swappable TicketStorage below (localStorage in the browser, memory in tests).

import machinesData from "../data/machines.json" with { type: "json" };
import alarmsData from "../data/alarms.json" with { type: "json" };
import maintenanceData from "../data/maintenance.json" with { type: "json" };

export interface Machine {
  id: string;
  name: string;
  location: string;
  status: string;
  current_alarm: string | null;
  material_left: number;
}

export interface Alarm {
  code: string;
  title: string;
  likely_causes: string;
  first_checks: string[];
  severity: string;
  needs_technician: boolean;
}

export interface MaintenanceRecord {
  machine_id: string;
  date: string;
  item: string;
  technician: string;
}

export interface Ticket {
  ticket_id: string;
  machine_id: string;
  symptom: string;
  severity: string;
  can_keep_running: string;
  started?: string;
  alarm_code?: string;
  created_at: string;
  // 工單生命週期（派工包 v2 §4）：open＝待修、resolved＝維修完成已解除。
  // 舊單沒有 status 欄的一律視為 open。
  status?: "open" | "resolved";
  resolved_at?: string;
}

export interface HandlerError {
  error: string;
}

const machines = machinesData as Machine[];
const alarms = alarmsData as Alarm[];
const maintenanceRecords = maintenanceData as MaintenanceRecord[];

const VALID_IDS = machines.map((m) => m.id);

function unknownMachineError(machineId: unknown): HandlerError {
  return {
    error: `Unknown machine ${String(machineId)}. Valid IDs are ${VALID_IDS[0]} to ${VALID_IDS[VALID_IDS.length - 1]}.`,
  };
}

// ---------------------------------------------------------------------------
// Ticket storage: swappable layer.
// - In the browser (localStorage available): persists to localStorage key
//   "demo.tickets" so tickets survive a page refresh.
// - In tests / Node: falls back to an in-memory list.
// - Tests can inject their own store via configureTicketStorage().
// ---------------------------------------------------------------------------

export const TICKETS_STORAGE_KEY = "demo.tickets";
export const TICKETS_CHANNEL = "demo-tickets";
const FIRST_TICKET_NUMBER = 1001;

export interface TicketStorage {
  load(): Ticket[];
  saveAll(tickets: Ticket[]): void;
}

export function memoryTicketStorage(): TicketStorage {
  let tickets: Ticket[] = [];
  return {
    load: () => [...tickets],
    saveAll: (next: Ticket[]) => {
      tickets = [...next];
    },
  };
}

function browserTicketStorage(): TicketStorage {
  return {
    load: () => {
      try {
        const raw = localStorage.getItem(TICKETS_STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as Ticket[]) : [];
      } catch {
        return [];
      }
    },
    saveAll: (tickets: Ticket[]) => {
      localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(tickets));
    },
  };
}

let activeStorage: TicketStorage | null = null;

/** Swap the storage layer (tests use memory; browser default is localStorage). */
export function configureTicketStorage(storage: TicketStorage | null): void {
  activeStorage = storage;
}

function getStorage(): TicketStorage {
  if (activeStorage) return activeStorage;
  if (typeof localStorage !== "undefined") return browserTicketStorage();
  if (typeof globalThis !== "undefined") {
    const g = globalThis as Record<string, unknown>;
    if (!g.__dashboardMemoryTickets) {
      g.__dashboardMemoryTickets = memoryTicketStorage();
    }
    return g.__dashboardMemoryTickets as TicketStorage;
  }
  return memoryTicketStorage();
}

function nextTicketId(tickets: Ticket[]): string {
  let max = FIRST_TICKET_NUMBER - 1;
  for (const t of tickets) {
    const m = /^RT-(\d+)$/.exec(t.ticket_id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `RT-${max + 1}`;
}

function notifyNewTicket(ticket: Ticket): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(TICKETS_CHANNEL);
    channel.postMessage({ type: "ticket-created", ticket });
    channel.close();
  } catch {
    // BroadcastChannel is best-effort: the ticket is already saved.
  }
}

function notifyTicketResolved(ticket: Ticket): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(TICKETS_CHANNEL);
    channel.postMessage({ type: "ticket-resolved", ticket });
    channel.close();
  } catch {
    // BroadcastChannel is best-effort: the ticket is already saved.
  }
}

// ---------------------------------------------------------------------------
// Tool handlers. Success returns data; failure returns { error: "..." }.
// ---------------------------------------------------------------------------

export function get_machine_status(args: {
  machine_id: string;
}): Machine | HandlerError {
  const found = machines.find((m) => m.id === args?.machine_id);
  if (!found) return unknownMachineError(args?.machine_id);
  return found;
}

export function lookup_alarm(args: {
  alarm_code: string | number;
  machine_id?: string;
}): Alarm | HandlerError {
  // Operators may read digits with pauses ("4 1 4"), so strip spaces first.
  const normalized = String(args?.alarm_code ?? "").replace(/\s+/g, "");
  const found = alarms.find((a) => a.code === normalized);
  if (!found) {
    return {
      error: `Alarm ${normalized} is not in the demo table. Do not guess; ask the operator to read the code again.`,
    };
  }
  return found;
}

export function get_maintenance_history(args: {
  machine_id: string;
  limit?: number;
}):
  | { machine_id: string; count: number; records: MaintenanceRecord[] }
  | HandlerError {
  const found = machines.find((m) => m.id === args?.machine_id);
  if (!found) return unknownMachineError(args?.machine_id);
  const rawLimit = typeof args?.limit === "number" ? args.limit : 3;
  const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 5);
  const records = maintenanceRecords
    .filter((r) => r.machine_id === args.machine_id)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
  return { machine_id: args.machine_id, count: records.length, records };
}

export function create_repair_ticket(args: {
  machine_id: string;
  symptom: string;
  severity: string;
  can_keep_running: string;
  started?: string;
  alarm_code?: string;
  operator_confirmed: string;
}): { ticket_id: string; created_at: string } | HandlerError {
  if (args?.operator_confirmed !== "yes") {
    return {
      error:
        'Repair ticket was not created because operator_confirmed is not "yes". Read back the machine, symptom, severity and whether production can continue, then create the ticket only after the operator says yes.',
    };
  }
  const machine = machines.find((m) => m.id === args.machine_id);
  if (!machine) return unknownMachineError(args.machine_id);
  const storage = getStorage();
  const tickets = storage.load();
  const ticket: Ticket = {
    ticket_id: nextTicketId(tickets),
    machine_id: args.machine_id,
    symptom: args.symptom,
    severity: args.severity,
    can_keep_running: args.can_keep_running,
    created_at: new Date().toISOString(),
    status: "open",
  };
  if (args.started !== undefined) ticket.started = args.started;
  if (args.alarm_code !== undefined) ticket.alarm_code = args.alarm_code;
  storage.saveAll([...tickets, ticket]);
  notifyNewTicket(ticket);
  return { ticket_id: ticket.ticket_id, created_at: ticket.created_at };
}

// 派工包 v2 §4：維修完成→解除工單。status open→resolved＋resolved_at，
// 同樣走 localStorage（鍵不變）＋BroadcastChannel（同頻道）同步 /dashboard。
export function resolve_repair_ticket(args: {
  ticket_id: string;
}):
  | { ticket_id: string; status: "resolved"; resolved_at: string }
  | HandlerError {
  const wanted = String(args?.ticket_id ?? "")
    .trim()
    .toUpperCase();
  const storage = getStorage();
  const tickets = storage.load();
  const idx = tickets.findIndex(
    (t) => t.ticket_id.toUpperCase() === wanted,
  );
  if (idx < 0) {
    const openIds = tickets
      .filter((t) => (t.status ?? "open") === "open")
      .map((t) => t.ticket_id)
      .join(", ");
    return {
      error: `Ticket ${String(args?.ticket_id)} not found.${openIds ? ` Open tickets: ${openIds}.` : " No open tickets."}`,
    };
  }
  const target = tickets[idx];
  if ((target.status ?? "open") === "resolved") {
    return {
      ticket_id: target.ticket_id,
      status: "resolved",
      resolved_at: target.resolved_at ?? target.created_at,
    };
  }
  const resolved: Ticket = {
    ...target,
    status: "resolved",
    resolved_at: new Date().toISOString(),
  };
  const next = [...tickets];
  next[idx] = resolved;
  storage.saveAll(next);
  notifyTicketResolved(resolved);
  const resolvedAt = resolved.resolved_at ?? new Date().toISOString();
  return {
    ticket_id: resolved.ticket_id,
    status: "resolved",
    resolved_at: resolvedAt,
  };
}
