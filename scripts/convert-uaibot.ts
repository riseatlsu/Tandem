/**
 * Converts UAIbotJS robot definitions (DH "linkInfo" + Object3D semantics) into
 * Cobalt's link-chain format: each link local transform = pre · J(q) · post.
 *
 * UAIbot builds link i with rotateZ(θ) translateZ(d) rotateX(α) translateX(a) and then,
 * in config(), *overwrites* euler.z (revolute) or position.z (prismatic) with q.
 * We reproduce that exactly so UAIbot's mesh offsets line up.
 * Usage: npx tsx scripts/convert-uaibot.ts
 */
import { Object3D, Matrix4, Euler, Quaternion, Vector3 } from 'three';

type LinkInfo = number[][];
const KR5: LinkInfo = [
  [1.57, -1.57, 0.0, 0.0, 0.0, 0.0],
  [0.335, 0.0, 0.0, -0.405, 0.0, -0.08],
  [-1.57, 0.0, 1.57, -1.57, 1.57, 3.14],
  [0.075, 0.365, 0.09, 0.0, 0.0, 0.0],
  [0, 0, 0, 0, 0, 0, 2],
];
const T6: LinkInfo = [
  [0, 0, 0],
  [0.2, 0, 0],
  [0, 3.14, 0],
  [1.3 / 4, 1.1 / 4, 0],
  [0, 0, 1, 2],
];

const arr = (m: Matrix4) => m.elements.map((v) => +v.toFixed(9)); // column-major
function convert(li: LinkInfo) {
  const n = li[0].length;
  const links: { name: string; pre: number[]; joint: null | { index: number; type: 'R' | 'P' }; post: number[] }[] = [];
  const I = arr(new Matrix4());
  links.push({ name: 'base', pre: I, joint: null, post: I });
  let jointIdx = 0;
  for (let i = 0; i <= n; i++) {
    const o = new Object3D();
    if (i !== 0) {
      o.rotateZ(li[0][i - 1]);
      o.translateZ(li[1][i - 1]);
      o.rotateX(li[2][i - 1]);
      o.translateX(li[3][i - 1]);
    }
    const kind = li[4][i];
    const e = new Euler().copy(o.rotation); // XYZ
    if (kind === 0) {
      // local = T(p) · Rx(ex)·Ry(ey) · Rz(q)
      const pre = new Matrix4().compose(o.position, new Quaternion().setFromEuler(new Euler(e.x, e.y, 0, 'XYZ')), new Vector3(1, 1, 1));
      links.push({ name: `link${i}`, pre: arr(pre), joint: { index: jointIdx++, type: 'R' }, post: I });
    } else if (kind === 1) {
      // local = T(px,py,0) · Tz(q) · R(full)
      const pre = new Matrix4().makeTranslation(o.position.x, o.position.y, 0);
      const post = new Matrix4().makeRotationFromEuler(e);
      links.push({ name: `link${i}`, pre: arr(pre), joint: { index: jointIdx++, type: 'P' }, post: arr(post) });
    } else {
      o.updateMatrix();
      links.push({ name: `link${i}`, pre: arr(o.matrix), joint: null, post: I });
    }
  }
  return links;
}
console.log(JSON.stringify({ kr5: convert(KR5), t6: convert(T6) }));
