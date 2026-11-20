await robot.home();
await gripper.open();
const pitch = 70;
for (let layer = 0; layer < 2; layer++) {
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      await io.waitFor('part_present', true, 60000);
      await robot.moveJ('pick.approach');
      await robot.moveL('pick');
      await gripper.close();
      await robot.moveL('pick.approach');
      const slot = offset('pallet.corner', col * pitch, row * pitch, layer * 50);
      await robot.moveJ(offset(slot, 0, 0, 150));
      await robot.moveL(slot);
      await gripper.open();
      await robot.moveL(offset(slot, 0, 0, 150));
    }
  }
}
await robot.home();
