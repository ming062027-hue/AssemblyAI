# Shop-Floor Voice Assistant (working title)

A voice assistant for noisy CNC machine shops, built for the lablab.ai × AssemblyAI Voice Agent Hackathon (September 2026).

Operators talk to it right next to a loud machine. They can ask what an alarm means, hear the first checks to try, and open a repair ticket once they have confirmed the details. Supervisors see new tickets on a live dashboard.

> **Status:** early skeleton (v0.1). The voice features are under construction.

## Demo data

All machines, alarm codes, maintenance records and tickets in this project are **fictional sample data** written for the demo. They are not copied from any manufacturer manual and do not describe any real machine, brand or company.

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router) with TypeScript
- [Tailwind CSS](https://tailwindcss.com) 4
- [AssemblyAI Voice Agent API](https://www.assemblyai.com/docs) over WebSocket from the browser, using short-lived tokens issued by our server

## Getting started

Requirements: Node.js 20.9 or later, and an AssemblyAI API key.

```bash
npm install
cp .env.example .env.local   # then put your AssemblyAI API key in .env.local
npm run dev
```

Open <http://localhost:3000>. Use Chrome or Edge for the voice features; the microphone only works on `localhost` or HTTPS.

## Project layout

Some of these folders are planned and appear as the build progresses.

| Path | What lives there |
| --- | --- |
| `src/app/page.tsx` | Home page |
| `src/app/dashboard/` | Supervisor dashboard |
| `src/app/operator/` | Operator voice page (in progress) |
| `src/app/api/voice-token/` | Server route that issues short-lived AssemblyAI tokens (in progress) |
| `src/voice/` | Voice agent client: audio, WebSocket session, prompts, tool schemas |
| `public/voice/` | Static audio worklet files used by the voice client |
| `src/tools/` | Tool handlers that read the demo data and create tickets |
| `src/data/` | Fictional demo data |
| `src/board/` | Dashboard components and ticket sync |
| `src/config/site.ts` | Site name and version |

## Security

- The AssemblyAI API key stays on the server in `.env.local`, which is never committed. The browser only receives a short-lived token.

## License

[MIT](LICENSE)
