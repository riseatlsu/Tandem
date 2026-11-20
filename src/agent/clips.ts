/**
 * Curated library of short looping GIFs recorded from Tandem itself (scripts/record-clips.ts).
 * The AI partner can show one with `show_example`; the tour and the landing page reuse them.
 * Every participant sees the same files, so visual explanations stay identical across sessions.
 */
export interface Clip { id: string; title: string; about: string }

export const CLIPS: Clip[] = [
  { id: 'jog-joystick', title: 'Jogging with the joystick', about: 'Pendant Jog screen: dragging the joystick moves the arm; further = faster. Shows the axis modes.' },
  { id: 'teach-position', title: 'Teaching a position', about: 'Jog the gripper above a part, press "Teach position", and the pose appears in the Positions list as P1.' },
  { id: 'hand-guide', title: 'Hand guiding', about: 'Turn on Hand guide and drag the green handle at the gripper in the 3D view to pull the arm into place.' },
  { id: 'build-blocks', title: 'Building a block program', about: 'Blocks snap together top to bottom: Home, Move above, Move down (linear), Close gripper, Move up.' },
  { id: 'approach-retreat', title: 'Approach and retreat', about: 'Joint move to a point above the part, straight-line move down, grip, straight-line move back up.' },
  { id: 'run-program', title: 'Running a program', about: 'Press Run on the pendant; the running block lights up and the goals tick off when they pass.' },
  { id: 'conveyor-wait', title: 'Waiting for the conveyor', about: 'Wait for input part_present before picking, so the robot only reaches once a part has arrived.' },
  { id: 'loop-repeat', title: 'Repeating with a loop', about: 'A Repeat / For-each block runs the same pick-and-place several times, shifting the drop point each time.' },
  { id: 'fault-recover', title: 'Faults and recovery', about: 'A target out of reach stops the program before the robot moves. The fault card names the block; fix it and press Reset.' },
  { id: 'ai-suggestion', title: 'Accepting an AI suggestion', about: 'The AI partner tests a change in a hidden copy of the cell, then shows a card: Preview, Show me, Accept or Reject.' },
];

export const CLIP_IDS = CLIPS.map((c) => c.id) as [string, ...string[]];
export const clipUrl = (id: string) => `${import.meta.env.BASE_URL}clips/${id}.gif`;
export const clipById = (id: string) => CLIPS.find((c) => c.id === id);
