// Two at the conveyor: colors decide whose turn it is; each arm returns to ready after every drop.
// @lane A
await gripper.open();
await robot.moveJ('ready');
for (let i = 0; i < 3; i++) {
  await io.waitFor('part_color', 'red', 60000);
  await robot.moveJ('pick.above');
  await robot.moveL('pick');
  await gripper.close();
  await robot.moveL('pick.above');
  await robot.moveJ('bin.drop');
  await gripper.open();
  await robot.moveJ('ready');
}
// @lane B
await gripper.open();
await robot.moveJ('ready');
for (let i = 0; i < 3; i++) {
  await io.waitFor('part_color', 'blue', 60000);
  await robot.moveJ('pick.above');
  await robot.moveL('pick');
  await gripper.close();
  await robot.moveL('pick.above');
  await robot.moveJ('bin.drop');
  await gripper.open();
  await robot.moveJ('ready');
}
