# Tandem — Specification v1

> Product name: **Tandem** (“Program cobots, together”). Repository: riseatlsu/Tandem.

A browser-based simulator for programming an articulated collaborative robot arm in several scenarios (factory, palletizing/sorting, kitchen/lab). Users program it in a Wizard-style block editor or a JavaScript/TypeScript editor, helped by an AI partner that runs in the browser (LangGraph.js). The app also serves as a research instrument: in **study mode** it logs how participants program, with and without AI help.


## 0. Implementation notes (v1 build)

These decisions were made while building v1. They take precedence over the sections below where they differ.

- **UAIbotJS (R1/R3 resolved).** UAIbotJS is MIT-licensed. Its JS module imports three@0.126 by URL and hard-codes a `#scene` canvas, so it is **not** imported at runtime. Instead:
  - We render with our own Three.js and vendor UAIbot's OBJ meshes to `public/models/uaibot/`, with its LICENSE.
  - `scripts/convert-uaibot.ts` reproduces UAIbot's Object3D link semantics (its `config()` overwrites Euler-z / position-z) as our link-chain format: local = pre · J(q) · post. This keeps the meshes aligned.
  - FK parity is tested against a three.js re-implementation of UAIbot's `Robot` (`tests/unit/kinematics.test.ts`).
  - The KR5 gets a −90° mount yaw so it faces +X. The T6 gets a 4th tool-roll joint, since UAIbot's model has 3.
- **Arm JSON** (`content/arms/*.json`) holds either `dh` rows or an explicit `links` chain. Joint limits are in degrees (mm for prismatic joints). The cobots are original procedural models named “Aria 5 (GoFa-class)” and “Nimbus 5 (UR-class)”.
- **Docs index** is generated to `src/agent/docs-index.json` and bundled, rather than served as `public/docs-index.json`.
- **Agent dry runs** start from the **task's initial state** by default (`from: "initial"`). `from: "current"` clones the live scene.
- **Block patches** use a compact JSON **steps** format (`src/blocks/steps.ts`, documented in the system prompt). It is validated, dry-run, and shown as a read-only block preview in a modal with Accept/Reject, rather than ghost blocks overlaid on the workspace. The agent reads block programs in the same format.
- **Pouring.** Flow ramps from 0 at 90° tilt to full rate (0.5 × capacity/s) at 120°.
- **Backend.** Both functions are HTTPS `onRequest` handlers (`llmProxy`, `redeemCode`), authenticated with `X-Firebase-Token`. Other details:
  - Session id is `s_<CODE>`, so resuming works across devices.
  - `codes/{code}` stores `model` and `agentMode` (written by `scripts/gen-codes.ts`) so the proxy can lock the model without reading the frontend's experiment JSON.
  - Codes are generated from Tandem Studio (Experiments > Participant codes) or `scripts/gen-codes.ts`, both via `scripts/lib/codes.ts`. The service-account key sits in gitignored `keys/` and is read only by the dev server/CLI. The CSV includes each participant's link; new batches continue each condition's `orderIndex`.
  - Log events are stored with `data` as a JSON string, because Firestore forbids nested arrays.
  - `GET …/llmProxy/config` returns the demo model list.
- **Local study mode.** Without Firebase configured, codes `TEST-SUGGEST-n`, `TEST-QA-n` and `TEST-OFF-n` start a study session that logs to IndexedDB. The E2E suite verifies the logging pipeline through this local sink. The Firestore path (rules, auth, quotas, model lock) is covered by the emulator tests in `functions/test/`.
- **UI layout (two views).** The screen is split like a real cell: the 3D cell on the left and a **teach pendant** on the right (`src/pendant/`). Only one pendant screen shows at a time:
  - **Home** shows the current task card and app tiles for Program, Jog, Positions, I/O, Log and Settings. A dock gives one-tap access to Home, Program, Jog and Positions. Task, I/O, Log and Settings are opened from Home.
  - **Hardware keys** sit under the screen: Run/Resume, Pause, Step and a red STOP button. Shortcuts are ⌘/Ctrl+Enter to run and Esc to stop.
  - **The cell view** holds the cell-level controls: goal chip (opens the Task screen), sim speed, Reset scene, camera buttons, the fault card (with “Show in program”) and the success card.
  - **The Program screen** stays mounted (hidden with `visibility`) so Blockly keeps its state and generated JS while other screens are open.
  - **Jog** works like a 3-axis joystick pendant:
    - Motion modes are Axes 1–3, Axes 4–6, Linear and Reorient, with a Base/Tool frame for the last two.
    - The stick drives the first two axes and a rocker drives the third, at speed proportional to deflection (40°/s, 150 mm/s or 100 mm/s for prismatic joints at full deflection).
    - Arrow buttons step by 0.1, 1 or 10 per tap and repeat while held.
    - A stick drag logs **one** `jog` event (`input: "joystick"`, per-axis totals, duration) when released. Arrow steps log per step as before.
  - **AI partner** is reached from a button in the pendant's status bar. When open it is a floating window that can be dragged anywhere (position kept in `localStorage`). The minimize button collapses it back into the status bar. Opening and collapsing log `panel_toggle {agent}`, and screen changes log `panel_toggle {pendant}`. “Ask AI partner about this” opens it. In the `off` condition neither the button nor the window is rendered.
  - Arm choice and Blocks/Code switching (demo only) moved to the Settings screen.
- **Top bar task tracker.** The task dropdown is replaced by level-tracker bubbles. The current task is light blue, finished tasks are green with a check, and the rest are plain glossy bubbles. In demo mode the bubbles are buttons that jump to a task. In study mode they show the participant's sequence and are not clickable.
- **Resizable split.** A drag bar between the cell view and the pendant sets `--pendant-w`, clamped so the pendant stays ≥ 400 px and the cell ≥ 360 px. ←/→ keys also work, with Shift for bigger steps. Double-click resets. The width is kept in `localStorage`, and changes log `panel_toggle {split}`.
- **Sound** (`src/audio/sound.ts`) is fully synthesized with WebAudio, so no audio assets are needed. The AudioContext is created on the first gesture.
  - **UI:** glassy taps on buttons and pops on navigation.
  - **Robot:** a servo hum whose pitch and level follow the fastest joint's speed, a conveyor rumble while the belt runs, gripper whirs, and grasp and release clunks.
  - **Events:** run start/pause/stop, the teach chime, the success arpeggio, the protective-stop alarm, and AI reply and proposal chimes.
  - Toggles are in the top bar and in Settings (including volume), stored per viewer. Sound effects are available in both modes.
- **Music (demo only)** (`src/audio/music.ts`): a generative ambient piece (maj9 pads, sub bass, pentatonic bells through a ping-pong delay, shaker) synthesized live, on repeat. If a royalty-free file is added at `public/music/theme.mp3` (or `.ogg`), it loops instead. Music never plays in study mode.
- **Conveyor prefill.** The first part on a conveyor starts **at the sensor** (end of the belt, under the `pick` target) instead of at the far start, so the cell reads correctly before Run. Opt out with `"prefill": false` in the spawn config. Task 1 now has one waiting part, to teach above.
- **Resilience.** The cell view, pendant, code/block editors and AI partner are each wrapped in an `ErrorBoundary`, so a failed lazy chunk can't blank the app. Vite pre-bundles monaco/blockly/three (`optimizeDeps.include`) to avoid dev-server “Outdated Optimize Dep” 504s.
- **Program execution.** Each run gets its own module Worker with network/storage globals removed. The runaway guard is 3 s of wall-clock time with no robot command.
- **Routing and landing page.** The site root shows a landing page (`src/landing/`, lazy-loaded, about 21 KB plus the shared 3D engine):
  - live hero cell replaying reference solutions in real time (`runHeadless` with an `onStep` pacing hook);
  - feature showcase with recorded clips, a level gallery that opens `?demo=<taskId>`, and a rotating robot lineup;
  - a music toggle that is **off by default**.
  `?demo[=taskId]` opens the app and `&tour` starts the tour. `?code=` / `?study` go straight to the study gate and never show the landing page. There is no code box on the landing page; participants use their link. The demo top-bar logo links back home.
- **AI-partner features are per-condition flags** (`conditions.<c>.agent.features: { visuals, plans, preview }`, anything omitted is off; all on in the demo). They are recorded in `StudyInfo.features` and gate both the tools and the prompt section (`sys-v4`).
  - `visuals`: `show_blocks` draws a read-only Blockly picture of JSON steps in the chat (untaught targets allowed). `show_example` plays a curated GIF from `src/agent/clips.ts`.
  - `plans`: `make_plan` pins a 3–7 step checklist. Steps carry optional checks (`target`, `uses`, `screen`, `holding`, `run`, `goal`) that tick themselves from live state every 300 ms; the user ticks the others. Ticks are sticky and plans are checkpointed.
  - `preview` (suggest only): `preview_proposal` and a "Show me" button on proposal cards. They dry-run the proposal from the robot's current pose with motion recording (`recordEvery`) and replay it on a translucent ghost arm in the cell view; the real robot never moves.
  - New log events: `agent_visual`, `agent_plan`, `plan_step_done {by: auto|user}`, `preview_play {source: agent|user}`. The pilot (experiment version 2) declares all three features **off** for every condition, so its conditions match v1 apart from the prompt version.
- **Your own 3D models** (`MeshRef` in `src/sim/types.ts`, loader in `src/view/meshes.ts`):
  - **Files and formats:** files live under `public/models/`; formats are `.glb`/`.gltf` (with materials), `.obj`, `.stl` and `.dae`.
  - **Per-file settings:** `units` (default m for glb/gltf/dae, mm for obj/stl), `upAxis` (default y, except z for stl), `scale`, `rotation`, `offset` and `color`.
  - **Models are visual only.** Collision, grasping and predicates still use the owner's box, cylinder or capsule, so the simulation stays deterministic and identical for every participant. A file that fails to load shows a red wireframe box instead of breaking the scene.
  - **Fixtures:** `kind: "model"`, or any non-conveyor fixture with `mesh`, draws the model centered in the fixture's box (the collision box). `visualOnly` makes it scenery.
  - **Parts:** `objects[].mesh` and `conveyors[].spawn.mesh` draw a model with its bottom on the part's position. OBJ/STL parts are tinted with the part's color, so color goals and sensors still read naturally.
  - **Arms:** `visual: { source: "mesh", parts?, model? }`.
    - `parts` is one file per link (by link index or name), placed in the link frame. `frame: "zero"` means the part was modelled in place at all-zero joints.
    - `model` is one file whose named nodes map to links. It is modelled in place at zero by default; unmapped nodes ride on the base.
  - **URDF import** (`src/content/urdf.ts`, pure, unit-tested) follows one serial chain from the root to a chosen tip link.
    - Each movable joint becomes `pre = T(origin)·A`, `post = A⁻¹`, where `A` turns +Z onto the URDF axis. Tandem link frames therefore equal URDF link frames, and visual origins and meshes carry over (`package://` and relative paths are resolved next to the URDF).
    - Limits and velocities come from the URDF. Primitive visuals are skipped with a warning.
  - **Examples** (generated by `scripts/make-example-models.ts`): `public/models/examples/`, with the `tandem-mini-6` arm imported from its URDF, the `example-custom-cell` scene and the study-only `example-custom-models` task.
- **Tandem Studio** (`?editor`, `src/studio/`) is a researcher-only content editor that exists **only on the dev server**. The `scripts/vite/studio-plugin.ts` middleware writes whitelisted files only: `content/{arms,scenes,tasks,experiments}/*.json` and `tests/fixtures/solutions/*.js`. Requests need an `X-Tandem-Studio` header, and production builds drop the editor entirely.
  - **Environments:** an outline plus a live 3D preview with click-to-select and a move gizmo. You can add boxes/tables, bins, racks, 3D models (with "fit collision size to model"), box/cylinder parts, zones, conveyors (with their belt, signals and pick positions), signals, sensors and named positions. Positions get a reachability check with the chosen arm; "Use the current view" sets the camera. Saving runs the zod schema, cross-reference checks (`src/studio/validate.ts`; ids unique per category) and a SimCore build.
  - **Tasks:**
    - **Basics:** brief, environment, arm, editor, pass mode, starter, hints, time limit, seed and per-conveyor overrides.
    - **Goals:** a builder for every predicate type, with dropdowns filled from the scene. Goals that are already met at the start are flagged.
    - **Demo listing:** a demo on/off switch with an order, plus a difficulty.
    - **Reference solution:** must pass **Test** (every goal, run to completion) before saving. **Watch** replays it in the preview. Only "passed live" tasks may skip it.
  - **Experiments:** conditions with AI mode, locked model, feature flags and tour; ordered task sequences; Latin-square prefix; survey URL; telemetry. Saving is refused if conditions have different task counts.
  - **Robots & models:** browse and preview model files with their measured size, import a URDF, and edit an arm's look with per-link parts or GLB node mapping, joint sliders, "set home to this pose", collision radii and the full JSON.
  - **After a save**, Vite reloads the page. `main.tsx` reloads instead of booting twice when HMR re-runs it, and Studio reopens the saved item.
- **Demo level list comes from the tasks.** `demo: { order }` (and an optional `difficulty`) on a task lists it in the demo bubbles and the landing gallery (`DEMO_TASKS`). Tasks without it are study-only, and experiments reference them by id.
- **No emojis in the interface.** Blocks use small white SVG line icons (`ICONS` in `blocks/definitions.ts`), and console lines are plain text. Only the AI partner's own replies may contain emoji.
- **Curated clip library.** Ten 720×450 GIFs in `public/clips/` and eight level thumbnails in `public/landing/levels/`. They are recorded from the real app by `scripts/record-clips.ts` (Playwright, DevTools screencast, dependency-free PNG decode and GIF encode in `scripts/lib/gif.ts`), so every participant sees identical visuals. Re-record after UI changes.
- **Guided tour** (`src/tour/`): a spotlight, a floating arrow and a glass card with optional GIFs, pointing at `data-tour="…"` anchors. Some steps wait for an action (open Jog, open Program) and move on by themselves.
  - **Demo:** optional, closable, and replayable from Settings.
  - **Study:** required before the first task (no skip; condition opt-out `tour: false`). The task timer is paused while it runs. The AI step appears only when the agent is not `off`, and describes that condition's mode and features.
  - **When the study tour ends:** the first task's workspace, chat and plan are cleared and the task reloads, so `task_start` is logged again and the timer restarts.
  - **Logging and resume:** `tour_start`, `tour_step` and `tour_end` are logged. `tourDone` is checkpointed, so a resume never repeats the tour.

---

## 1. Goals and non-goals

**Goals**
- Realistic *programming workflow* for a cobot: jogging, hand guiding (lead-through), teaching named targets, joint and linear moves, gripper and I/O, loops and offsets.
- Two programming surfaces that compile to one robot API: Wizard-style blocks (beginner) and JS/TS (advanced).
- An AI partner that answers questions, reads the program, sim state and run traces, dry-runs candidate programs, and **proposes** patches the user accepts or rejects.
- Deterministic, reproducible runs (same program + same seed → same trajectory and outcome).
- Two modes: **demo** (open, rate-limited) and **study** (access code, experiment-controlled, fully logged).

**Non-goals (v1)**: see §17 Out of scope.

---

## 2. System overview

```
┌──────────────────────── GitHub Pages (static) ────────────────────────┐
│  React UI ── Zustand store                                           │
│   ├─ Viewport (UAIbotJS adapter → renders SimCore state)             │
│   ├─ Blocks (Blockly)  ──compile──┐                                  │
│   ├─ Code (Monaco)  ──────────────┤→ program source (JS)             │
│   ├─ Jog / Hand-guide / Targets   │                                  │
│   ├─ Task checklist               ▼                                  │
│   ├─ AI partner (LangGraph.js)  ProgramRunner ──postMessage RPC──┐   │
│   │      │                        (main thread)                  │   │
│   │      │ tools                     │ validates + plans         │   │
│   │      ▼                           ▼                           ▼   │
│   │   DryRunWorker            SimCore (pure TS,          ProgramWorker│
│   │   (SimCore clone +        deterministic,             (user code, │
│   │    program, headless)     fixed-step)                 no DOM/net)│
│   └─ Logger → IndexedDB queue → Firestore                            │
└────────────┬──────────────────────────────────────────────────────────┘
             │ HTTPS + Firebase ID token (CORS allowlist)
┌────────────▼──────────── Firebase ───────────────────────────────────┐
│  Cloud Functions (v2): llmProxy (SSE passthrough → OpenAI),          │
│                        redeemCode, (quota + allowlist enforcement)   │
│  Firestore: codes, participants, usage, config, sessions/events      │
│  Auth: Anonymous                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Key architectural rule:** `SimCore` is pure, headless, deterministic TypeScript. It has no DOM, no Three.js and no UAIbot. UAIbotJS is used **only as a view/asset adapter** for rendering and built-in robot meshes. This lets the same SimCore run in the main thread (live) and in a Worker (agent dry runs, tests), and isolates us from UAIbotJS gaps (no IK, collision checks or types, and no documented license).

---

## 3. Tech stack

| Concern | Choice |
|---|---|
| Build | Vite + TypeScript (strict), `base: '/Tandem/'` for GitHub Pages |
| UI | React 18, Zustand |
| 3D | UAIbotJS (vendored, pinned; see §18 R1) on Three.js; Three.js `TransformControls` for the hand-guide gizmo |
| Math | Own small linear-algebra module (`src/sim/math/`): Vec3, Mat4, Quat, DH. math.js only inside the UAIbot adapter |
| Code editor | Monaco, with `robot-api.d.ts` injected for autocomplete and type checking |
| Blocks | Blockly, with custom blocks and a JS generator |
| Agent | `@langchain/langgraph` + `@langchain/openai` (`ChatOpenAI` pointed at our proxy) |
| Backend | Firebase: Anonymous Auth, Cloud Functions v2 (Node 20), Firestore |
| Tests | Vitest (unit), Playwright (E2E), Firebase Emulator Suite (functions + rules) |
| Browsers | Desktop Chrome, Edge, Firefox; min 1280×720; English; strings in `src/i18n/en.json` |

---

## 4. Repository layout

```
Tandem/
├─ SPEC.md
├─ index.html
├─ vite.config.ts
├─ package.json
├─ public/
│  └─ vendor/uaibot/            # pinned UAIbotJS copy + LICENSE (after R1 is resolved)
├─ content/                      # all data-driven content (validated by zod at load)
│  ├─ arms/        gofa-like.json, ur-like.json, kuka-kr5.json, epson-t6.json
│  ├─ scenes/      factory-pick.json, palletize-sort.json, kitchen-lab.json
│  ├─ tasks/       *.json        # tasks reference a scene + arm + predicates
│  ├─ experiments/ *.json        # study configurations
│  └─ docs/        api-reference.md, blocks-reference.md  (→ built into docs-index.json)
├─ src/
│  ├─ main.tsx, App.tsx, config.ts
│  ├─ sim/                       # PURE: no DOM imports allowed (lint-enforced)
│  │  ├─ math/                   # vec3.ts, quat.ts, mat4.ts, dh.ts
│  │  ├─ kinematics/             # fk.ts, ik.ts (DLS numeric), jacobian.ts
│  │  ├─ planner/                # moveJ.ts, moveL.ts, profile.ts (trapezoidal)
│  │  ├─ collision/              # shapes.ts (capsule, OBB), check.ts
│  │  ├─ world/                  # objects.ts, grasp.ts, conveyor.ts, io.ts, pour.ts
│  │  ├─ predicates/             # registry.ts, evaluators.ts
│  │  ├─ rng.ts                  # mulberry32 seeded PRNG
│  │  ├─ SimCore.ts              # fixed-step world + command executor
│  │  └─ types.ts
│  ├─ runtime/
│  │  ├─ ProgramRunner.ts        # main-thread side of RPC, run/pause/step/stop
│  │  ├─ program.worker.ts       # executes user code, robot API stubs → RPC
│  │  ├─ dryrun.worker.ts        # SimCore + program in one worker, headless
│  │  ├─ robotApi.ts             # API implementation shared by both workers
│  │  ├─ protocol.ts             # RPC message types
│  │  └─ robot-api.d.ts          # public typings (Monaco + docs source of truth)
│  ├─ view/
│  │  ├─ UAIbotAdapter.ts        # SimCore state → UAIbot scene objects
│  │  ├─ Viewport.tsx
│  │  └─ HandGuide.ts            # TransformControls + live IK
│  ├─ blocks/
│  │  ├─ definitions.ts          # block JSON defs
│  │  ├─ generator.ts            # Blockly → JS
│  │  ├─ toolbox.ts
│  │  └─ patch.ts                # validate + apply agent block patches (ghost preview)
│  ├─ editor/                    # Monaco setup, diff view for agent patches
│  ├─ panels/                    # JogPanel, TargetsPanel, TaskPanel, RunBar, ChatPanel, ...
│  ├─ agent/
│  │  ├─ graph.ts                # LangGraph ReAct graph
│  │  ├─ tools.ts                # tool definitions (zod schemas)
│  │  ├─ jsonProtocol.ts         # fallback for models without tool calling
│  │  ├─ llm.ts                  # ChatOpenAI configured for proxy + auth fetch
│  │  └─ prompts/system.v1.ts    # versioned system prompt (version string logged)
│  ├─ study/
│  │  ├─ session.ts              # mode, code redemption, task sequencing, resume
│  │  ├─ logger.ts               # event bus → IndexedDB queue → Firestore batches
│  │  └─ events.ts               # typed event catalog
│  ├─ firebase.ts
│  ├─ store/                     # Zustand slices
│  └─ i18n/en.json
├─ functions/
│  ├─ src/index.ts               # exports llmProxy, redeemCode
│  ├─ src/quota.ts, src/allowlist.ts, src/cors.ts
│  └─ package.json
├─ firestore.rules
├─ firebase.json
├─ scripts/
│  ├─ build-docs-index.ts        # content/docs → public/docs-index.json
│  ├─ gen-codes.ts               # create participant codes for an experiment
│  └─ export-logs.ts             # Firestore → JSONL/CSV (admin SDK)
├─ tests/
│  ├─ unit/                      # vitest
│  ├─ e2e/                       # playwright
│  ├─ fixtures/mock-llm/         # scripted SSE responses
│  └─ functions/                 # emulator tests
└─ .github/workflows/
   ├─ ci.yml                     # lint, typecheck, unit, e2e (mock LLM), emulator tests
   └─ deploy.yml                 # Pages deploy on main; functions + rules deploy
```

---

## 5. Robot models

All arms are defined in `content/arms/*.json` and loaded into SimCore with **our own** DH-based FK. UAIbot supplies meshes for the KR5 and T6. The two cobots use simple, original procedural geometry (capsule links, rounded joint housings) with neutral naming and colors, and no vendor branding.

| id | Type | DOF | Source | Notes |
|---|---|---|---|---|
| `gofa-like` | 6-axis cobot | 6 | custom DH | GoFa CRB 15000-class reach (~950 mm) and payload (5 kg). DH values come from public datasheets (§18 R2). **Primary study arm.** |
| `ur-like` | 6-axis cobot | 6 | custom DH | UR5e-class geometry (~850 mm). Second cobot for transfer conditions. |
| `kuka-kr5` | 6-axis industrial | 6 | UAIbot `create_kuka_kr5()` | DH extracted from UAIbot. Unit test asserts FK parity with UAIbot `fkm`. |
| `epson-t6` | SCARA | 4 | UAIbot `create_epson_t6()` | Orientation restricted to rotation about Z. moveL and hand-guide lock rx/ry. |

```ts
// src/sim/types.ts
interface ArmDef {
  id: string; name: string;
  kind: 'articulated6' | 'scara4';
  dh: { theta: number; d: number; a: number; alpha: number; type: 'R' | 'P' }[]; // m, rad
  jointLimits: { min: number; max: number; maxVel: number }[];                  // rad, rad/s
  tool: { tcp: Pose };                    // flange → TCP
  collision: Capsule[];                   // per-link, in link frames
  home: number[];                         // joint config, rad
  maxTcpSpeed: number;                    // m/s
  visual: { source: 'uaibot'; factory: 'create_kuka_kr5' | 'create_epson_t6' }
        | { source: 'procedural'; color: string };
  gripper: { type: 'parallel'; stroke: number; graspTolerance: number; alignTolDeg: number };
}
```

**Units:** SimCore uses meters and radians. **The user-facing API and UI use millimeters and degrees.** The world frame is Z-up, with the robot base at the origin unless the scene overrides it.

---

## 6. Simulation core

### 6.1 Clock and determinism
- Fixed step `dt = 1 ms` of sim time. The viewport advances `speedFactor × frameDelta` of sim time per animation frame (in 1 ms substeps, capped at 50 ms per frame). `speedFactor ∈ {0.25, 0.5, 1, 2, 5, 10}`.
- **Sim time advances only while a command is executing (a move, wait or waitInput).** While the worker computes between commands, sim time is frozen. This makes outcomes independent of CPU speed and worker scheduling. Conveyors and spawn schedules run on sim time.
- All randomness (spawn jitter, color sequences) comes from `rng.ts`, seeded from `task.seed` (study) or a displayed, editable seed (demo). Using `Math.random` inside `src/sim/` is a lint error.
- **Runaway guard:** if the worker issues no RPC for 3 s of wall-clock time while a run is active, the runner terminates it with fault `RUNAWAY` ("program is busy without commanding the robot — infinite loop?"). Sim-time cap per run: `task.maxSimTimeSec` (default 600).

### 6.2 Motion
- **moveJ:** joint-space interpolation with a synchronized trapezoidal profile limited by `jointLimits.maxVel × speed%`.
- **moveL:** straight-line TCP path with SLERP orientation, trapezoidal in arc length, limited by `maxTcpSpeed × speed%`. IK is solved every 2 mm / 1°, seeded by the previous solution.
- **IK:** damped least squares (λ adaptive), max 100 iterations, tolerance 0.1 mm / 0.05°, seeded from the current configuration (or `home` plus up to 8 deterministic restarts for moveJ-to-pose). SCARA uses closed-form IK.
- **Pre-check before any motion** (the robot does not move if any check fails):

| Fault code | Condition |
|---|---|
| `UNREACHABLE` | IK fails for the target (or any moveL sample) |
| `JOINT_LIMIT` | solution or path exceeds a joint limit |
| `SINGULARITY` | moveL: σ_min(J) < threshold, or a joint jump > 10° between consecutive samples (wrist flip) |
| `COLLISION` | link capsules or the carried object intersect scene fixtures (penetration > 2 mm; resting contact on a support surface is allowed within 3 mm) |
| `INVALID_ARG` | unknown target, NaN, out-of-range speed |
| `TIMEOUT` | `waitInput` exceeded its timeout |
| `RUNAWAY` | see §6.1 |
| `USER_ERROR` | an exception thrown by user code |

A fault triggers a **protective stop**: the program halts, the faulting line or block is highlighted, a toast and a fault card appear, the fault enters the run trace, and the agent can read it. Self-collision is **not** checked in v1.

### 6.3 World
- **Fixtures:** static OBBs (tables, bins, racks, conveyor frame). Used for collision and as support surfaces.
- **Objects:** `{ id, kind, shape: 'box'|'cylinder', size, pose, color, graspable, state }`. Kitchen objects add `state.fill ∈ [0,1]` and `capacity`.
- **Grasp:** `gripper.close()` attaches the nearest graspable object whose grasp frame lies within `graspTolerance` of the TCP **and** whose approach axis is within `alignTolDeg` of the tool Z axis. Otherwise the gripper closes empty (`gripper.holding === null`, which is not a fault). `gripper.open()` releases the object, which drops vertically to the highest support surface under its footprint. If it lands tilted more than 30°, it is marked `toppled` and placed lying flat.
- **Pour (kitchen/lab):** while a held container with `fill > 0` is tilted more than 90° from upright and its lip is within an XY radius of 40 mm over a target container, fill transfers at 0.5/s (bounded by capacity). Tilting over nothing spills (`spilled += amount`). A particle stream is shown for visuals only.
- **I/O:** a named digital or string I/O table defined per scene:
  - inputs: `part_present` (bool, conveyor end sensor), `color` (string at the sensor station), `door_open` (bool), …
  - outputs: `conveyor_run` (bool), `light` (bool), …
- **Conveyor:** spawns parts from a seeded schedule (`intervalSec`, `jitterSec`, `colors[]`), moves at `speed` m/s while `conveyor_run` is true, and stops a part at the end sensor (setting `part_present = true`).

### 6.4 SimCore interface

```ts
// src/sim/SimCore.ts
class SimCore {
  constructor(scene: SceneDef, arm: ArmDef, opts: { seed: number });
  clone(): SimCore;                              // deep copy for dry runs
  snapshot(): SimSnapshot;                       // serializable full state
  static fromSnapshot(s: SimSnapshot, scene: SceneDef, arm: ArmDef): SimCore;

  // command execution (called by ProgramRunner / dry-run executor)
  begin(cmd: RobotCommand): { ok: true } | { ok: false; fault: Fault };  // pre-check + plan
  step(dtSec: number): StepResult;               // advance active command; returns done|running|fault
  stopNow(): void;                               // halt in place (kinematic → instantaneous)

  // direct manipulation (jog / hand-guide; not during a run)
  setJoints(q: number[]): Fault | null;
  solveIK(target: Pose, seed?: number[]): { q: number[] } | { fault: Fault };

  // queries
  state(): AgentStateView;                       // structured, mm/deg (what the agent sees)
  evaluatePredicates(preds: PredicateDef[]): PredicateResult[];
  readonly simTime: number;
}
type RobotCommand =
  | { op: 'moveJ'|'moveL'; target: TargetRef; speed?: number; }
  | { op: 'moveJoints'; jointsDeg: number[]; speed?: number }
  | { op: 'gripper'; action: 'open'|'close' }
  | { op: 'wait'; ms: number }
  | { op: 'waitInput'; name: string; value: boolean|string; timeoutMs?: number }
  | { op: 'setOutput'; name: string; value: boolean|string }
  | { op: 'query'; what: 'pose'|'joints'|'input'|'holding'; name?: string };
interface Fault { code: FaultCode; message: string; line?: number; blockId?: string; detail?: unknown }
```

---

## 7. User-facing robot API

`src/runtime/robot-api.d.ts` is the single source of truth. It's injected into Monaco and rendered into `content/docs/api-reference.md`, which feeds the agent's docs search.

```ts
/** Pose in the robot base frame. mm and degrees (XYZ-intrinsic Euler). */
interface Pose { x: number; y: number; z: number; rx: number; ry: number; rz: number }
type TargetLike = string | Pose;           // string = name of a taught/scene target
interface MoveOpts { speed?: number /* % of max, 1..100, default 50 */ }

declare const robot: {
  moveJ(target: TargetLike, opts?: MoveOpts): Promise<void>;
  moveL(target: TargetLike, opts?: MoveOpts): Promise<void>;
  moveJoints(jointsDeg: number[], opts?: MoveOpts): Promise<void>;
  home(opts?: MoveOpts): Promise<void>;
  getPose(): Promise<Pose>;
  getJoints(): Promise<number[]>;
  wait(ms: number): Promise<void>;
};
declare const gripper: { open(): Promise<void>; close(): Promise<void>; holding(): Promise<string | null> };
declare const io: {
  get(name: string): Promise<boolean | string>;
  set(name: string, value: boolean | string): Promise<void>;
  waitFor(name: string, value: boolean | string, timeoutMs?: number): Promise<void>;
};
/** Taught targets (read-only in programs) and pose helpers. */
declare const targets: { get(name: string): Pose; list(): string[] };
declare function offset(p: TargetLike, dx: number, dy: number, dz: number): Pose; // tool-agnostic, base frame
declare function log(...args: unknown[]): void;   // appears in console panel + run trace
```

User code is the **body of an async function**, so top-level `await` works. Programs are expected to start with `await robot.home()` or a move.

---

## 8. Safe execution

### 8.1 ProgramWorker
- A dedicated module Worker is created **per run** and terminated on Stop, fault or completion.
- Before user code is evaluated, the worker deletes or overrides `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel` and `navigator.sendBeacon`. The worker never receives the Firebase token or any config. This is defense in depth: the code is the user's own, but the agent's patches are also code.
- The code is wrapped as `new AsyncFunction('robot','gripper','io','targets','offset','log','__hl', src + '\n//# sourceURL=user-program.js')`.
- **Line attribution:** each API stub captures `new Error().stack`, extracts `user-program.js:LINE:COL`, and sends `line` with the RPC. On faults the runner highlights that line in Monaco.
- **Blocks attribution:** the Blockly generator sets `STATEMENT_PREFIX = 'await __hl(%1);\n'`. `__hl(blockId)` is an RPC that highlights the block and records `blockId` for the next command.

### 8.2 Protocol (`src/runtime/protocol.ts`)

```ts
type MainToWorker =
  | { t: 'start'; runId: string; src: string; targets: Record<string, Pose> }
  | { t: 'reply'; id: number; ok: true; value?: unknown }
  | { t: 'reply'; id: number; ok: false; fault: Fault }
  | { t: 'pause' } | { t: 'resume' };           // pause gates the next reply
type WorkerToMain =
  | { t: 'call'; id: number; cmd: RobotCommand | { op: 'hl'; blockId: string }; line?: number }
  | { t: 'log'; args: string[]; line?: number }
  | { t: 'done' }
  | { t: 'error'; message: string; line?: number };   // → USER_ERROR
```

### 8.3 Run controls
`Run`, `Pause` (finishes the current 1 ms step, freezes the clock and holds the next reply), `Step` (executes exactly one robot command, then pauses), `Stop` (terminates the worker and halts the robot in place) and `Reset scene` (restores the task's initial snapshot). The speed slider changes sim-time rate only, never the outcome.

### 8.4 Dry run (agent tool)
`dryrun.worker.ts` receives `{ snapshot, sceneId, armId, src, maxSimTimeSec }`. It instantiates SimCore and runs the program against `robotApi.ts` directly (no RPC hop), as fast as possible, with a wall-clock cap of 5 s. It returns a `RunTrace` and predicate results. The user's live scene is never touched.

```ts
interface RunTrace {
  runId: string; source: 'user' | 'dryrun'; programHash: string; seed: number;
  entries: { simTime: number; line?: number; blockId?: string; cmd: RobotCommand; result: 'ok' | Fault }[];
  logs: { simTime: number; text: string }[];
  outcome: 'completed' | 'fault' | 'stopped' | 'timeout';
  predicates: PredicateResult[]; simDurationSec: number;
}
```

---

## 9. Teaching: jog, hand guide, targets

- **JogPanel:** joint mode (±per joint) and Cartesian mode (±X/Y/Z, ±Rx/Ry/Rz) in **Base** or **Tool** frame. Step sizes are 0.1/1/10 mm (or °) plus a continuous mode while held. Uses `SimCore.solveIK` seeded from the current q. On failure the robot stays put and an inline reason is shown.
- **HandGuide (lead-through):** a toggle shows a `TransformControls` gizmo at the TCP. While dragging, the target pose goes to IK each frame (seeded by the current q, max 30 iterations). On failure the gizmo turns red and the robot holds its last valid pose. For SCARA, rotation is locked to Z. On release the pose stays as is.
- **Teach:** saves the current TCP pose **and** joint configuration as a named target (`P1`, `P2`, … renameable). Moves to a taught target with `moveJ` use the stored configuration directly, which avoids configuration ambiguity. `moveL` uses the pose.
- **TargetsPanel:** list, rename, re-teach, delete, "Go to" (moveJ at 25%) and show/hide frames in the viewport. Scene-defined targets (e.g. `binA.approach`) are listed and read-only.
- Jogging, hand guiding and teaching are disabled during a run.

---

## 10. Programming surfaces

### 10.1 Mode
Each task sets `editor: 'blocks' | 'code'`. In demo mode the user may switch editor per task, which starts an empty program in the other editor. There is **no JS→blocks conversion**. Blocks mode shows a collapsible, read-only JS preview.

### 10.2 Wizard-style block set (original design)
High-level, task-oriented blocks with large slots and target dropdowns fed from TargetsPanel.

| Category | Blocks |
|---|---|
| Motion | `Move to [target▾] [joint▾/linear] speed [50]%` · `Move to [target▾] offset X[ ] Y[ ] Z[ ] mm` · `Go home` |
| Gripper | `Open gripper` · `Close gripper` · `If holding something … else …` |
| I/O | `Wait until [input▾] is [value]` (optional timeout) · `Set [output▾] to [value]` · `If [input▾] is [value] … else …` |
| Flow | `Repeat [n] times` · `Repeat while [condition]` · `Wait [s] seconds` · `Comment` |
| Data | `counter` variables (set/change by), basic arithmetic, number and text literals (for palletizing offsets) |

`generator.ts` emits code against the §7 API only. A "Teach here" button on target dropdowns teaches and selects a new target in one step.

### 10.3 Code editor
Monaco with TypeScript language service, `robot-api.d.ts` and a starter template per task. Agent patches appear in a Monaco diff editor with **Apply / Reject / Edit before applying** buttons.

---

## 11. Tasks, scenes, experiments

### 11.1 Scenes (`content/scenes/*.json`)
`{ id, fixtures[], objects[], io: { inputs[], outputs[] }, conveyors[], sceneTargets{}, camera }`

v1 ships:
1. **factory-pick:** a conveyor delivers parts to an end sensor, with a fixture plate and a reject bin.
2. **palletize-sort:** an input tray, colored parts, a color sensor station, 3 bins and a 2×3 pallet.
3. **kitchen-lab:** a counter, cups, a pitcher (fill state), a test-tube rack and tubes.

### 11.2 Tasks (`content/tasks/*.json`)

```ts
interface TaskDef {
  id: string; title: string; brief: string;          // markdown shown to user and agent
  sceneId: string; armId: string; seed: number;
  editor: 'blocks' | 'code';
  starter?: { code?: string; steps?: Step[] };       // steps: a block program (JSON steps) to finish or to fix
  presetTargets?: Record<string, Pose>;              // targets given to the user up front
  predicates: PredicateDef[];                         // all must pass at program completion
  maxSimTimeSec?: number; timeLimitSec?: number;     // timeLimitSec = wall-clock study limit
  hints?: string[];
}
```

At least 2 tasks per scene (6 total), plus 2 tutorial tasks (`tut-jog-teach`, `tut-first-program`).

**Every demo task is a blocks task.** The former JavaScript tasks start from a block program instead:
- `factory-bin-three` "Finish the loop": the loop waits for a part and goes down to it; the user adds grab, lift, drop.
- `palletize-2x2x2` "Fix the palletizer": a complete program with three bugs (one layer instead of two; rows shifted by the column counter; the move down ignores the layer height).
- `kitchen-pour` "Fix the pour": a complete program with two bugs (the gripper never closes; it stays tipped too briefly to fill the cup). Task presets `pour.start` / `pour.tilt` stand in for the computed tilt pose.

`tests/unit/starters.test.ts` checks that each starter fails, the intended fix passes, and each listed bug fails on its own. A starter is saved to the workspace as soon as the editor loads it, so the AI partner, checkpoints and logs see it. `stackPattern` requires rows × cols separate grid spots per layer and nothing above the top layer (it used to count cubes per layer only, so wrong grids passed). Because task 3 of the pilot changed, the pilot experiment's `version` went to 3.

### 11.3 Predicates (`src/sim/predicates/registry.ts`)
`objectInRegion(objId|kind, regionId, tolMm)` · `allOfKindInRegion(kind, regionId)` · `sortedByColor(map: color→regionId)` · `stackPattern(regionId, rows, cols, layers, tolMm)` · `upright(objId)` · `fillAtLeast(objId, frac)` · `spilledAtMost(frac)` · `noFaults()` · `simTimeBelow(sec)` · `programCompleted()`.

Predicates are evaluated live (for the checklist UI) and finally at program completion. A task **passes** when a run completes with all predicates true.

### 11.4 Experiments (`content/experiments/*.json`)

```ts
interface ExperimentDef {
  id: string; version: string;
  conditions: Record<string, {
    agent: { mode: 'off' | 'qa' | 'suggest'; model?: string; promptVersion: string };
    taskSequence: string[];                    // task ids
  }>;
  assignment: 'byCode';                         // codes carry their condition
  counterbalance?: { method: 'latinSquare'; over: 'taskSequence' };  // order index derived from code
  postSurveyUrl?: string;                       // ?pid={code}&exp={id} appended
  logging: { telemetry: boolean; snapshotDebounceMs: number };
}
```

**Progression:** study mode follows the sequence strictly (no free navigation). A task advances on pass (with a "Next task" confirmation), on timeout (auto-advance, logged) or on Skip (confirmation dialog, logged). After the last task, the app redirects to `postSurveyUrl`. Demo mode shows a task picker with tutorials first and no scoring.

---

## 12. AI partner

### 12.1 Graph (`src/agent/graph.ts`)
A single ReAct agent built from LangGraph `StateGraph` with `MessagesAnnotation`, plus a `model` node, a `tools` node and a conditional edge. Limits: **8 tool calls per user turn**, and a 60 s turn timeout (then it stops gracefully with a partial answer). Tokens stream into the chat panel. The conversation is kept per task. Context trimming keeps the system prompt, the task brief, the last 20 messages and the last tool results, summarizing older turns into a single message.

### 12.2 Tools (`src/agent/tools.ts`)

| Tool | Args | Returns | Modes |
|---|---|---|---|
| `read_task` | — | brief, predicates (+ live status), preset targets, editor mode | qa, suggest |
| `read_program` | — | current JS (code mode) or block workspace JSON + generated JS (blocks mode) | qa, suggest |
| `read_sim_state` | — | `AgentStateView`: joints (deg), TCP pose, targets, objects (pose, state), I/O, holding, last fault | qa, suggest |
| `read_last_run` | — | last user `RunTrace` (truncated to 200 entries) | qa, suggest |
| `search_docs` | `query` | top 5 chunks from `docs-index.json` (BM25, client-side) | qa, suggest |
| `dry_run` | `program` (JS) | `RunTrace` + predicate results from §8.4 | suggest |
| `propose_patch` | code mode: `{ newProgram, explanation }`; blocks mode: `{ blocksJson, explanation }` | `{ proposalId }`. The UI shows a diff or ghost blocks, and the user decides | suggest |

- Mode `off` hides the chat panel entirely. Mode `qa` registers only the read and search tools. The system prompt says it may explain and show snippets but cannot edit.
- **Blocks patches** (`src/blocks/patch.ts`) are validated against the active toolbox's block types and the existing target names. Invalid patches are returned to the model as a tool error with reasons, and are never shown to the user. Valid ones render as semi-transparent ghost blocks with Accept and Reject buttons.
- The agent **cannot** run the user's program, press any button, or teach or modify targets. It can suggest the user teach a target with a given name.

### 12.3 System prompt
`prompts/system.v1.ts` exports `{ version: 'sys-v1', text }`. It covers the robot API summary, units, the fault taxonomy, the Wizard block vocabulary, the requirement to `dry_run` before every `propose_patch` in suggest mode, and the instruction to prefer taught target names over raw coordinates. The version is logged with every agent event.

### 12.4 Tool-calling fallback
OpenAI models on the allowlist support native tool calls. `jsonProtocol.ts` exists for future non-tool models. If `config.models[x].tools === false`, the graph uses a prompt protocol where the model emits a single fenced block ` ```action {"tool": "...", "args": {...}} ``` `. It's parsed with zod and malformed blocks are retried once with the parse error. Plain prose is treated as the final answer.

### 12.5 LLM transport (`src/agent/llm.ts`)

```ts
new ChatOpenAI({
  model, streaming: true, apiKey: 'unused',
  configuration: {
    baseURL: `${import.meta.env.VITE_LLM_PROXY_URL}/v1`,
    fetch: async (url, init) => fetch(url, { ...init, headers: {
      ...init?.headers, 'X-Firebase-Token': await auth.currentUser!.getIdToken(),
      'X-Session-Id': session.id } })
  }
});
```

---

## 13. Backend (Firebase)

### 13.1 Auth and modes
- Every visitor signs in with **Firebase Anonymous Auth** on load.
- **Demo mode** is the default at `/`. No code is needed.
- **Study mode** is entered with `/?code=XXXX-XXXX` or a code-entry screen. The client calls `redeemCode({ code })`:
  - It validates `codes/{code}` (`active`, experiment exists).
  - It binds the code to the current uid in `participants/{uid}` = `{ code, experimentId, condition, orderIndex }`. If the code was already bound to another uid (new device or cleared storage), it rebinds and logs `code_rebound`.
  - It returns `{ sessionId, experimentId, condition, orderIndex, resumeCheckpoint? }`.

### 13.2 `llmProxy` (HTTPS onRequest, `POST /v1/chat/completions`)
1. CORS: allow `https://<github-user>.github.io` and `http://localhost:5173` only.
2. Verify `X-Firebase-Token` with the Admin SDK. Reject if missing or invalid (401).
3. Resolve the mode: `participants/{uid}` exists → study, otherwise demo.
4. **Model check:**
   - Study: `body.model` is **overwritten** with the condition's model. If the condition's `agent.mode === 'off'`, reject (403).
   - Demo: `body.model` must be in `config/llm.demoModels` (cheap models only), otherwise 400.
5. **Quota check** (Firestore transaction on `usage/{uid}_{YYYYMMDD}`, and for demo also `usage/ip_{sha256(ip+salt)}_{YYYYMMDD}`): requests and tokens per day against `config/llm.limits.{demo|study}`. For demo, also check the global `usage/demo_global_{YYYYMMDD}` against `config/llm.demoDailyTokenBudget`. If over, return 429 `{ error: 'quota', scope }`, and the UI shows a friendly message.
6. Kill switch: `config/llm.enabled === false` → 503.
7. Forward to OpenAI with the server-held key (Secret Manager `OPENAI_API_KEY`), forcing `stream_options.include_usage = true`, and strip any client-sent `user`/`metadata`. Pipe SSE bytes back unchanged.
8. On stream end, add the `usage` totals to the counters.
9. Body size cap 256 KB. `max_tokens` is clamped to `config/llm.maxOutputTokens`.

The function **never** logs prompt content. Study transcripts are logged by the client to the participant's session (§14).

### 13.3 Firestore layout

```
config/llm                { enabled, demoModels[], limits{demo,study}, demoDailyTokenBudget, maxOutputTokens }
codes/{code}              { experimentId, condition, orderIndex, active, createdAt }
participants/{uid}        { code, experimentId, condition, orderIndex, boundAt }
usage/{key}               { requests, promptTokens, completionTokens, updatedAt }   // functions-only
sessions/{sessionId}      { code, uid, experimentId, condition, appVersion, promptVersion, startedAt, userAgent }
sessions/{sid}/checkpoint/current  { taskIndex, program, blocksJson, targets, chat, updatedAt }
sessions/{sid}/batches/{autoId}    { seqStart, seqEnd, events: LogEvent[], clientTime }
```

### 13.4 Security rules (`firestore.rules`) — summary
- `config`, `codes`, `participants`, `usage`: no client read or write (functions/admin only).
- `sessions/{sid}`: create only if `request.auth.uid == request.resource.data.uid` and `participants/{uid}.code == request.resource.data.code`; no client read, update or delete.
- `batches`: create-only by the session owner, with each document < 500 KB; no reads, updates or deletes.
- `checkpoint/current`: create, update and read by the session owner only (needed for resume).
- Demo mode writes **nothing** to Firestore except the function-managed usage counters.

---

## 14. Research logging (study mode)

### 14.1 Pipeline (`src/study/logger.ts`)
`log(event)` → in-memory buffer → appended to an IndexedDB queue (`idb-keyval`) with a monotonic `seq`. A flusher writes a batch document every 5 s, every 50 events, or on `visibilitychange: hidden`. Rows are deleted from IndexedDB only after the write is acknowledged. When offline it retries with backoff, and queued events survive reloads. Every event carries:

```ts
interface LogEventBase { seq: number; t: number /* epoch ms */; simTime?: number; sessionId: string;
  taskId?: string; taskIndex?: number; type: string; }
```

### 14.2 Event catalog (`src/study/events.ts`)
- **Session:** `session_start`, `resume`, `code_rebound`, `task_start`, `task_pass`, `task_timeout`, `task_skip`, `session_end`.
- **Program:** `program_snapshot` (debounced `snapshotDebounceMs`, default 2000; full code or blocks JSON plus hash), `block_event` (create/delete/move/change with block type and id), `code_edit` (Monaco change summary: chars added/removed and line range), `editor_preview_toggle`.
- **Teaching:** `jog` (mode, frame, axis, step; coalesced per 1 s burst), `handguide_start/end` (start and end pose, IK failures count), `target_teach/rename/delete/goto`.
- **Runs:** `run_start` (runId, programHash, seed, speed), `run_pause/step/stop`, `run_fault` (code, line or blockId), `run_end` (outcome, predicates, simDuration, wall duration), plus the full `RunTrace` attached to `run_end` (truncated to 500 entries).
- **Agent:** `agent_user_msg` (text), `agent_model_msg` (text, model, latency ms, tokens if available), `agent_tool_call` (name, args, result truncated to 4 KB, duration), `agent_proposal` (proposalId, kind, full patch, the dry-run summary that preceded it), `agent_proposal_decision` (accepted | rejected | edited_then_applied, time-to-decision ms), `agent_error` (quota/network/parse). All carry `promptVersion`.
- **UI telemetry** (when `logging.telemetry`): `focus`/`blur`, `panel_toggle`, `camera_move` (throttled to 1 per 2 s, end pose only), `idle_start/idle_end` (60 s threshold), `help_open`.

**Never logged:** Firebase tokens, IP addresses (the function stores only the salted hash in usage counters), or anything from demo mode.

### 14.3 Resume
A checkpoint is written to `checkpoint/current` (and IndexedDB) on every `program_snapshot`, target change, chat turn end and task transition. On redeem or reload the app restores the task index, program, targets and chat, and logs `resume`. A timed task's timer resumes from the remaining time saved in the checkpoint.

### 14.4 Export
`scripts/export-logs.ts --experiment <id> [--out dir]` uses the Admin SDK to write `events.jsonl` (flattened, sorted by session and seq), `sessions.csv`, `runs.csv`, `agent_turns.csv` and `proposals.csv`. Gaps in `seq` are reported.

---

## 15. UI layout

> **Superseded by the two-view pendant layout in §0 (“UI layout”).** The text below describes the original three-column draft.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Tandem      [Task 2/6: Sort by color]   ⏱ 08:41   [mode: Study P-7F3K]    │
├───────────────┬───────────────────────────────────┬──────────────────────┤
│ Task          │                                   │  AI Partner          │
│  brief        │         3D Viewport               │  (hidden if off)     │
│  ☐ predicates │   (orbit; frames; hand-guide)     │  chat, streaming     │
│ Targets       │                                   │  proposal cards      │
│  P1 P2 …      │                                   │  [model: locked]     │
│ Jog           ├───────────────────────────────────┤                      │
│  joint/cart   │ Blocks | Code   (+JS preview)     │                      │
│  [Teach]      │                                   │                      │
│  [Hand guide] │ ▶ Run ⏸ ⏭ Step ■ Stop ↺ Reset  1x │                      │
│               │ Console / Faults / I/O            │                      │
└───────────────┴───────────────────────────────────┴──────────────────────┘
```

- Panels are resizable, and the layout is remembered per viewer in localStorage (wrapped in try/catch).
- Fault cards show the code, a plain-language explanation and a "highlight line/block" link. When the agent is enabled, they also show an "Ask AI partner about this" link that pre-fills the chat.
- All controls are keyboard-accessible. Run is `Ctrl/Cmd+Enter`, Stop is `Esc`.
- Viewports narrower than 1024 px show a "please use a desktop browser" notice.
- Demo mode shows a model dropdown (from `config/llm.demoModels`, fetched via the public `GET /config` endpoint of the function) and the remaining daily quota.

---

## 16. Configuration and deployment

- `src/config.ts` reads `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_LLM_PROXY_URL` and `VITE_APP_VERSION` (git SHA).
- `deploy.yml`, on push to `main`:
  - Job 1: `npm ci && npm run build` → GitHub Pages.
  - Job 2: `firebase deploy --only functions,firestore:rules` using the `FIREBASE_SERVICE_ACCOUNT` secret.
- Local development: `npm run dev` (Vite) and `npm run emulators` (Auth, Functions, Firestore). `VITE_LLM_PROXY_URL` points at the emulator, and the function's OpenAI base URL can be overridden with `LLM_UPSTREAM_URL` (used by the mock LLM in tests).
- Scripts: `dev`, `build`, `preview`, `lint`, `typecheck`, `test` (vitest), `test:e2e` (playwright), `test:functions` (emulator), `docs:index`, `codes:gen`, `logs:export`.

---

## 17. Out of scope (v1)

- Rigid-body physics, dynamics, torques, payload effects, and objects colliding with each other (a dropped object stacks only by the support-surface rule)
- Self-collision checking, and collision-free path planning (moves are point-to-point; collisions fault rather than being avoided)
- Cobot safety features: speed and separation monitoring, safety zones, human avatars, ISO/TS 15066 force limits
- Blend and zone radii (fine points only), circular moves (moveC), conveyor tracking, external axes (multiple robots in one cell: now designed in §21)
- JS→blocks conversion, Python, and any RAPID/URScript-style DSL
- Viewport screenshots or vision input for the agent
- Objects as obstacles: the arm collides only with fixtures, not with loose parts or containers
- The agent autonomously running programs or changing targets; autonomous assistance level
- Users bringing their own API keys; non-OpenAI providers (the transport is OpenAI-compatible, so this can be added later)
- In-app consent forms and surveys (external, via redirect)
- Mobile/tablet layouts, localization beyond English
- Gamification (stars, scores, leaderboards)
- Experimenter dashboard UI (export script only)
- Importing URDF/meshes

---

## 18. Risks and open questions

| # | Item | Plan |
|---|---|---|
| R1 | ~~The UAIbotJS license is undocumented.~~ **Resolved:** MIT (LICENSE.md in the repo). Meshes are vendored with the license. | See §0. |
| R2 | The exact GoFa-class and UR-class DH parameters. | Source them from public datasheets into `content/arms/*.json`. Validate reach envelope and joint limits in unit tests. Keep names, visuals and colors generic. |
| R3 | ~~UAIbot may not expose its scene/camera.~~ **Resolved** by the fallback: our own Three.js renderer, UAIbot meshes plus converted kinematics. | See §0. |
| R4 | Stack-trace line parsing differs by browser. | Unit-test it on Chrome and Firefox in Playwright. Fall back to no-line faults gracefully. |
| R5 | Demo abuse through anonymous account churn. | IP-hash quota plus a global demo budget and kill switch. Optionally add App Check later. |
| R6 | IRB requirements for transcripts and telemetry. | Fields are listed in §14.2. Confirm with your IRB before the first study. |

---

## 19. Milestones

0. **Spike:** UAIbot adapter, TransformControls, own FK parity with UAIbot for KR5.
1. **SimCore:** FK/IK/planner/faults/world, plus unit tests (headless).
2. **Runtime:** worker RPC, run controls, line and block highlighting, dry-run worker.
3. **Teaching and editors:** jog, hand guide, targets, Monaco, the Blockly block set and generator.
4. **Content:** 4 arms, 3 scenes, 8 tasks, predicates and checklist.
5. **Agent:** graph, tools, patch flows (diff and ghost blocks), mock-LLM fixtures.
6. **Firebase:** auth, `redeemCode`, `llmProxy` with quotas and allowlist, rules, and emulator tests.
7. **Study:** session sequencing, logger, resume, timer and skip, export script.
8. **Deploy and the end-to-end check (§20).**

---

## 20. End-to-end acceptance check (proves v1 works)

### 20.1 Automated (CI: `npm run lint && npm run typecheck && npm test && npm run test:functions && npm run test:e2e`)

**Unit (Vitest)**
1. FK parity: our DH FK matches UAIbot `fkm` for `kuka-kr5` and `epson-t6` within 1e-6 m on 100 random configurations.
2. IK round-trip: for each 6-DOF arm, on 500 random reachable configurations, `fk(ik(fk(q)))` is within 0.1 mm / 0.05°.
3. Planner faults: an unreachable target gives `UNREACHABLE`; a path through the wrist singularity gives `SINGULARITY`; a moveL into a table gives `COLLISION`, and in each case the robot's joints are unchanged.
4. Determinism: running `palletize-sort` reference solution twice with seed 42 gives identical `RunTrace` JSON; seed 43 gives a different color order.
5. Blocks compiler: each block compiles to the expected JS snapshot, and the compiled reference block program for `tut-first-program` passes its predicates in a headless SimCore.
6. Predicates: fixtures for each evaluator (pass and fail cases), including pour fill transfer and spill.
7. Runaway: `while(true){}` is terminated with `RUNAWAY` within 4 s wall-clock.
8. Sandbox: the user code `await fetch('https://example.com')` produces `USER_ERROR` (fetch is not a function).

**Functions (Emulator)**
9. No token → 401. Demo uid requesting a non-allowlisted model → 400. Study uid requesting any model → the forwarded body uses the condition's model (assert via mock upstream). A condition with `agent.mode: 'off'` → 403.
10. Quotas: the demo per-uid cap gives 429 on request N+1; the global demo budget gives 429 for a fresh uid; `config/llm.enabled=false` → 503.
11. Rules: a client cannot read `codes`, `usage`, or another session's batches; it can create its own session and batches only after `redeemCode`.

**E2E (Playwright, mock LLM upstream replaying `tests/fixtures/mock-llm/*.sse`)**
12. Study happy path:
    1. Open `/?code=TEST-0001` (condition `suggest`, model locked to `gpt-5-mini`). The header shows "Study", and the model selector is locked.
    2. **Task 1, `tut-jog-teach` (blocks):** jog joint 1 by +10°, enable Hand guide, drag the gizmo 50 mm in +X, and Teach `P1`. The checklist predicate "target P1 taught" passes, and the user clicks Next.
    3. **Task 2, `factory-pick` (blocks):** build `Go home → Wait until part_present is true → Move to pick.approach → Move to pick (linear) → Close gripper → Move to place (joint) → Open gripper`. Click Run. The part is delivered by the conveyor, picked and placed, and all predicates turn green.
    4. Introduce a bug by changing `place` to an unreachable typed pose. Run → a fault card shows `UNREACHABLE` and the faulting block is highlighted. Click "Ask AI partner about this". The mock agent calls `read_last_run`, `read_program`, `dry_run` and `propose_patch`. Ghost blocks appear; Accept; Run → pass.
    5. **Task 3, `kitchen-lab` (code):** paste the reference program, Run → `fillAtLeast(cup1, 0.8)` passes.
    6. Reload the page mid-task 3 → the app resumes on task 3 with the program and chat intact.
    7. Finish → redirect to the `postSurveyUrl` with `pid=TEST-0001`.
13. Log verification (same test, then `scripts/export-logs.ts` against the emulator):
    - The `events.jsonl` sequence numbers are contiguous.
    - It contains, in order: `session_start`, `task_start×3`, `target_teach`, `handguide_start/end`, `run_start`, `run_fault{code:UNREACHABLE}`, `agent_user_msg`, `agent_tool_call{name:dry_run}`, `agent_proposal`, `agent_proposal_decision{accepted}`, `run_end{outcome:completed, all predicates true}`, `resume` and `session_end`.
    - No event contains a token string.
14. Demo path: open `/` with no code, pick a model, and ask "how do I make a linear move?" A streamed answer appears that cites `robot.moveL` (mock). Firestore has **no** session documents for this uid. After exhausting the mock per-uid quota, the chat shows the quota message and the sim keeps working.
15. Condition `qa`: the agent panel shows no proposal UI, and the tool list sent to the upstream excludes `dry_run` and `propose_patch` (asserted from the mock's received request). Condition `off`: the chat panel isn't rendered.

### 20.2 Manual smoke test on the deployed site (one time, before the first study)
1. On the GitHub Pages URL in Chrome and Firefox, demo mode loads within 5 s, and all four arms can be selected via tutorial tasks and render correctly.
2. With a real OpenAI model, ask the agent to "write a program that sorts the parts by color" in `palletize-sort` (code mode). It dry-runs, proposes a diff, and after Apply and Run all predicates pass (allowing ≤2 follow-up turns).
3. Generate 2 real codes with `npm run codes:gen`. Complete one study session end to end on a lab machine, with Wi-Fi toggled off for 30 s mid-task. Export the logs and confirm no `seq` gaps and that the session matches what was done.
4. Set `config/llm.enabled=false` in the console → the agent shows the disabled message within one request, and the sim stays usable.

---

## 21. Multi-arm tasks (Duplo-style cooperative programming)

> Status: **built** (sim, runtime, block lanes, pendant, four tasks, code mode, AI partner, logging, Studio). Tests: `tests/unit/multiarm.test.ts`, `tests/e2e/multiarm.spec.ts`. Where the build differs from the first draft, the text below describes the build (§21.11 lists the changes). Based on Fronchetti et al., *Block-based Programming for Two-Armed Robots: A Comparative Study* (ICSE '24, `refs/`), which introduced **Duplo**. Tandem copies Duplo's programming approach: **one program per arm, shown side by side, with cross-canvas sync blocks that stay vertically aligned**. It generalizes from Duplo's one two-armed robot to **N independent arms in one cell**. Everything in §1–§20 still holds for single-arm tasks; a task is multi-arm only when its scene defines `robots`.

### 21.1 Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Physical setup | **Separate single-arm cobots in one cell**, each with its own base pose and any existing arm model. No dual-arm torso model. |
| D2 | Arm count | **N arms** in the data model, sim, runtime and agent. The UI is designed and tested for **2**, and lanes scroll horizontally for 3–4. Sync blocks always span **all** arms. |
| D3 | Synced moves | **Shared grasp, rigid carry.** A `twoHanded` part lifts only when every arm holding it is in the same synced move. The leader moves to its target in a straight line; followers keep their grasp offset to the leader, so the part moves rigidly. |
| D4 | Layout | **Wide pendant** on multi-arm tasks (the cell view shrinks) so the Program screen shows the lanes side by side. Jog and Positions get an arm picker. |
| D5 | Code mode | **One JS program per arm**, side by side, matching the blocks one to one: `sync()` and `robot.moveTogether(target)` / `robot.follow()`. |
| D6 | AI partner | **Full support**: per-arm JSON steps, dry run, propose, show_blocks and ghost preview. The prompt becomes `sys-v4`. |
| D7 | First tasks | Two-arm tutorial, Handover, Parallel throughput, and a Duplo assembly replica (spacer, gear, two-handed propeller). |
| D8 | Arm-vs-arm safety | **Full pre-check over time.** Before any motion starts, its timed path is checked against every other arm's committed timed path. On a predicted hit, nothing moves, and the fault names both arms' blocks. |
| D9 | Availability | **Demo levels** (after the single-arm levels) **and Studio experiments**, with per-arm study logging. |
| D10 | Run controls | **Global pause; Step is per arm.** Step advances one command on every arm that has one ready. Each lane highlights its own running block; an arm parked at a sync shows a "Waiting for others" badge. |
| D11 | Positions | **Per-arm lists** (A: P1, P2…; B: P1…) in each arm's base frame. **Teach all arms** saves one name for every arm at once (ROY's "current position from both arms"), used by synced moves. |
| D12 | Alignment | **Strict Duplo alignment.** Dropping a sync block in one lane inserts its twin in every lane. Deleting one copy deletes all; moving a copy within its lane moves only that copy, unless it changes its order among the lane's sync blocks (then its twins are re-placed to keep the order). The editor pads lanes so twins sit on the same row, and the lanes scroll together. |

### 21.2 Content model
- **Scene:** an optional `robots: [{ id: "A", label: "Left arm", armId, base: { x, y, z, rz }, color?, targets? }]`. The base is planar (mm, yaw in degrees about world Z), which keeps fixture boxes yaw-only in every arm's frame. When `robots` is present, the task's `armId` and the scene's `sceneTargets` are not used. Ids match `^[A-Z][A-Za-z0-9]*$` (`A`, `B`, …), and labels are what users see. Lane, arm-tint and badge colors come from `color`.
- **Scene targets** are per arm, in `robots[i].targets`, in that arm's **base frame** (the coordinates its Jog readouts show). A target meant for two arms (e.g. `prop.lift`) is defined once per arm. `robotsFor(scene, armId)` in `src/content/index.ts` turns a scene into SimCore's `RobotSetup[]`; single-arm scenes become one robot `A` with an identity base and `sceneTargets`.
- **Objects** gain `twoHanded?: boolean`. A two-handed part rises only in a synced move where every holder is part of the move.
- **Task:** single-arm tasks keep `armId`. Multi-arm tasks may not set `armId` (the loader fills it with the first robot's arm so existing code keeps working), and the Settings "Robot arm" override is hidden for them. `editor` defaults to blocks.
- **Workspace** (per task): `lanes: { [robotId]: { blocks?: BlocklyState; code?: string; targets: Record<string, Target> } }` instead of one program and one target list. Checkpoints and resume store the same shape.
- **Zod** (`src/content/index.ts`) and Studio enforce: unique robot ids; known arm models; multi-arm tasks don't set `armId`; a reference solution exists in `tests/fixtures/solutions/<task>.js`. Multi-arm solutions start each arm's program with a line `// @lane <robotId>` (`splitLanes` / `joinLanes` in `src/runtime/headless.ts`). Studio's scene editor has an "Arms" JSON field (validated with the same schema), and the task editor runs `@lane` solutions and strips the loader-filled `armId` on save.
- **Conveyor spawns** may set `cycle: true` to take `colors` in order (red, blue, red, …) instead of drawing them from the seeded rng.

### 21.3 Simulation (`src/sim/`, still pure and deterministic)
- **State.** `SimState.robots: Record<RobotId, RobotState>`, each with `q`, `gripperOpen`, `holding`, `active` and taught `targets` (base frame). Single-arm scenes are one robot `A`, so there's one code path. SimCore's single-arm methods (`tcp()`, `tcpPose()`, `setJoints()`, `allTargets()`, `rs()` …) take an optional robot id that defaults to the first robot; `stepAll()` advances every arm and returns per-robot events, and `step()` remains as the single-robot wrapper.
- **Clock.** The §6.1 rule generalizes to: *sim time advances only while at least one arm is executing a command and every other live arm is executing, blocked at a sync, waiting on I/O, or finished.* An arm whose program is computing between commands holds the clock. This makes interleaving independent of worker timing, so the determinism test still compares full `RunTrace` JSON.
- **Commands** carry `robot: RobotId`. `begin()` plans and pre-checks one arm's command at the current sim time, and `step(dt)` advances every active command.
- **Arm-vs-arm pre-check (D8).** Every committed motion is stored as a timed capsule track (sampled every 10 ms). A new motion's track is checked against:
  - the remaining tracks of other moving arms;
  - the current pose of stationary arms (capsules plus any held part);
  - for the rest of the run, as later moves commit.
  A predicted hit raises `ARM_COLLISION` with `detail: { arms: [a, b], atSimTime, links }`. Neither arm starts, and running arms stop at the current instant. The fault card names both blocks.
- **Self-collision** stays out of scope (§17). Arms check against fixtures, each other, and parts held by other arms.
- **Sync wait.** `{ op: 'sync', kind: 'wait' }` parks the arm until **every** arm's program has parked at its next sync. The *k*-th sync in each program pairs with the *k*-th sync in every other. A program that has already finished can never reach a sync, so a sync reached after any arm finished is a `SYNC_MISMATCH`.
- **Synced move.** The leader sends `{ op: 'sync', kind: 'move', target, speed }`; followers send `{ op: 'sync', kind: 'follow' }`. The scheduler pairs them by position and calls `SimCore.beginSync(leader, …, followers)`. Once all have arrived:
  - The leader plans a moveL. Each follower's TCP path is `leaderTcp(t) · offsetᵢ`, where `offsetᵢ` is frozen at the start, and IK runs every 2 mm on each.
  - All arms are pre-checked together (reach, limits, singularity, fixtures, each other), then move in lockstep.
  - A follower whose path fails raises the fault on its own block.
- **Two-handed grasp.** Closing a gripper on a `twoHanded` part adds that arm to the part's holder set (a holder is any arm whose `holding` names the part); the part stays put until it moves in a synced move with all its holders. Two-handed parts, and parts another arm already holds, can be gripped anywhere along their footprint; every other grasp keeps the original center rule, so single-arm behavior is unchanged.
  - Moving one holder alone raises `SHARED_GRASP` ("both arms are holding the propeller — use Move together").
  - Opening one gripper while the part is lifted drops it.
  - Single-arm pick on a two-handed part raises `NEEDS_TWO_HANDS` on the first lift attempt.
  - **Handover** is a re-grasp: arm B closes on a part arm A holds (top-down grasps can't meet at one point), then A opens. That records `{from: A, to: B}` on the part for the `handedOver` predicate. While both hold an ordinary part, neither can move alone (`SHARED_GRASP`).
  - Grippers may touch parts another arm holds, as with any loose part; arm links may not (`ARM_COLLISION`). Two grippers closed on the same part are not checked against each other.
- **Deadlock.** If every live arm is parked or finished but a sync can't complete (an arm finished, or the counts differ), the run stops with `SYNC_MISMATCH`. The message names the lane that is missing a sync, and each waiting arm's sync block is highlighted.
- **Faults** add `ARM_COLLISION`, `SHARED_GRASP`, `NEEDS_TWO_HANDS` and `SYNC_MISMATCH` to §6.2's table. All are pre-checks, like the existing ones.
- **Predicates** gain an optional `robot` (`holding`, `targetTaught`) and add `objectOn {object, on}` (stacked within tolerance), `handedOver {object, from, to}` (the part was held by `from` and then by `to` without touching a support in between) and `noArmCollisions`.

### 21.4 Runtime
- **One worker per run** hosts every lane's program, one per arm, started together (`start { lanes: [{ robot, src, targets }] }`; calls and errors carry `lane`). `src/runtime/scheduler.ts` decides when calls begin and when time advances under the §21.3 clock rule; `ProgramRunner` (live) and `runHeadless` (dry runs, tests, landing) share it, and `runHeadless` accepts a string (first robot) or `{ [robotId]: src }`. Same sandbox, runaway guard and line attribution as today; in multi-arm runs each lane's `sourceURL` is `user-program-<robotId>.js` so stack frames tell the lanes apart.
- **`robotApi.ts`** stays the single API implementation, now built per robot. `headless.ts` (dry runs, tests, landing hero) runs the same multi-lane scheduler.
- **Code-mode API (D5)**, per lane:
  - `robot.*`, `gripper.*`, `io.*`, `targets.*` as in §7, bound to that arm;
  - `await sync()`, i.e. Wait for each other;
  - `await robot.moveTogether(target, opts?)` (leader) and `await robot.follow()` (every other lane), both at the same sync position.
  `targets` resolves in that arm's list.
- **Run controls (D10).** Pause freezes the clock and holds every arm's next reply. Step releases one command on each arm with one ready, then pauses again; arms parked at a sync stay parked. Stop ends all lanes. The status light reflects the whole cell.
- **Trace.** `RunTrace` entries gain `robot`, and sync completions are logged as `{ op: 'sync', seq, simTime }`.

### 21.5 Programming surface
- **Lanes.** The Program screen shows **one Blockly workspace with a column per arm** (`src/blocks/lanes.ts`), so blocks drag between lanes natively, one toolbox serves every lane, and lanes share scroll and zoom. Each lane starts with a non-movable `lane_start` hat colored like its arm ("Left arm · When Run is pressed"); the layout re-spaces columns to fit their widest stack. Code is generated per lane (`lanesCode`). The Blocks/JavaScript toggle shows every lane's JS.
- **Block set.** All existing blocks work unchanged inside a lane; target and I/O dropdowns list that arm's positions. A new **Together** category holds the two cross-lane blocks:
  - **Wait for each other.** Inserted into every lane at the same row; each copy shows a link icon.
  - **Move together to [target], others follow.** The leader copy names a target from the leader's list; every other lane's twin reads "Follow [Left arm]". Dragging the block into a lane makes that lane the leader. Swapping leaders is a dropdown on any copy.
- **Twin behavior (D12).** Twin maintenance emits no Blockly events (events are delivered asynchronously, so our own changes would come back looking like user edits); the editor's save listener runs after it for the same user event, and undoing the user's action removes or restores twins through the same listener.
  - Twins share a `syncId`, and editing, moving or deleting any copy applies to all of them, in one Blockly event group (one undo step).
  - A sync block can't go inside a loop or if (the drop is refused, with a tooltip), because counts must match across lanes. Code mode reports the same rule as `SYNC_MISMATCH` at runtime.
  - Disabling or detaching a copy detaches all its twins.
- **Alignment.** After every change, an async layout pass sets the height of a spacer row at the top of each sync block (a spacer row has a minimum height, so when a row needs padding every twin in it shows one, each sized by measure-and-correct). The *k*-th sync row then ends at the same y in every lane. The padded part of a block shows a dashed line and "waiting": it is time that arm spends waiting. The pass suppresses events only around its own synchronous changes, so edits made while it waits for rendering are never lost.
- **Leader.** A copy dragged into another lane, or a new block, leads; moving a Follow copy within its lane keeps the current leader. Right-click a Follow copy → "Lead the move from this arm" to swap leaders (the leader keeps its target name if that arm has it).
- **Code mode** shows one Monaco editor per lane, side by side, with lane headers. The typings (`editor/robotApiDts.ts`) add `sync`, `moveTogether` and `follow`. Blocks compile one way to the per-lane JS.
- **Highlighting.** Each lane highlights its own running block or line. A parked sync block shows "Waiting for others". A synced move highlights every twin row at once.

### 21.6 Pendant and cell view
- **Wide pendant (D4).** On multi-arm tasks the pendant's default width grows to fit the lanes (about 2 × 360 px plus the toolbox), using the existing resizable split with a higher minimum. The cell view keeps at least 360 px.
- **Arm picker.** A segmented control with arm labels and colors appears at the top of Jog and Positions (`src/pendant/ArmPicker.tsx`, store `arm`). Jog, hand guide, gripper, Go home and Teach act on the picked arm. Clicking an arm in the cell view also picks it (`Scene3D.pickArm`). The I/O app has no picker: signals are shared by every arm.
- **Lane status.** A strip at the top of the Program screen shows each arm's state during a run: Moving, Running, Waiting for others, Finished (store `laneStates`, from the scheduler).
- **Teach all arms** on the Positions and Jog screens saves the next free shared name (`T1`, `T2`…, or one you type) as a position in every arm's list at each arm's current pose.
- **Cell view.** Each arm gets a subtle tint ring at its base in its lane color, plus a floating label. The fault card for `ARM_COLLISION` highlights both arms' colliding links in red at the predicted instant (shown as a frozen ghost).
- **Home** shows "2 arms" on the task card. The dock is unchanged.

### 21.7 AI partner (D6)
- **Steps JSON** for multi-arm tasks: `{ "lanes": { "A": [ ...steps ], "B": [ ...steps ] } }`. Lane steps add `{ "sync": "wait" }`, `{ "sync": "move", "target": "lift", "speed"?: n }` (leader) and `{ "sync": "follow" }`. The validator checks that every lane has the same sequence of sync kinds, that exactly one lane leads each synced move, that no syncs sit inside loops, and that targets exist in the right arm's list.
- **Tools.**
  - `read_program`, `dry_run`, `propose_patch` and `preview_proposal` take and return the lanes shape. Ghost preview replays every arm.
  - `read_sim_state` and `read_task` report per-robot state and per-arm targets.
  - `show_blocks` draws lanes side by side with aligned syncs.
  - `make_plan` checks gain `robot` (`target`, `holding`).
- **Prompt `sys-v4`** adds a multi-arm section, appended only on multi-arm tasks so single-arm conditions keep identical wording otherwise. It covers the lanes format, sync semantics, two-handed parts and common faults (`ARM_COLLISION` → add a Wait for each other; `SHARED_GRASP` → use Move together).
- **Docs and clips.** `content/docs/multi-arm.md`, a Two-arm section in `pendant-apps.md`, and new GIFs `sync-wait`, `move-together` and `teach-all-arms` (`scripts/record-clips.ts`).
- **Mock LLM** gets a multi-arm scenario in `tests/fixtures/mock-llm/scenarios.json`.

### 21.8 Study logging
Events that concern an arm gain `robot` (`jog`, `teach`, `target_*`, block edits, `run_*` trace entries, faults). New events: `sync_block_add` / `sync_block_remove` (`syncId`, `kind`, `leader`), `lane_focus` (`robot`), `teach_all`. Block snapshots store the lanes shape. Old single-arm sessions export unchanged.

### 21.9 Tasks (D7), each with a reference solution and Studio-editable scene
All four use two GoFa-class arms side by side, 800 mm apart, both facing +X (`Left arm` = A at y +400, blue; `Right arm` = B at y −400, orange), viewed from behind and above. The scenes are generated from world coordinates (each arm's targets converted to its base frame).
1. **`duo-tutorial` — Two hands** (`duo-bench`). Left carries a block to the middle pad and leaves; Right waits (Wait for each other), moves the block to the right pad; both go to `ready`, then one Move together to `ready.low`. Goals: block on the right pad, no arm collisions, program completes, no faults. Without the syncs the right arm reaches the empty pad too early.
2. **`duo-handover` — Handover** (`duo-handover`). Only Left reaches the infeed, only Right the outfeed. Left holds a 300 mm bar at `give`; Right re-grasps its other end at `take`; Left opens; Right places it. Three Wait for each other. Goals: `handedOver(bar, A, B)`, bar on the outfeed, no arm collisions, program completes. Moving Right before Left lets go is a SHARED_GRASP.
3. **`duo-throughput` — Two at the conveyor** (`duo-conveyor`). Six parts, colors cycling red/blue; each arm loops 3× waiting for its color (`part_color`), picks, drops in its own bin and returns to `ready`. No syncs (they can't go in loops); the colors decide turns. Goals: 3 red in the left bin, 3 blue in the right bin, no arm collisions, program completes.
4. **`duo-assembly` — Assembly** (`duo-assembly`; after Fronchetti et al., original geometry). Spacer (only Left reaches it) on the pedestal, gear (only Right) on the spacer, then the two-handed propeller gripped by both and carried with Move together (`prop.lift`, `prop.over`, `prop.set`). Goals: spacer on the pedestal, `objectOn(gear, spacer)`, `objectOn(propeller, gear)`, propeller flat, no arm collisions, program completes. One arm alone on the propeller is a NEEDS_TWO_HANDS.
- **Study.** `content/experiments/duo-pilot.json` sequences the three coordinated tasks; local test codes accept an experiment suffix (`TEST-SUGGEST-1-DUO-PILOT`).

### 21.10 Acceptance (adds to §20.1, all automated)
- Unit:
  - clock rule determinism (same `RunTrace` for the same seed across 50 runs with random worker delays);
  - arm-vs-arm pre-check catches crossing paths and stationary-arm hits;
  - synced move keeps the grasp offset within 0.5 mm;
  - `SHARED_GRASP`, `NEEDS_TWO_HANDS` and `SYNC_MISMATCH` cases;
  - steps lanes validator;
  - twin insert, move and delete keep alignment (Blockly headless).
- Every `duo-*` reference solution passes headless.
- E2E:
  - build a two-lane program by dragging, check twins and row alignment, Run, and see both lanes highlight and a "Waiting for others" badge;
  - Pause/Step semantics;
  - an agent proposal on `duo-handover` via the mock LLM, with ghost preview of both arms;
  - a study session with a `duo-*` task logs `robot` on events.

### 21.11 Changes from the first draft
- One Blockly workspace with a column per arm instead of separate workspaces (native drag between lanes, one toolbox, shared scroll).
- Moving a sync copy within its lane moves only that copy (D12); leader swap is a context-menu item, not a dropdown.
- Padding shows as a taller block with a dashed "waiting" line, not blank space; no row band.
- Arm bases are planar (x, y, z, yaw); per-arm targets live in `robots[i].targets`, not a keyed `sceneTargets`.
- Handovers are re-grasps; grippers may touch parts another arm holds; a sync reached after any arm finished is a SYNC_MISMATCH.
- No arm picker on the I/O app (signals are shared); Studio edits arms as JSON rather than with base gizmos.
- `duo-throughput` coordinates by color (`cycle` spawns) instead of syncs, because syncs can't go inside loops.
- The AI partner's multi-arm tool parameters (`programs`, `lanes`) and prompt section are added only on multi-arm tasks, so single-arm tool schemas and prompt text are unchanged (`sys-v4`).
