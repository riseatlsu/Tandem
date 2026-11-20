import { DEG, I4, fromEulerXYZ, mul, rotX, rotZ, trans, withPos, type M4 } from '../math/mat4';
import type { ArmDef, ArmJson, ArmLink, Pose } from '../types';

export function poseToM4(p: Pose): M4 {
  return withPos(fromEulerXYZ(p.rx * DEG, p.ry * DEG, p.rz * DEG), [p.x / 1000, p.y / 1000, p.z / 1000]);
}

/** Standard DH row → link (local = Rz(θ)·[Rz(q)]·Tz(d)·Tx(a)·Rx(α)). */
function dhToLinks(dh: NonNullable<ArmJson['dh']>): ArmLink[] {
  const links: ArmLink[] = [{ name: 'base', pre: I4(), joint: null, post: I4() }];
  dh.forEach((r, i) => {
    const type = r.type ?? 'R';
    links.push({
      name: `link${i + 1}`,
      pre: type === 'R' ? rotZ(r.theta) : mul(rotZ(r.theta), trans(0, 0, r.d)),
      joint: { index: i, type },
      post: type === 'R' ? mul(mul(trans(0, 0, r.d), trans(r.a, 0, 0)), rotX(r.alpha)) : mul(trans(r.a, 0, 0), rotX(r.alpha)),
    });
  });
  return links;
}

export function buildArm(j: ArmJson): ArmDef {
  const links = j.links ?? dhToLinks(j.dh!);
  const dof = links.filter((l) => l.joint).length;
  const types = links.filter((l) => l.joint).map((l) => l.joint!.type);
  const limits = j.jointLimitsDeg.map((l, i) =>
    types[i] === 'P' ? { min: l.min / 1000, max: l.max / 1000, maxVel: l.maxVel / 1000 } : { min: l.min * DEG, max: l.max * DEG, maxVel: l.maxVel * DEG },
  );
  const home = j.homeDeg.map((v, i) => (types[i] === 'P' ? v / 1000 : v * DEG));
  const { dh: _dh, links: _l, ...rest } = j;
  return { ...rest, links, dof, limits, home, toolM: poseToM4(j.tool) };
}
