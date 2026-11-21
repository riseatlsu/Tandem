// Handover: left arm picks from the infeed, right arm re-grasps mid-air and places on the outfeed.
// @lane A
await gripper.open();
await robot.moveJ('tray.above');
await robot.moveL('tray');
await gripper.close();
await robot.moveL('tray.above');
await robot.moveJ('give.above');
await robot.moveL('give');
await sync(); // 1: the bar is at the hand-off point
await sync(); // 2: the right arm has closed on it
await gripper.open();
await sync(); // 3: let go — the right arm may move
await robot.moveL('give.above');
await robot.moveJ('ready');
// @lane B
await gripper.open();
await robot.moveJ('ready');
await sync(); // 1
await robot.moveJ('take.above');
await robot.moveL('take');
await gripper.close();
await sync(); // 2
await sync(); // 3
await robot.moveL('take.above');
await robot.moveJ('rack.above');
await robot.moveL('rack');
await gripper.open();
await robot.moveL('rack.above');
await robot.moveJ('ready');
