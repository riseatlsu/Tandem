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
  { id: 'pendant-apps', title: 'Getting around the pendant', about: 'The Home screen has an app grid (Program, Jog, Positions, I/O, Log, Settings); tap a tile to open it, "Home" at the top left goes back, and the dock switches between the main apps.' },
  { id: 'io-signals', title: 'The I/O app', about: 'Open I/O from Home and run a conveyor pick: the part_present input LED turns ON when a part reaches the sensor, the program switches the conveyor_run output OFF while it picks, then ON again. Signals are read-only on this screen; programs change outputs.' },
  { id: 'positions-goto', title: 'Using the Positions app', about: 'The Positions app lists your taught positions and the cell\'s read-only ones; press Go to and the arm moves there, then teach a new position.' },
  { id: 'sync-wait', title: 'Wait for each other', about: 'Multi-arm: each arm has a column of blocks; a "Wait for each other" copy sits on the same row in every column. During the run the right arm waits (its block glows, status says Waiting for others) until the left arm has put the block down and left.' },
  { id: 'move-together', title: 'Moving together', about: 'Multi-arm: both arms close their grippers on the wide propeller, wait for each other, then "Move together" (left arm leads, right arm follows) lifts and carries it as one.' },
  { id: 'teach-all-arms', title: 'Teaching positions for two arms', about: 'Multi-arm: pick the arm at the top of Jog/Positions, jog it, and "Teach all arms at once" saves one position name for every arm at its current pose.' },
  { id: 'ai-suggestion', title: 'Accepting an AI suggestion', about: 'The AI partner tests a change in a hidden copy of the cell, then shows a card: Preview, Show me, Accept or Reject.' },
];

export const CLIP_IDS = CLIPS.map((c) => c.id) as [string, ...string[]];
export const clipUrl = (id: string) => `${import.meta.env.BASE_URL}clips/${id}.gif`;
export const clipById = (id: string) => CLIPS.find((c) => c.id === id);
