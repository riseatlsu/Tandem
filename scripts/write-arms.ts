// One-off generator for content/arms/*.json (kept for provenance). Usage: npx tsx scripts/write-arms.ts <chains.json>
import { readFileSync, writeFileSync } from 'node:fs';
const chains = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const t6 = chains.t6;
t6[t6.length - 1].joint = { index: 3, type: 'R' }; // add SCARA tool-roll axis (UAIbot model has 3 joints)
const out = (id: string, o: object) => writeFileSync(`content/arms/${id}.json`, JSON.stringify(o, null, 2) + '\n');
const D = Math.PI / 180;
out('gofa-like', {
  id: 'gofa-like', name: 'Aria 5 (GoFa-class cobot)', kind: 'articulated6',
  dh: [
    { theta: 0, d: 0.265, a: 0, alpha: -90 * D },
    { theta: -90 * D, d: 0, a: 0.444, alpha: 0 },
    { theta: 0, d: 0, a: 0.11, alpha: -90 * D },
    { theta: 0, d: 0.47, a: 0, alpha: 90 * D },
    { theta: 0, d: 0, a: 0, alpha: -90 * D },
    { theta: 0, d: 0.101, a: 0, alpha: 0 },
  ],
  jointLimitsDeg: [
    { min: -270, max: 270, maxVel: 125 }, { min: -180, max: 180, maxVel: 125 }, { min: -225, max: 85, maxVel: 140 },
    { min: -180, max: 180, maxVel: 140 }, { min: -180, max: 180, maxVel: 140 }, { min: -270, max: 270, maxVel: 140 },
  ],
  tool: { x: 0, y: 0, z: 140, rx: 0, ry: 0, rz: 0 },
  homeDeg: [0, 0, 0, 0, 90, 0], maxTcpSpeed: 1500,
  linkRadius: [70, 65, 55, 50, 45, 40, 38, 35],
  visual: { source: 'procedural', color: '#f4f6f8', accent: '#8a96a3' },
  gripper: { stroke: 60, graspTolerance: 15, alignTolDeg: 15 },
});
out('ur-like', {
  id: 'ur-like', name: 'Nimbus 5 (UR-class cobot)', kind: 'articulated6',
  dh: [
    { theta: 0, d: 0.1625, a: 0, alpha: 90 * D },
    { theta: 0, d: 0, a: -0.425, alpha: 0 },
    { theta: 0, d: 0, a: -0.3922, alpha: 0 },
    { theta: 0, d: 0.1333, a: 0, alpha: 90 * D },
    { theta: 0, d: 0.0997, a: 0, alpha: -90 * D },
    { theta: 0, d: 0.0996, a: 0, alpha: 0 },
  ],
  jointLimitsDeg: Array.from({ length: 6 }, (_, i) => ({ min: -360, max: 360, maxVel: i < 2 ? 180 : 180 })),
  tool: { x: 0, y: 0, z: 140, rx: 0, ry: 0, rz: 0 },
  homeDeg: [0, -90, 90, -90, -90, 0], maxTcpSpeed: 1000,
  linkRadius: [65, 60, 55, 50, 45, 42, 40, 35],
  visual: { source: 'procedural', color: '#dfe6ee', accent: '#2f7fd8' },
  gripper: { stroke: 60, graspTolerance: 15, alignTolDeg: 15 },
});
out('kuka-kr5', {
  id: 'kuka-kr5', name: 'KUKA KR5 (industrial, UAIbot model)', kind: 'articulated6',
  links: chains.kr5,
  jointLimitsDeg: [
    { min: -170, max: 170, maxVel: 180 }, { min: -190, max: 45, maxVel: 180 }, { min: -120, max: 165, maxVel: 180 },
    { min: -190, max: 190, maxVel: 240 }, { min: -120, max: 120, maxVel: 240 }, { min: -350, max: 350, maxVel: 300 },
  ],
  tool: { x: 0, y: 0, z: 140, rx: 0, ry: 0, rz: 0 },
  homeDeg: [0, 0, 0, 0, 0, 0], maxTcpSpeed: 2000,
  linkRadius: [90, 80, 70, 60, 55, 45, 40, 35],
  visual: { source: 'uaibot', model: 'kuka_kr5' },
  gripper: { stroke: 60, graspTolerance: 15, alignTolDeg: 15 },
});
out('epson-t6', {
  id: 'epson-t6', name: 'Epson T6 (SCARA, UAIbot model)', kind: 'scara4',
  links: t6,
  jointLimitsDeg: [
    { min: -132, max: 132, maxVel: 300 }, { min: -150, max: 150, maxVel: 300 }, { min: -200, max: 0, maxVel: 1000 }, { min: -360, max: 360, maxVel: 600 },
  ],
  tool: { x: 0, y: 0, z: 80, rx: 0, ry: 0, rz: 0 },
  homeDeg: [0, 0, -50, 0], maxTcpSpeed: 2000,
  linkRadius: [80, 60, 50, 30, 25, 20],
  visual: { source: 'uaibot', model: 'epson_t6' },
  gripper: { stroke: 50, graspTolerance: 15, alignTolDeg: 15 },
  ikRows: [0, 1, 2, 5],
});
