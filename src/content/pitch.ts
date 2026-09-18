// Pitch deck content for the /pitch page (spec 4.8).
//
// Text below is copied verbatim from 企劃/簡報文字_v0.1_2026-09-19.md
// (planning line owns the wording — dashboard line only reshapes it into
// title + bullets here; do not edit wording in this file, fix it there).
// All machines, alarm codes and numbers here are fictional sample data
// written for this demo, except figures explicitly marked with a source.

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
      "Every confirmed ticket lands on the supervisor dashboard in real time.",
    ],
  },
  {
    title: "Live demo [TBD: URL pending deployment]",
    bullets: [
      "Demo URL: [TBD — pending deployment]. Passcode: see submission notes.",
      '"Machine three has an alarm" finds M03 with alarm 414; "What does alarm four one four mean" brings likely causes and three first checks.',
      '"I checked. Still noisy. Open a repair ticket." triggers questions, a history check, and a read-back; "Yes, confirm." files it, and the board shows the new ticket in seconds.',
      "Bonus: ask about alarm 9999 — the assistant says it cannot find it instead of inventing an answer.",
    ],
  },
  {
    title: "How it works",
    bullets: [
      "The operator page requests a short-lived token; the token route checks the passcode and origin.",
      "Voice streams to the AssemblyAI voice agent over WebSocket; tools run as functions in the browser.",
      "Tools read simulated machines, alarms, and maintenance records; tickets sync to the board via localStorage plus BroadcastChannel.",
      "One browser tab shows the whole story: transcript on the left, live board on the right.",
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
    title: "Business model [TBD: pricing pending]",
    bullets: [
      "Who pays: plant managers and maintenance supervisors who own uptime.",
      "How we charge: per-machine monthly subscription. Price: [TBD — pending decision].",
      "Market size formula: TAM = (number of CNC machines) × (monthly fee) × 12. Machine count: pending data (no public installed-base total found; see market-numbers file). Result: [TBD].",
      "Context, not TAM: Taiwan machine-tool output was NTD 89.89 billion in 2025 [Source: S4, ITRI IEK summary; verified 2026-09-17], with exports of USD 2.004 billion [Source: S1; verified 2026-09-17]; Taiwan fields 302 industrial robots per 10,000 manufacturing employees, a global top-ten density [Source: S5, IFR 2026-04-08; verified 2026-09-17].",
    ],
  },
  {
    title: "Future work",
    bullets: [
      "Extend single machines to the full line: material checks and voice reordering across five stations (A-1 flow; code not in this release).",
      "Chinese voice replies when the platform supports them.",
      "Connect real machine data and cross-device sync.",
      "Keep the same promise: rescue first, confirm before filing, never invent.",
    ],
  },
  {
    title: "Team",
    bullets: [
      "Built by a tooling-industry veteran with 25 years on the machine floor, together with AI-assisted development.",
      "We know the noise, the gloves, and the wait — VoiceAndon is the helper we wished we had.",
      "Thank you. Questions welcome.",
    ],
  },
];

/** Clamp a ?p= value to a valid 1-based page number (pure, unit-testable). */
export function clampPitchPage(value: unknown, total: number): number {
  const n = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(total, Math.max(1, Math.floor(n)));
}
