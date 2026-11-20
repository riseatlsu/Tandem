# Cobot programming concepts

## Teaching targets
Jog the arm, or switch on Hand guide and drag the handle at the tool, then press Teach. That saves the current tool pose and joint configuration as a named target (P1, P2, …; double-click to rename). Cell targets such as `pick` or `bin.drop` are predefined by the scene and are read-only. Programs refer to targets by name.

## Joint move vs linear move
A joint move (moveJ, "joint move" in blocks) is fast and robust but follows a curved path. A linear move (moveL, "straight line") keeps the tool on a straight line, which is needed for approach and retreat near parts and fixtures. The usual pattern is: moveJ to an approach point above the part, moveL down, close the gripper, moveL back up.

## Faults (protective stops)
Every move is checked before the robot moves. If a check fails, the robot does not move, the program stops, and the faulting line or block is highlighted.
- UNREACHABLE: the target, or part of the line, is outside the workspace. Move the target closer, raise it, or use a different orientation.
- JOINT_LIMIT: a joint would exceed its limit. Re-teach the target with a different arm configuration.
- SINGULARITY: a linear move passes through a singular configuration (e.g. wrist axes aligned), so a joint would flip. Use moveJ, or move through an intermediate point.
- COLLISION: the arm, gripper or held part would hit a fixture (table, conveyor, bin walls). Add an approach point higher up.
- INVALID_ARG: unknown target or signal name, or a bad value.
- TIMEOUT: an io.waitFor timed out.
- RUNAWAY: the program looped for 3 s of real time without commanding the robot. Add a wait or a motion inside the loop.
- USER_ERROR: a JavaScript error, such as a typo or an undefined variable.

## Simulated time
Simulated time only advances while a robot command executes (moves, waits, gripper actions). The conveyor and sensors run on simulated time. The speed slider changes how fast the simulation plays, never the outcome.

## Conveyors and sensors
Parts spawn at the start of the belt while `conveyor_run` is true and stop at the end sensor, where `part_present` becomes true. Always wait for `part_present` before picking. Parts arrive one by one; after you pick one, the next moves up to the sensor.

## Grasping
Approach from straight above (tool pointing down, `rx: 180`), lower with a linear move so the TCP is around the middle of the part, then close. Picked parts follow the gripper exactly. On release, a part drops straight down onto the highest surface below it. Parts can be stacked; a part tilted more than 30° when released topples over.

## Pouring (kitchen cell)
Containers have a fill level. Tilting a held container more than 90° from upright pours. Flow grows with tilt, reaching full rate at 120°. Liquid lands in a container if the lip is within 40 mm (horizontally) above it; otherwise it spills. With the tool pointing down (`rx: 180`), setting `rx: -70` tilts the container by 110° toward −y. Return containers upright.

## Palletizing patterns
Use nested loops with offset(): `for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) { ... offset('pallet.corner', col * pitch, row * pitch, layer * height) ... }`. Approach every slot from above with an offset in z.
