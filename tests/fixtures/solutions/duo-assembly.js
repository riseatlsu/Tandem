// Assembly: spacer (left arm), gear (right arm), then the two-handed propeller with Move together.
// @lane A
await gripper.open();
await robot.moveJ('spacer.above');
await robot.moveL('spacer');
await gripper.close();
await robot.moveL('spacer.above');
await robot.moveJ('stack.above');
await robot.moveL('spacer.set');
await gripper.open();
await robot.moveL('stack.above');
await robot.moveJ('ready');
await sync(); // 1: spacer is on, the pedestal is free
await sync(); // 2: gear is on
await robot.moveJ('prop.above');
await robot.moveL('prop');
await gripper.close();
await sync(); // 3: both grippers are on the propeller
await robot.moveTogether('prop.lift');
await robot.moveTogether('prop.over');
await robot.moveTogether('prop.set');
await gripper.open();
await sync(); // 4: propeller is down
await robot.moveL('prop.over');
await robot.moveJ('ready');
// @lane B
await gripper.open();
await robot.moveJ('gear.above');
await robot.moveL('gear');
await gripper.close();
await robot.moveL('gear.above');
await sync(); // 1
await robot.moveJ('stack.above');
await robot.moveL('gear.set');
await gripper.open();
await robot.moveL('stack.above');
await robot.moveJ('ready');
await sync(); // 2
await robot.moveJ('prop.above');
await robot.moveL('prop');
await gripper.close();
await sync(); // 3
await robot.follow();
await robot.follow();
await robot.follow();
await gripper.open();
await sync(); // 4
await robot.moveJ('ready');
