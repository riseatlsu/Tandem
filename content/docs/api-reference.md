# Robot API reference

Programs are the body of an async function: they run top to bottom, and every robot call must be awaited (`await robot.moveJ('P1')`). Units are millimeters and degrees. Poses are `{x, y, z, rx, ry, rz}` in the robot base frame, with orientation R = Rx(rx)·Ry(ry)·Rz(rz). A tool pointing straight down is `rx: 180, ry: 0`.

## robot.moveJ(target, opts?)
Joint move. Every joint moves at once along the fastest path, so the tool does not follow a straight line. `target` is a target name (string) or a pose. For a taught target, the stored joint configuration is reused exactly. Use it for large moves between approach points. `opts.speed` is 1–100 percent (default 50).

## robot.moveL(target, opts?)
Linear move. The tool travels in a straight line with its orientation interpolated. Use it for the last few centimeters of approach and retreat (pick, place, insert). It can fault with SINGULARITY when the path passes near a singular configuration, or with UNREACHABLE when part of the line leaves the workspace.

## robot.moveJoints(jointsDeg, opts?)
Move to explicit joint angles, in degrees (millimeters for a prismatic joint). The array length must equal the number of joints.

## robot.home(opts?)
Joint move to the arm's home configuration.

## robot.getPose() / robot.getJoints()
Return the current tool pose, or the joint angles in degrees.

## robot.wait(ms)
Wait in simulated time.

## gripper.open() / gripper.close() / gripper.holding()
Closing takes 0.4 s. A part is picked up only if the tool center point (TCP, between the fingertips) is within about 15 mm of the part's vertical axis, sits between the bottom 10% and the top of the part, and the gripper is aligned with the part's up axis (pointing down onto it, within 15°). The part must also be narrower than the gripper stroke (60 mm). `holding()` returns the part id or null. Opening releases the part, which drops straight down onto whatever is below it.

## io.get(name) / io.set(name, value) / io.waitFor(name, value, timeoutMs?)
Digital and text signals. Inputs come from sensors, e.g. `part_present` (true when a part waits at the end of the conveyor) and `part_color` ('red' | 'green' | 'blue' | 'none'). Outputs drive equipment, e.g. `conveyor_run`. `waitFor` blocks until the input equals the value. If `timeoutMs` is given and runs out, it faults with TIMEOUT.

## targets.get(name) / targets.list()
Read target poses (a copy), or list every target name, taught and cell-defined.

## offset(target, dx, dy, dz)
Returns a pose shifted in the base frame by dx, dy, dz millimeters. Use it for approach points (`offset('pick', 0, 0, 120)`) and grids (`offset('pallet.corner', col * 70, row * 70, layer * 50)`). It is synchronous, so don't await it.

## log(...values)
Print to the Console tab.

## sync()
Multi-arm tasks only. "Wait for each other": the arm stops here until every arm's program has reached its matching `sync()`. The 1st `sync()` in each program pairs with the 1st in every other program, the 2nd with the 2nd, and so on, so every program needs the same number of them, in the same order. Don't put `sync()` inside a loop or an if unless every arm runs it exactly as often. If an arm finishes while another is waiting, or the programs don't match, the run stops with SYNC_MISMATCH.

## robot.moveTogether(target, opts?) / robot.follow()
Multi-arm tasks only. "Move together": one arm calls `robot.moveTogether(target)` and every other arm calls `robot.follow()` at the same point (it pairs up like `sync()`). The leading arm moves in a straight line to its own `target`; each following arm keeps exactly the distance and angle it had to the leader, so a part held by several arms is carried rigidly. Use it to lift and place a two-handed part. All arms start and stop together. Faults on any arm stop all of them.
