await robot.home();
await gripper.open();
for (let i = 0; i < 3; i++) {
  const g = offset('tube1.grasp', i * 50, 0, 0);
  const p = offset('rack.slot1', i * 50, 0, 0);
  await robot.moveJ(offset(g, 0, 0, 120));
  await robot.moveL(g);
  await gripper.close();
  await robot.moveL(offset(g, 0, 0, 120));
  await robot.moveJ(offset(p, 0, 0, 120));
  await robot.moveL(p);
  await gripper.open();
  await robot.moveL(offset(p, 0, 0, 120));
}
await robot.home();
