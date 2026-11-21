// Two hands: the left arm brings the block to the middle pad, the right arm takes it on.
// @lane A
await robot.moveJ('block.above');
await gripper.open();
await robot.moveL('block');
await gripper.close();
await robot.moveL('block.above');
await robot.moveJ('middle.above');
await robot.moveL('middle');
await gripper.open();
await robot.moveL('middle.above');
await robot.moveJ('ready');
await sync(); // the middle pad is free
await sync(); // the right arm is done and at ready
await robot.moveTogether('ready.low');
// @lane B
await gripper.open();
await sync(); // wait until the left arm has left the pad
await robot.moveJ('middle.above');
await robot.moveL('middle');
await gripper.close();
await robot.moveL('middle.above');
await robot.moveJ('right.above');
await robot.moveL('right');
await gripper.open();
await robot.moveL('right.above');
await robot.moveJ('ready');
await sync();
await robot.follow();
