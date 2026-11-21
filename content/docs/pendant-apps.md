# Teach pendant apps

The teach pendant is the tablet on the right. It shows one app at a time. Open apps from the Home screen's grid. The dock at the bottom (Home, Program, Jog, Positions) switches between the four most-used apps, and "Home" at the top left returns from any other app. Under the screen are the hardware run keys: Run, Pause/Resume, Step, and the red STOP button. The status light at the top right shows Ready, Running, Paused or Protective stop.

## Home app
The Home screen shows the current task card (goals met, e.g. 2/4) and a grid of apps: Program, Jog, Positions, I/O, Log and Settings. Tap the task card to open the Task screen with the brief, the goal checklist (each goal ticks green when it passes) and optional hints. A red dot on the Log tile means a fault was logged.

## Program app
Where you build the program. In blocks mode, drag blocks from the toolbox and snap them under "When Run is pressed"; they run top to bottom. The Blocks / JavaScript switch at the top shows the read-only JavaScript generated from your blocks. In code mode (Settings > Programming style) this app is a JavaScript editor. Your program is kept when you switch to other apps. While a program runs, the block that is executing lights up.

## Jog app
Moves the robot by hand. Pick a mode: "Axes 1–3" and "Axes 4–6" turn individual joints; "Linear" moves the tool in X/Y/Z; "Reorient" rotates the tool (Rx/Ry/Rz) in place. In Linear and Reorient you can move in the Base frame (the cell's axes) or the Tool frame (the gripper's own axes). Drag the round joystick for smooth motion (further = faster); the vertical rocker beside it drives the third axis (e.g. Z or J3). Tap an arrow to step by the chosen "Arrow step" (0.1, 1 or 10 mm or degrees). The readouts show live joint angles or tool position, with a bar showing how close each joint is to its limit. Buttons: Hand guide (drag the green handle at the tool in the 3D view; Move or Rotate), Open/Close gripper, Go home, and Teach position (saves the current pose as P1, P2, …). Jogging is disabled while a program runs.

## Positions app
Lists taught positions. "Teach new position here" saves the current tool pose. "Your positions" are the ones you taught: Go to moves the arm there, the target icon re-teaches it at the current pose, the pencil renames it, and the bin deletes it. "Cell positions" (such as pick, place, bin.drop) come with the scene and are read-only, but you can still Go to them. Each row shows the X, Y, Z position in mm. Programs refer to positions by name.

## I/O app (inputs and outputs)
The I/O app is a live, read-only monitor of the cell's digital signals. It updates several times a second, also while a program runs. Each row has an LED and an ON/OFF chip.
- Inputs · sensors: signals the cell sends to the robot. Example: part_present turns ON when a part reaches the end of the conveyor (a light-gate sensor) and OFF when the part is picked away.
- Outputs: signals the robot sends to the cell. Example: conveyor_run, when ON, keeps the conveyor belt moving and new parts arriving; when OFF, the belt stops. Some cells also have a general-purpose output such as light that your program can switch to signal its state.
You cannot click a signal to toggle it. Signals change only from the cell (sensors) or from your program: the "Wait until <input> is <value>" block / io.waitFor(name, value) pauses the program until an input has that value, the "Set <output> to <value>" block / io.set(name, value) switches an output, and io.get(name) reads a signal. Use the I/O app to check what your program will see, e.g. watch part_present go ON before the robot reaches for a part. Cells without a conveyor or sensors (such as the kitchen) have no signals, and the app says so.

## Log app
Program messages and faults, each stamped with simulated time in seconds. Write your own messages with log(...) or the "Show message" block. Faults (protective stops) appear in red with the reason, e.g. UNREACHABLE or COLLISION.

## Settings app
Toggles: Show positions in the cell (draws a small frame at every position), Sound effects, Background music (demo only) and Volume. In the demo you can also choose a different robot arm for the task and switch Programming style between Blocks and Code. "Take the tour" replays the guided tour.

## Run keys and the 3D view
Run (or Ctrl/Cmd+Enter) starts the program. Pause halts it after the current command; Step then runs one robot command at a time; Resume continues. STOP (or Esc) ends the run. If a move fails a check, the robot stops before moving and the status shows Protective stop. In the 3D cell view: drag to orbit, scroll to zoom, use "Sim speed" to run the simulation faster or slower, "Reset" to put every part back where it started (after a fault the card also offers "Reset scene"), and the camera button to reset the view.

## Two-arm tasks on the pendant
On tasks with several arms the pendant is wider. The Program app shows a column per arm and a status line (Moving, Waiting for others, Finished). Jog and Positions have arm buttons at the top to pick the arm you jog and teach, and the Positions app adds Teach all arms at once. The I/O app is shared: every arm's program sees the same signals. Settings hides the Robot arm choice, because the cell decides the arms.

## AI partner window
The AI partner button in the pendant's status bar opens a floating chat window you can drag anywhere. In the demo you can pick the model at the top of the window. Depending on the mode it can answer questions, show pictures of blocks or short example clips, make a step-by-step plan, and propose program changes that you preview and then Accept or Reject. It never changes your program without your click.
