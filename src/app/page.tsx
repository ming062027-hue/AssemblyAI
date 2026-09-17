import Link from "next/link";
import { SITE_DESCRIPTION, SITE_NAME } from "@/config/site";

const entryPoints = [
  {
    href: "/operator",
    title: "Operator",
    body: "Talk to the assistant next to the machine: ask what an alarm means, then report a problem.",
    status: "In progress",
  },
  {
    href: "/dashboard",
    title: "Supervisor dashboard",
    body: "Repair tickets opened by voice show up here as soon as the operator confirms them.",
    status: "Skeleton",
  },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-wide text-black/60 dark:text-white/60">
          AssemblyAI Voice Agent Hackathon
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">{SITE_NAME}</h1>
        <p className="text-lg leading-8 text-black/70 dark:text-white/70">
          {SITE_DESCRIPTION}
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {entryPoints.map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className="flex h-full flex-col gap-2 rounded-xl border border-black/10 p-5 transition-colors hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-lg font-semibold">{entry.title}</span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-black/60 dark:bg-white/10 dark:text-white/60">
                  {entry.status}
                </span>
              </span>
              <span className="text-sm leading-6 text-black/70 dark:text-white/70">
                {entry.body}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="rounded-xl bg-black/5 p-4 text-sm leading-6 text-black/70 dark:bg-white/10 dark:text-white/70">
        All machines, alarm codes, maintenance records and tickets in this demo
        are fictional sample data written for this project. They are not taken
        from any manufacturer manual and do not describe any real machine,
        brand or company.
      </p>
    </main>
  );
}
