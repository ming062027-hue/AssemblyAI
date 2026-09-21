"use client";

// Live repair-ticket board (dashboard line).
//
// - <LiveBoard />: full table for /dashboard.
// - <LiveBoard compact />: latest 5 tickets, for the operator page's side panel.
// Listens to ticketStore, so new tickets appear without a page refresh.
// The "clear demo data" button only renders outside production builds.

import { useEffect, useState } from "react";
import { clearAll, subscribe, type Ticket } from "./ticketStore";

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const showClearButton = process.env.NODE_ENV !== "production";

function ClearDemoButton() {
  if (!showClearButton) return null;
  return (
    <button
      type="button"
      data-testid="clear-demo-data"
      onClick={() => clearAll()}
      className="rounded-lg border border-black/15 px-3 py-1.5 text-sm text-black/70 hover:bg-black/5 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10"
    >
      Clear demo data
    </button>
  );
}

export default function LiveBoard({ compact = false }: { compact?: boolean }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    // subscribe() delivers the current list immediately, then updates.
    return subscribe(setTickets);
  }, []);

  if (compact) {
    const latest = [...tickets].slice(-5).reverse();
    return (
      <section aria-label="Latest tickets" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Latest tickets</h2>
          <ClearDemoButton />
        </div>
        {latest.length === 0 ? (
          <p className="text-sm text-slate-600">
            No tickets yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {latest.map((ticket) => {
              const isResolved = ticket.status === "resolved";
              return (
                <li
                  key={ticket.ticket_id}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    isResolved
                      ? "border-emerald-300 bg-emerald-50/40 text-slate-700"
                      : "border-slate-300 bg-white text-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{ticket.ticket_id}</span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 text-[11px] font-bold rounded ${
                        isResolved
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-amber-100 text-amber-800 border border-amber-300 animate-pulse"
                      }`}
                    >
                      {isResolved ? "RESOLVED" : "OPEN"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    <span>{ticket.machine_id}</span>
                    {" · "}
                    <span>{ticket.symptom}</span>
                    {" · "}
                    <span className="capitalize">{ticket.severity}</span>
                  </div>
                  <span className="block mt-1 text-[11px] text-slate-500">
                    Opened: {formatTime(ticket.created_at)}
                    {isResolved && ticket.resolved_at && (
                      <span className="text-emerald-700 font-medium ml-1">
                        · Closed: {formatTime(ticket.resolved_at)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  const openCount = tickets.filter((t) => (t.status ?? "open") === "open").length;
  const resolvedCount = tickets.length - openCount;

  return (
    <section aria-label="Repair tickets" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {tickets.length === 0
            ? "Waiting for tickets… 等待語音開單"
            : `${openCount} open · ${resolvedCount} resolved (${tickets.length} total)`}
        </p>
        <ClearDemoButton />
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#9aa3b4] bg-white">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-slate-100 border-b border-[#9aa3b4] text-[#202731]">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Ticket
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Machine
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Symptom
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Severity
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Can keep running
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Timeline
              </th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-slate-600"
                >
                  No tickets yet.
                </td>
              </tr>
            ) : (
              tickets.map((ticket) => {
                const isResolved = ticket.status === "resolved";
                return (
                  <tr
                    key={ticket.ticket_id}
                    className={`border-t border-slate-200 transition-colors ${
                      isResolved ? "bg-emerald-50/20" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full border ${
                          isResolved
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-50 text-amber-700 border-amber-200 animate-pulse"
                        }`}
                      >
                        {isResolved ? "RESOLVED" : "OPEN"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{ticket.ticket_id}</td>
                    <td className="px-4 py-3">{ticket.machine_id}</td>
                    <td className="px-4 py-3">{ticket.symptom}</td>
                    <td className="px-4 py-3 capitalize">{ticket.severity}</td>
                    <td className="px-4 py-3">{ticket.can_keep_running}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      <div>Opened: {formatTime(ticket.created_at)}</div>
                      {isResolved && ticket.resolved_at && (
                        <div className="text-emerald-700 font-medium">
                          Closed: {formatTime(ticket.resolved_at)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
