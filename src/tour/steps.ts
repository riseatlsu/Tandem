/** The guided interface tour. Each step points at an element marked `data-tour="<target>"`. */
import type { AgentFeatures, AgentMode, PendantScreen } from '../store';

export interface TourCtx { mode: 'demo' | 'study'; agentMode: AgentMode; features: AgentFeatures; editor: 'blocks' | 'code'; screen: PendantScreen }
export interface TourStep {
  id: string;
  target?: string;
  place?: 'left' | 'right' | 'top' | 'bottom';
  title: string;
  body: (c: TourCtx) => string;
  clip?: (c: TourCtx) => string | undefined;
  /** Open this pendant screen when the step starts. */
  screen?: PendantScreen;
  /** The step waits for the user to do something (and moves on by itself once they have). */
  waitFor?: (c: TourCtx) => boolean;
  waitHint?: string;
  when?: (c: TourCtx) => boolean;
}

export const TOUR: TourStep[] = [
  {
    id: 'welcome', title: 'Welcome to Tandem',
    body: (c) => `This short tour shows you around the robot cell and the teach pendant. It takes about three minutes.${c.mode === 'study' ? ' It isn’t timed — your first task starts when you finish.' : ''}`,
  },
  { id: 'cell', target: 'viewport', place: 'right', title: 'The robot cell', body: () => 'A live 3D simulation of the cobot and its workspace. Drag to orbit, scroll to zoom, and right-drag to pan.' },
  { id: 'goals', target: 'goals', place: 'bottom', title: 'Your goals', body: () => 'Each task has goals. They turn green as you meet them — click here any time to read the full task.' },
  { id: 'pendant', target: 'pendant', place: 'left', screen: 'home', title: 'The teach pendant', body: () => 'Real cobot programmers use a handheld teach pendant. This one works the same way: one screen at a time, with Home always a tap away.' },
  {
    id: 'open-jog', target: 'tile-jog', place: 'left', screen: 'home', title: 'Open Jog', body: () => 'Jog is how you move the robot by hand. Tap the Jog tile.',
    waitFor: (c) => c.screen === 'jog', waitHint: 'Tap Jog to continue',
  },
  { id: 'stick', target: 'jog-stick', place: 'left', screen: 'jog', title: 'Move with the joystick', clip: () => 'jog-joystick', body: () => 'Drag the joystick to move the arm — the further you push, the faster it goes. The arrows nudge it in small steps. Give it a try.' },
  { id: 'modes', target: 'jog-modes', place: 'left', screen: 'jog', title: 'What the stick moves', body: () => 'Switch between joints 1–3, joints 4–6, straight lines in X/Y/Z, and rotating the tool.' },
  { id: 'teach', target: 'jog-teach', place: 'left', screen: 'jog', title: 'Teach a position', clip: () => 'teach-position', body: () => 'When the gripper is where you want it, press Teach position. The pose is saved as P1, P2… and your program can move to it later.' },
  { id: 'guide', target: 'jog-handguide', place: 'left', screen: 'jog', title: 'Hand guiding', clip: () => 'hand-guide', body: () => 'Turn on Hand guide, then drag the green handle at the gripper in the 3D view to pull the arm into place — like guiding a real cobot by hand.' },
  {
    id: 'open-program', target: 'dock-program', place: 'top', title: 'Open your program', body: () => 'Tap Program to open the program editor.',
    waitFor: (c) => c.screen === 'program', waitHint: 'Tap Program to continue',
  },
  {
    id: 'editor', target: 'pendant-body', place: 'left', screen: 'program', title: 'Build the program',
    clip: (c) => (c.editor === 'blocks' ? 'build-blocks' : 'approach-retreat'),
    body: (c) => c.editor === 'blocks'
      ? 'Drag blocks from the toolbox and snap them together. They run top to bottom: move above a part, move straight down, close the gripper, move back up.'
      : 'Write JavaScript with the robot API. Every robot call is awaited and runs in order: move above a part, move straight down, close the gripper, move back up.',
  },
  { id: 'run', target: 'run-keys', place: 'top', title: 'Run, step, stop', clip: () => 'run-program', body: () => 'These hardware keys run your program. Step runs one command at a time, and the red Stop halts the robot immediately. The running block lights up as it goes.' },
  {
    id: 'ai', target: 'agent-btn', place: 'bottom', title: 'Your AI partner', when: (c) => c.agentMode !== 'off',
    clip: (c) => (c.agentMode === 'suggest' ? 'ai-suggestion' : undefined),
    body: (c) => {
      const base = c.agentMode === 'suggest'
        ? 'Ask your AI partner anything. It can test changes in a hidden copy of the cell and suggest edits — nothing changes until you press Accept.'
        : 'Ask your AI partner anything. It explains and points you in the right direction, but it can’t change your program.';
      const extras = [c.features.visuals && 'show pictures of blocks and example clips', c.features.plans && 'make a checklist that ticks itself off', c.features.preview && c.agentMode === 'suggest' && 'play a ghost robot to preview a suggestion'].filter(Boolean);
      return `${base}${extras.length ? ` It can also ${extras.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : ''} Drag its window anywhere and minimize it when you don’t need it.`;
    },
  },
  { id: 'reset', target: 'vp-controls', place: 'top', title: 'Speed and reset', body: () => 'Change the simulation speed here. Reset puts every part back where it started — your positions and program are kept.' },
  {
    id: 'done', title: 'You’re ready!',
    body: (c) => c.mode === 'study' ? 'That’s the tour. Your first task — and its timer — begins when you press the button below.' : 'Have fun. You can replay this tour any time from Settings on the pendant.',
  },
];
