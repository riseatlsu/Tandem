# Block reference

Programs start at the "When Run is pressed" block. Blocks that aren't attached below it are greyed out and ignored.

## Motion
- Go home (speed %): joint move to the home configuration.
- Move to [target] [joint move | straight line] speed %: a joint move is fastest; a straight line keeps the tool on a line, for approach and retreat. The target dropdown lists taught and cell targets, and "＋ Teach current pose…" teaches a new target directly from the dropdown.
- Move to [target] shifted by X Y Z mm: moves to a target offset in the base frame, for approach heights and grids. X, Y and Z accept numbers, variables and arithmetic blocks.

## Gripper
- Open gripper / Close gripper: a part between the fingers is picked up on close.
- If the gripper is holding a part … otherwise …

## Signals
- Wait until [input] is [value] (timeout s, 0 = forever): e.g. wait until part_present is true.
- If [input] is [value] … otherwise …: e.g. if part_color is red.
- Set [output] to [value]: e.g. set conveyor_run to false.
- sensor [input]: the current value, for use in comparisons.

## Flow
- Repeat N times; count with i from A to B (variable i); repeat while; if.
- Wait N seconds; Show message (prints to the Console); note (a comment, does nothing).

## Together (multi-arm tasks)
Each arm has its own column, with its own "When Run is pressed" block. All arms start together.
- Wait for each other: every arm waits here until all arms reach it. Dropping it in one arm's column adds a copy to every column, on the same row; moving or deleting one copy does the same to all of them. A tall copy shows time that arm spends waiting.
- Move together to [target] speed %: this arm leads a straight-line move; every other column gets a "Follow [arm]" copy, and those arms keep their distance, so a part they all hold moves with them. Drag a Follow copy to make that arm the leader.
- Together blocks go directly in an arm's column, never inside a loop or if (the editor refuses the drop), because every arm must reach them the same number of times.

## Data and variables
Number, arithmetic, text and true/false blocks, plus variables (create in the Variables category).
