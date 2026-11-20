# Tandem

**Program cobots, together.** Tandem is a browser-based simulator for programming collaborative robot arms, with an AI programming partner built in. It's also a research instrument: study mode records how people program, with and without AI help.

- **Two ways to program, one robot API.** Use Wizard-style blocks for beginners, or JavaScript in a full editor. Both compile to the same `robot.moveJ/moveL`, `gripper`, `io` and `offset` API.
- **Realistic teaching workflow.** Jog in joint or Cartesian space, hand-guide the tool with a 3D gizmo, and teach named targets.
- **Four arms:** a GoFa-class cobot, a UR-class cobot, a KUKA KR5 and an Epson T6 SCARA. The KR5 and T6 meshes come from [UAIbotJS](https://github.com/UAIbot/UAIbotJS) (MIT).
- **Three cells:** a conveyor assembly cell, a sorting and palletizing line, and a kitchen and lab bench (with pouring).
- **Protective stops.** Every move is checked before execution for unreachable targets, joint limits, singularities and collisions, and the offending line or block is highlighted.
- **AI partner.** A LangGraph.js ReAct agent runs in the browser. It reads your program, the simulator state and the last run, dry-runs candidate programs in a hidden copy of the cell, and proposes changes that you accept or reject.
- **Deterministic and safe.** Simulated time only advances while a command runs. User code runs in a Web Worker with no network access.

See **[SPEC.md](SPEC.md)** for the full design.

## Quick start

```bash
npm install
npm run mock-llm                                        # terminal 1: scripted AI partner (no API key needed)
echo 'VITE_LLM_PROXY_URL=http://localhost:8787' > .env.development.local
VITE_BASE=/ npm run dev                                 # terminal 2: http://localhost:5173
```

- **Demo mode:** open `/`.
- **Study mode without Firebase:** open `/?code=TEST-SUGGEST-1`. `TEST-QA-1` and `TEST-OFF-1` also work, and logs are kept in IndexedDB.

| Command | What it does |
|---|---|
| `npm test` | Unit tests: kinematics parity with UAIbot, IK round-trips, planner faults, every task's reference solution, determinism |
| `npx vitest run tests/unit/tasks.test.ts -t kitchen` | A single test |
| `npm run test:e2e` | Playwright end-to-end tests: production build plus the mock LLM |
| `npm run test:functions` | Cloud Functions and Firestore rules against the Firebase emulators (needs Java) |
| `npm run lint && npm run typecheck` | Static checks |
| `npm run build` | Static site in `dist/` (`VITE_BASE` sets the Pages sub-path) |

## Deploying

**Frontend: GitHub Pages**

1. Under **Settings → Pages**, set the source to **GitHub Actions**.
2. Add repository variables `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_LLM_PROXY_URL`, `VITE_FUNCTIONS_URL`, `VITE_DEMO_MODELS` and `ALLOWED_ORIGINS` (e.g. `https://<you>.github.io`).
3. Add repository secrets `FIREBASE_SERVICE_ACCOUNT` (JSON key) and `IP_SALT`.
4. Every push to `main` builds and deploys.

**Backend: Firebase** (Blaze plan, needed for Functions and Secret Manager)

1. Create a project. Enable **Anonymous** sign-in and **Firestore**.
2. Store your key server-side: `firebase functions:secrets:set OPENAI_API_KEY`. It never reaches the browser.
3. Optionally create the `config/llm` document to tune limits. The defaults are in `functions/src/config.ts`:
   - `enabled` (the kill switch)
   - `demoModels`
   - `limits.demo` and `limits.study` (requests and tokens per day)
   - `demoDailyTokenBudget`
   - `maxOutputTokens`
4. The deploy workflow deploys `functions` and `firestore.rules`. To deploy manually, run `firebase deploy --only functions,firestore:rules`.

**Running a study**

```bash
npx tsx scripts/gen-codes.ts --experiment pilot --per-condition 20 --project <id>     # prints a CSV of codes
npx tsx scripts/export-logs.ts --experiment pilot --project <id> --out exports/pilot
```

Participants open `https://<you>.github.io/<repo>/?code=XXXX-XXXX`. Experiments live in `content/experiments/*.json` and define the conditions (AI off / Q&A / suggest, a locked model), the task order with Latin-square counterbalancing, and the post-survey redirect.

## Credits

The KUKA KR5 and Epson T6 models and kinematics come from UAIbotJS © 2023 UAIbot, MIT License (`public/models/uaibot/LICENSE.md`). The cobot arms are original, generic models; they aren't affiliated with or endorsed by any robot manufacturer.
