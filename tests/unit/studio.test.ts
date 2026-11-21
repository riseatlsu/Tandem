import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { SCENES, SceneZ, TASKS, DEMO_TASKS } from '../../src/content';
import { validateScene } from '../../src/studio/validate';
import { safe } from '../../scripts/vite/studio-plugin';

describe('Tandem Studio', () => {
  it('every environment passes the editor checks, so it can be opened and saved again', () => {
    for (const s of Object.values(SCENES)) {
      expect(validateScene(s), s.id).toEqual([]);
      expect(SceneZ.safeParse(s).success, s.id).toBe(true);
    }
  });
  it('the save API only writes content files and solutions', () => {
    expect(safe('content/tasks/my-task.json')).toBe(resolve('content/tasks/my-task.json'));
    expect(safe('tests/fixtures/solutions/my-task.js')).toBeTruthy();
    for (const bad of ['../x.json', 'content/tasks/../../package.json', 'src/main.tsx', 'content/tasks/My Task.json', '/etc/passwd', 'content/tasks/a.js', 'public/models/x.glb'])
      expect(safe(bad), bad).toBeNull();
  });
  it('demo listing comes from each task’s demo.order; tasks without it are study-only', () => {
    expect(DEMO_TASKS.length).toBe(Object.values(TASKS).filter((t) => t.demo).length);
    expect(DEMO_TASKS).not.toContain('example-custom-models');
    const orders = DEMO_TASKS.map((id) => TASKS[id].demo!.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
