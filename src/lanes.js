// Lanes: the only lines the camera moves along. Each floor has a loop around the atrium:
// one lane down the middle of each long walkway (north and south) and one across each end.
// On the ground floor, which has no atrium hole, you can also hop straight across between
// the north and south lanes at any point. Every move is forward/back along a lane or a
// sideways hop, never a free diagonal.
//
// The loop is measured by `s`, the distance along it, starting at the north-west corner
// and running north lane (west to east), east lane, south lane (east to west), west lane.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COLUMNS, ESCALATORS, FLOORS, MALL } from "./mall.js";

export const LANE_X = (MALL.halfX + MALL.voidHalfX) / 2; // end lanes, between atrium and end wall
export const LANE_Z = (MALL.halfZ + MALL.voidHalfZ) / 2; // long lanes, middle of each walkway

const LONG = 2 * LANE_X;
const SHORT = 2 * LANE_Z;
const LOOP = 2 * LONG + 2 * SHORT;
const CORNERS = [0, LONG, LONG + SHORT, 2 * LONG + SHORT]; // s of the NW, NE, SE, SW corners
const COLUMN_CLEARANCE = 0.9; // a hop passes at least this far from a column centre
const ESCALATOR_CLEARANCE = 1.0; // ... and this far from the ends of an escalator pair

// Ground-floor x ranges taken up by the escalator pairs, which a hop goes around.
const ESCALATOR_SPANS = [...new Set(ESCALATORS.map((e) => e.side))].map((side) => {
  const e = ESCALATORS.find((esc) => esc.side === side);
  return { min: Math.min(e.topX, e.bottomX) - ESCALATOR_CLEARANCE, max: Math.max(e.topX, e.bottomX) + ESCALATOR_CLEARANCE };
});

const wrap = (s) => ((s % LOOP) + LOOP) % LOOP;

/** Point on the loop at distance s. */
function pointAt(s) {
  s = wrap(s);
  if (s < LONG) return { x: -LANE_X + s, z: LANE_Z };
  s -= LONG;
  if (s < SHORT) return { x: LANE_X, z: LANE_Z - s };
  s -= SHORT;
  if (s < LONG) return { x: LANE_X - s, z: -LANE_Z };
  s -= LONG;
  return { x: -LANE_X, z: -LANE_Z + s };
}

/** Nearest point on the loop to (x, z), with its s and which lane it is on. */
export function snapToLane(x, z) {
  const cx = THREE.MathUtils.clamp(x, -LANE_X, LANE_X);
  const cz = THREE.MathUtils.clamp(z, -LANE_Z, LANE_Z);
  const options = [
    { lane: "n", x: cx, z: LANE_Z, s: cx + LANE_X },
    { lane: "e", x: LANE_X, z: cz, s: LONG + (LANE_Z - cz) },
    { lane: "s", x: cx, z: -LANE_Z, s: LONG + SHORT + (LANE_X - cx) },
    { lane: "w", x: -LANE_X, z: cz, s: 2 * LONG + SHORT + (cz + LANE_Z) },
  ];
  let best = options[0];
  let bestD = Infinity;
  for (const o of options) {
    const d = (o.x - x) ** 2 + (o.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  best.s = wrap(best.s);
  return best;
}

/** Points along the loop from a to b (s values), going in `dir` (+1 or -1). */
function loopPath(sa, sb, dir) {
  const length = dir > 0 ? wrap(sb - sa) : wrap(sa - sb);
  const points = [pointAt(sa)];
  for (const c of CORNERS) {
    const along = dir > 0 ? wrap(c - sa) : wrap(sa - c);
    if (along > 1e-6 && along < length - 1e-6) points.push({ along, ...pointAt(c) });
  }
  points.sort((p, q) => (p.along ?? 0) - (q.along ?? 0));
  points.push(pointAt(sb));
  return points.map(({ x, z }) => ({ x, z }));
}

/** Straight hop across the ground floor between the north and south lanes, dodging columns and escalators. */
function hopPath(from, toZ, toX = from.x) {
  let x = from.x;
  for (const span of ESCALATOR_SPANS) {
    if (x > span.min && x < span.max) x = toX < (span.min + span.max) / 2 ? span.min : span.max;
  }
  for (const c of COLUMNS) {
    if (Math.abs(x - c.x) < COLUMN_CLEARANCE) x = c.x + Math.sign(toX - c.x || 1) * COLUMN_CLEARANCE;
  }
  const points = [{ x: from.x, z: from.z }];
  if (x !== from.x) points.push({ x, z: from.z });
  points.push({ x, z: toZ });
  if (Math.abs(toX - x) > 1e-6) points.push({ x: toX, z: toZ });
  return points;
}

export function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return length;
}

const isLong = (p) => p.lane === "n" || p.lane === "s";

/** On the ground floor between the two long lanes (e.g. at the foot of an escalator). */
function inMiddle(floorIndex, x, z) {
  return floorIndex === 0 && Math.abs(x) < LANE_X && Math.abs(z) < LANE_Z - 0.05;
}

/**
 * Lane path from the camera at (x, z) to the lane point nearest the target. The first point
 * is the camera spot itself, so a camera caught between lanes slides onto one first.
 */
export function planPath(floorIndex, x, z, targetX, targetZ) {
  // Between the long lanes: step sideways onto whichever one makes the trip shorter.
  if (inMiddle(floorIndex, x, z)) {
    let best = null;
    for (const laneZ of [LANE_Z, -LANE_Z]) {
      const hop = hopPath({ x, z }, laneZ);
      const end = hop[hop.length - 1];
      const points = [...hop, ...planPath(floorIndex, end.x, end.z, targetX, targetZ).slice(1)];
      if (!best || pathLength(points) < pathLength(best)) best = points;
    }
    return best;
  }
  const a = snapToLane(x, z);
  const b = snapToLane(targetX, targetZ);
  const start = { x, z };

  let best = null;
  for (const dir of [1, -1]) {
    const points = loopPath(a.s, b.s, dir);
    if (!best || pathLength(points) < pathLength(best)) best = points;
  }
  // Ground floor: sideways first, then along the other lane, when that is shorter.
  if (floorIndex === 0 && isLong(a) && isLong(b) && a.lane !== b.lane) {
    const hop = hopPath(a, b.z, b.x);
    if (pathLength(hop) <= pathLength(best)) best = hop;
  }
  if (Math.hypot(a.x - x, a.z - z) > 1e-3) best.unshift(start);
  return best;
}

/**
 * The moves an arrow key can make from (x, z): a step of `distance` each way along the lane,
 * and on the ground floor a hop to the other long lane (or, standing between the lanes,
 * a step sideways onto either one). Each comes with the direction of
 * its first leg, so the caller can pick the one that matches where the camera faces.
 */
export function laneMoves(floorIndex, x, z, distance) {
  const a = snapToLane(x, z);
  const moves = [];
  if (inMiddle(floorIndex, x, z)) {
    moves.push(hopPath({ x, z }, LANE_Z), hopPath({ x, z }, -LANE_Z)); // sideways onto either lane
  } else {
    for (const dir of [1, -1]) moves.push(loopPath(a.s, wrap(a.s + dir * distance), dir));
    if (floorIndex === 0 && isLong(a)) moves.push(hopPath(a, -a.z));
  }
  return moves.map((points) => {
    const dx = points[1].x - points[0].x;
    const dz = points[1].z - points[0].z;
    const len = Math.hypot(dx, dz) || 1;
    return { points, dir: { x: dx / len, z: dz / len } };
  });
}

/** Faint lines on both floors so the lanes can be seen. */
export function buildLaneLines(scene) {
  const width = 0.3;
  const strips = [];
  for (const floor of FLOORS) {
    const y = floor.y + 0.012;
    strips.push(
      new THREE.PlaneGeometry(LONG + width, width).rotateX(-Math.PI / 2).translate(0, y, LANE_Z),
      new THREE.PlaneGeometry(LONG + width, width).rotateX(-Math.PI / 2).translate(0, y, -LANE_Z),
      new THREE.PlaneGeometry(width, SHORT).rotateX(-Math.PI / 2).translate(LANE_X, y, 0),
      new THREE.PlaneGeometry(width, SHORT).rotateX(-Math.PI / 2).translate(-LANE_X, y, 0),
    );
  }
  const geometry = mergeGeometries(strips, false);
  for (const g of strips) g.dispose();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x3fa7d6, transparent: true, opacity: 0.55, depthWrite: false }), // accent blue, like the UI
  );
  mesh.name = "lanes";
  scene.add(mesh);
  return mesh;
}
