await robot.home();
await robot.moveJ('place.approach');
await robot.moveJ('bin.drop');
await robot.home();
