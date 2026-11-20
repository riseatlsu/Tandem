await robot.home();
await gripper.open();
for (let i = 0; i < 3; i++) {
  await io.waitFor('part_present', true, 60000);
  await robot.moveJ('pick.approach');
  await robot.moveL('pick');
  await gripper.close();
  await robot.moveL('pick.approach');
  await robot.moveJ('bin.drop');
  await gripper.open();
}
await robot.home();
