import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { ARMS } from '../../src/content';
import { fk } from '../../src/sim/kinematics/fk';
import { solveIK } from '../../src/sim/kinematics/ik';
import { mul, pos, rotAngle, norm, sub, rotZ } from '../../src/sim/math/mat4';
import { nextRandom } from '../../src/sim/rng';

/** Re-implementation of UAIbotJS Robot(createLinks + config) using three.js, for parity checks. */
function uaibotFlange(linkInfo: number[][], q: number[]) {
  const links: Object3D[] = [];
  const n = linkInfo[0].length;
  for (let i = 0; i <= n; i++) {
    const l = new Object3D();
    if (i !== 0) { l.rotateZ(linkInfo[0][i - 1]); l.translateZ(linkInfo[1][i - 1]); l.rotateX(linkInfo[2][i - 1]); l.translateX(linkInfo[3][i - 1]); }
    links.push(l);
  }
  for (let i = 0; i < n; i++) links[i].add(links[i + 1]);
  for (let i = 0; i < linkInfo[4].length; i++) {
    if (linkInfo[4][i] === 0) links[i].rotation.z = q[i];
    else if (linkInfo[4][i] === 1) links[i].position.z = q[i];
  }
  links[0].updateMatrixWorld(true);
  return links[n].matrixWorld.elements.slice();
}
const KR5 = [[1.57, -1.57, 0, 0, 0, 0], [0.335, 0, 0, -0.405, 0, -0.08], [-1.57, 0, 1.57, -1.57, 1.57, 3.14], [0.075, 0.365, 0.09, 0, 0, 0], [0, 0, 0, 0, 0, 0, 2]];
const T6 = [[0, 0, 0], [0.2, 0, 0], [0, 3.14, 0], [1.3 / 4, 1.1 / 4, 0], [0, 0, 1, 2]];

function randQ(seed: number, arm: (typeof ARMS)[string]) {
  let s = seed;
  return arm.limits.map((l) => { const [r, ns] = nextRandom(s); s = ns; const lo = Math.max(l.min, -Math.PI), hi = Math.min(l.max, Math.PI); return lo + r * (hi - lo); });
}

describe('forward kinematics parity with UAIbotJS', () => {
  it('KR5 matches UAIbot Object3D chain (100 configs)', () => {
    const arm = ARMS['kuka-kr5'];
    for (let k = 0; k < 100; k++) {
      const q = randQ(k + 1, arm);
      // our model adds a -90° mount yaw at the base
      const ours = fk(arm, q).flange;
      const ref = mul(rotZ(-Math.PI / 2), uaibotFlange(KR5, q));
      for (let i = 0; i < 16; i++) expect(ours[i]).toBeCloseTo(ref[i], 6);
    }
  });
  it('T6 matches UAIbot for the first three joints', () => {
    const arm = ARMS['epson-t6'];
    for (let k = 0; k < 100; k++) {
      const q = randQ(k + 7, arm); q[3] = 0;
      const ours = fk(arm, q).flange;
      const ref = uaibotFlange(T6, q.slice(0, 3));
      for (let i = 0; i < 16; i++) expect(ours[i]).toBeCloseTo(ref[i], 6);
    }
  });
});

describe('inverse kinematics round-trip', () => {
  for (const id of ['gofa-like', 'ur-like', 'kuka-kr5', 'epson-t6']) {
    it(`${id}: fk(ik(fk(q))) ≈ fk(q) for 200 random configs`, () => {
      const arm = ARMS[id];
      let ok = 0, tried = 0;
      for (let k = 0; k < 200; k++) {
        const q = randQ(1000 + k, arm);
        const T = fk(arm, q).tcp;
        // seed near the solution (as during jogging / path following)
        const seed = q.map((v, i) => v + (((k * 7 + i * 3) % 11) - 5) * 0.02);
        tried++;
        const r = solveIK(arm, T, seed);
        if (!r.ok) continue;
        const T2 = fk(arm, r.q).tcp;
        expect(norm(sub(pos(T2), pos(T)))).toBeLessThan(1e-4);
        if (!arm.ikRows) expect(rotAngle(T2, T)).toBeLessThan(0.05 * Math.PI / 180 + 1e-9);
        ok++;
      }
      expect(ok / tried).toBeGreaterThan(0.97);
    });
  }
});
