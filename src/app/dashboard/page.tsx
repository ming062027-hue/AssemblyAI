import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Supervisor dashboard",
};

const columns = [
  "Ticket",
  "Machine",
  "Symptom",
  "Severity",
  "Can keep running",
  "Opened",
] as const;

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm text-black/60 hover:underline dark:text-white/60"
        >
          ← Home
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Supervisor dashboard
        </h1>
        <p className="text-black/70 dark:text-white/70">
          Tickets opened by voice appear here in real time.
        </p>
      </header>

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-black/5 dark:bg-white/10">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-4 py-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-black/60 dark:text-white/60"
              >
                No open tickets yet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}
