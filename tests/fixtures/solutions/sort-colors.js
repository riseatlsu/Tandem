await robot.home();
await gripper.open();
for (let i = 0; i < 6; i++) {
  await io.waitFor('part_present', true, 60000);
  const color = await io.get('part_color');
  log('part', i + 1, 'is', color);
  await robot.moveJ('pick.approach');
  await robot.moveL('pick');
  await gripper.close();
  await robot.moveL('pick.approach');
  await robot.moveJ(color + '.drop');
  await gripper.open();
}
await robot.home();
