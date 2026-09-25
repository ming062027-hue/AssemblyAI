// Pitch deck content for the /pitch page (spec 4.8).
//
// Originally copied from 企劃/簡報文字_v0.1_2026-09-19.md. Since 2026-09-24 this
// file is the source of truth for the deck wording (updated by the 總管 line on
// 大銘's decisions: USD 19/machine/month pricing; 25 years in machinery, 14 of
// them in machine tools; single-console product). The v0.1 text file is outdated.
// All machines, alarm codes and numbers here are fictional sample data
// written for this demo, except figures explicitly marked with a source.
// Unsourced figures must be labelled as assumptions.

export type PitchSlide = {
  title: string;
  bullets: string[];
};

export const PITCH_SLIDES: PitchSlide[] = [
  {
    title: "VoiceAndon: Hands-Free Help for CNC Operators",
    bullets: [
      "A voice agent for noisy machine floors, built on the AssemblyAI Voice Agent API.",
      "Operators speak. Supervisors see tickets live.",
    ],
  },
  {
    title: "The problem: downtime is expensive, technicians are scarce",
    bullets: [
      'A Siemens-backed survey of large industrial firms estimates unplanned downtime costs the Global 500 nearly USD 1.4 trillion a year, about 11% of revenue. [Source: market-numbers file S2, Siemens "The True Cost of Downtime 2024", p.2; verified 2026-09-17 from original PDF. Note: respondents are large firms; SME downtime cost is pending data.]',
      "One hour of stoppage costs from USD 36,000 (consumer goods) to USD 2.3 million (automotive). [Source: S2, p.2; verified 2026-09-17.]",
      "In the US, manufacturers may need up to 3.8 million new workers by 2033, with up to 1.9 million jobs going unfilled; 65% call hiring and retention their top challenge. [Source: S3, The Manufacturing Institute 2024-04-03 press release; verified 2026-09-17 from original page.]",
      "In Taiwan, manufacturers reported 92,000 open positions at end-March 2025, the most of any sector; operator and assembler roles averaged 4.1 months to fill. [Source: S7, CNA 2025-09-08 citing Ministry of Labor survey; verified 2026-09-17 from original page.]",
    ],
  },
  {
    title: "The user is the operator, not the technician",
    bullets: [
      "The operator stands next to a loud machine with oily hands and gloves on, and is not a repair expert.",
      "When an alarm sounds, the operator waits for a technician, and the machine keeps burning money.",
      "Who pays: the plant manager and the maintenance supervisor.",
      "VoiceAndon serves the hands that cannot type, and reports to the eyes that manage the floor.",
    ],
  },
  {
    title: "The fix: rescue first, ticket second",
    bullets: [
      "Speak the alarm code: the assistant reads back likely causes and the first three checks from a lookup table.",
      "Fix simple problems on the spot, without waiting.",
      'If the problem survives: the assistant asks symptoms, severity, and whether the machine can keep running, reads the ticket back, and files it only after the operator says yes.',
      "Every confirmed ticket lands on the live work-order board in real time.",
    ],
  },
  {
    title: "Live demo & Noise Resistance",
    bullets: [
      'Live demo: one CNC-640 console with a single "AssemblyAI Connect" button, connected in real time to the AssemblyAI Voice Agent API.',
      "Built for noisy floors: AssemblyAI Voice Focus noise suppression is switched on for the operator microphone.",
      '"Machine three has an alarm" -> alarm 414 lookup -> troubleshooting checks -> confirmed ticket RT-1001 -> instant work-order board update.',
      '"Ticket RT-1001 is resolved" completes the lifecycle loop, clearing alarms and returning machines to normal status.',
      'Anti-hallucination guarantee: asking about alarm 9999 responds with "cannot find code", never a fabricated answer.',
    ],
  },
  {
    title: "How it works",
    bullets: [
      "The console requests a short-lived token; the token route checks the demo passcode and keeps the API key on the server.",
      "Voice streams to the AssemblyAI voice agent over WebSocket; tools run as functions in the browser.",
      "Tools read simulated machines, alarms, and maintenance records, switch console views, and file or resolve tickets.",
      "One console shows the whole story: the voice panel, machine telemetry, and the live work-order board.",
    ],
  },
  {
    title: "Trustworthy by design",
    bullets: [
      'Never invents: unknown codes get "I cannot find it", never a made-up cause.',
      'Acts only on explicit confirmation: no ticket without "yes".',
      "Never controls the machine: voice reads and files, hands stay on the real controls.",
      "Guarded demo: passcode gate plus a 5-minute cap per call.",
    ],
  },
  {
    title: "Business model & Financial ROI",
    bullets: [
      "Who pays: Plant managers and maintenance supervisors whose KPIs depend on uptime.",
      "Pricing: SaaS subscription at USD 19 per machine per month.",
      "Payback (assumption): if a small shop loses about USD 300 per hour of downtime, saving just 10 minutes a month (about USD 50) already covers the USD 19 fee about 2.6 times. Large plants lose far more: USD 36,000+ per hour [Source: S2].",
      "Market size (assumption, not yet sourced): about 3.0M CNC machines worldwide, 15% ready to retrofit (450,000 machines) -> 450,000 × USD 19 × 12 = about USD 102.6 million per year.",
      "Context: Taiwan machine-tool output was NTD 89.89B in 2025 [Source: S4, ITRI IEK] with exports of USD 2.004B [Source: S1]; Taiwan fields 302 industrial robots per 10k manufacturing workers [Source: S5, IFR 2026].",
    ],
  },
  {
    title: "Roadmap: a safe path to machine actions",
    bullets: [
      "Step 1 (today): read machine data, advise, and file tickets only after the operator says yes.",
      "Step 2: low-risk actions (order material, schedule maintenance, notify a technician), each confirmed by a person.",
      "Step 3: safe commands through the PLC, such as feed hold, with spoken confirmation and hardware safety interlocks; the emergency stop always stays in human hands.",
      "Step 4: automatic handling of well-defined cases, fully logged and auditable.",
      "Also planned: Chinese voice replies, and the same work-order board on the supervisor's phone and desktop.",
    ],
  },
  {
    title: "Team",
    bullets: [
      "Built by a machinery veteran: 25 years in the industry, 14 of them in machine tools, together with AI-assisted development.",
      "We know the noise, the gloves, and the wait — VoiceAndon is the helper we wished we had.",
      "Thank you. Questions welcome.",
    ],
  },
];

/** Clamp a ?p= value to a valid 1-based page number (pure, unit-testable). */
export function clampPitchPage(value: unknown, total: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(total, Math.max(1, Math.floor(n)));
}
