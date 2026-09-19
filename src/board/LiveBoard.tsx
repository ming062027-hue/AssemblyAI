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
            {latest.map((ticket) => (
              <li
                key={ticket.ticket_id}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium">{ticket.ticket_id}</span>
                {" · "}
                {ticket.machine_id}
                {" · "}
                {ticket.symptom}
                {" · "}
                {ticket.severity}
                <span className="block text-xs text-slate-600">
                  {formatTime(ticket.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Repair tickets" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {tickets.length === 0
            ? "Waiting for tickets… 等待語音開單"
            : `${tickets.length} open ticket${tickets.length === 1 ? "" : "s"}`}
        </p>
        <ClearDemoButton />
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#9aa3b4] bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-100 border-b border-[#9aa3b4] text-[#202731]">
            <tr>
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
                Opened
              </th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-600"
                >
                  No open tickets yet.
                </td>
              </tr>
            ) : (
              tickets.map((ticket) => (
                <tr
                  key={ticket.ticket_id}
                  className="border-t border-slate-200"
                >
                  <td className="px-4 py-3 font-medium">{ticket.ticket_id}</td>
                  <td className="px-4 py-3">{ticket.machine_id}</td>
                  <td className="px-4 py-3">{ticket.symptom}</td>
                  <td className="px-4 py-3">{ticket.severity}</td>
                  <td className="px-4 py-3">{ticket.can_keep_running}</td>
                  <td className="px-4 py-3">{formatTime(ticket.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
