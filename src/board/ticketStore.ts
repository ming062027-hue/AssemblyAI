// Ticket store for the live supervisor board (dashboard line).
//
// Reads and writes the same browser storage as the P6 tool handlers so both
// paths stay in sync:
// - localStorage key "demo.tickets" (tickets survive a page refresh)
// - BroadcastChannel "demo-tickets" (new tickets appear without refresh)
//
// API: list() / add(ticket) / subscribe(callback). clearAll() backs the
// dev-only "clear demo data" button on the board.

import type { Ticket } from "../tools/handlers";

export type { Ticket };

// Must stay identical to TICKETS_STORAGE_KEY / TICKETS_CHANNEL in
// src/tools/handlers.ts (imported as type-only above so this file also runs
// under plain Node, which cannot resolve extensionless TS imports).
const TICKETS_STORAGE_KEY = "demo.tickets";
const TICKETS_CHANNEL = "demo-tickets";

export type TicketListener = (tickets: Ticket[]) => void;

type TicketMessage =
  | { type: "ticket-created"; ticket: Ticket }
  | { type: "ticket-resolved"; ticket: Ticket }
  | { type: "tickets-cleared" };

function readStored(): Ticket[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(TICKETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Ticket[]) : [];
  } catch {
    return [];
  }
}

function writeStored(tickets: Ticket[]): void {
  localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(tickets));
}

function broadcast(message: TicketMessage): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(TICKETS_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // Broadcast is best-effort: the ticket is already saved.
  }
}

// Same-tab listeners: BroadcastChannel and storage events only fire in
// *other* tabs, so add()/clearAll() notify this tab directly.
const localListeners = new Set<TicketListener>();

function emitToLocal(tickets: Ticket[]): void {
  for (const listener of localListeners) {
    try {
      listener(tickets);
    } catch {
      // One bad listener must not break the others.
    }
  }
}

/** All tickets, oldest first. Returns [] outside the browser. */
export function list(): Ticket[] {
  return readStored();
}

/** Save one ticket, broadcast it, and notify this tab's listeners. */
export function add(ticket: Ticket): Ticket[] {
  const next = [...readStored(), ticket];
  writeStored(next);
  broadcast({ type: "ticket-created", ticket });
  emitToLocal(next);
  return next;
}

/**
 * 派工包 v2 §4：把一張單標成已完成（status→resolved＋resolved_at），
 * 寫回同一把 localStorage 鍵、走同一條 BroadcastChannel，
 * /dashboard 靠既有 subscribe 自動同步，不用改看板檔。
 * 找不到單號時回傳 null（不炸）。
 */
export function resolve(ticketId: string): Ticket[] | null {
  const wanted = String(ticketId ?? "").trim().toUpperCase();
  const stored = readStored();
  const idx = stored.findIndex((t) => t.ticket_id.toUpperCase() === wanted);
  if (idx < 0) return null;
  const target = stored[idx];
  if ((target.status ?? "open") === "resolved") return stored;
  const done: Ticket = {
    ...target,
    status: "resolved",
    resolved_at: new Date().toISOString(),
  };
  const next = [...stored];
  next[idx] = done;
  writeStored(next);
  broadcast({ type: "ticket-resolved", ticket: done });
  emitToLocal(next);
  return next;
}

/** Remove all tickets and tell every open tab to go empty. */
export function clearAll(): void {
  writeStored([]);
  broadcast({ type: "tickets-cleared" });
  emitToLocal([]);
}

/**
 * Re-run `callback` with the fresh list whenever any tab adds or clears
 * tickets. Calls back once immediately with the current list, and returns
 * an unsubscribe function.
 */
export function subscribe(callback: TicketListener): () => void {
  localListeners.add(callback);

  const refresh = () => {
    callback(readStored());
  };

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(TICKETS_CHANNEL);
      channel.onmessage = refresh;
    }
  } catch {
    channel = null;
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === TICKETS_STORAGE_KEY) refresh();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  // Current list right away, so a refresh keeps showing saved tickets.
  callback(readStored());

  return () => {
    localListeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
    try {
      channel?.close();
    } catch {
      // Ignore close errors during teardown.
    }
  };
}
