# Programming several arms

## Multi-arm tasks
Some tasks have two arms in one cell, for example a **Left arm** and a **Right arm**. Each arm runs its own program, and all programs start together when you press Run. In blocks mode the Program app shows one column per arm; in code mode it shows one JavaScript editor per arm. The pendant is wider on these tasks so the columns fit side by side.

## Choosing an arm
Jog, Positions, hand guide and Teach act on one arm at a time. Pick it with the arm buttons at the top of the Jog and Positions apps, or click an arm in the 3D view. The readout at the bottom left of the cell view names the arm it shows.

## Positions belong to an arm
Each arm has its own positions, measured from its own base, so a position taught with the Left arm only appears in the Left arm's dropdowns. Two arms can have positions with the same name that are different places. **Teach all arms at once** (Positions app, or Teach all arms on Jog) saves one name for every arm at its current pose, which is handy for Move together.

## Wait for each other
The "Wait for each other" block (`sync()` in code) makes every arm wait until all of them arrive. Use it whenever one arm must finish something before the other starts, for example: the left arm puts a part on a pad and moves away, then the right arm picks it up. Without it both programs run at full speed independently. Copies appear in every arm's column on the same row, so blocks on the same row happen at the same moment.

## Move together
"Move together to [target]" in one arm's column, with "Follow" in the others (`robot.moveTogether(target)` and `robot.follow()` in code), moves all arms at once. The leader goes in a straight line to its target; followers keep their distance and angle to it. Use it to carry a part with two grippers: close both grippers on it, Wait for each other, then Move together.

## Two-handed parts and handovers
A two-handed part (like a wide propeller) is too wide for one gripper. It only lifts when every arm holding it moves together; trying to lift it with one arm stops the program with NEEDS_TWO_HANDS. Opening one gripper while it's lifted drops it.
A handover is a re-grasp: arm A holds the part, arm B closes its gripper on another spot of the same part, then arm A opens. While both grippers hold an ordinary part, neither arm can move it alone (SHARED_GRASP), so add a Wait for each other after A lets go.

## Multi-arm faults
- ARM_COLLISION: two arms (or a part one of them holds) would hit each other. Every move is checked against what the other arms are doing at the same time, so the robots stop before anything moves. Add a Wait for each other so one arm leaves first, or change a position.
- SHARED_GRASP: several arms hold the same part and one tried to move alone. Use Move together, or open one gripper first.
- NEEDS_TWO_HANDS: one arm tried to lift a two-handed part.
- SYNC_MISMATCH: the programs' Together blocks don't pair up, for example one arm finished while another waits, or two arms both lead the same Move together.

## Running and stepping
The Program app shows what each arm is doing: Moving, Waiting for others, or Finished. Each column highlights its own running block, and a block where an arm is waiting glows. Pause freezes every arm. Step runs one command on every arm that has one ready, then pauses again.
