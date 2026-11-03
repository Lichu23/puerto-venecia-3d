// Escalators between the two floors (positions in mall.js): the 3D models with moving
// steps, picking them with a click or tap, and the routes for riding them. You step on at
// the foot (ground floor, between the long lanes) or from the end lane (upper floor), ride,
// and step off: onto the end lane upstairs, or at the foot downstairs.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LANE_X, LANE_Z, pathLength, planPath } from "./lanes.js";
import { ESCALATOR, ESCALATORS, FLOORS } from "./mall.js";

const STEP_OFF = 1.5; // metres walked past the comb plate when stepping on or off
const NEAR = 5; // metres: this close to where you step on, the arrows offer the ride
const RISE = FLOORS[1].y - FLOORS[0].y;
const STEP_COUNT = 30;
const STEP_RISE = RISE / STEP_COUNT;
const STEP_TREAD = ESCALATOR.run / STEP_COUNT;
const STEP_SPEED = 0.5; // metres per second along the slope, like a real escalator

const { flat, run, slope } = ESCALATOR;
const slopeLength = Math.hypot(run, RISE);
const slopeBottomX = (e) => e.bottomX + e.side * flat;
const slopeTopX = (e) => e.topX - e.side * flat;

/** Ground-floor spot where you step on (up) or off (down). */
const footOf = (e) => ({ x: e.bottomX - e.side * STEP_OFF, y: FLOORS[0].y, z: e.z });
/** Upper-floor spot where you step off (up) or on (down). */
const headOf = (e) => ({ x: e.topX + e.side * STEP_OFF, y: FLOORS[1].y, z: e.z });

/** Escalators that leave from this floor. */
export const escalatorsFrom = (floorIndex) => ESCALATORS.filter((e) => e.up === (floorIndex === 0));

/** The escalator at this end of the atrium that leaves from this floor. */
export const escalatorAt = (floorIndex, side) => escalatorsFrom(floorIndex).find((e) => e.side === side);

/** Lane path (x, z) from (x, z) on the escalator's start floor to where you step on. */
export function approachPath(x, z, e) {
  if (!e.up) {
    // Upper floor: along the lanes to the end lane, then straight toward the atrium.
    const head = headOf(e);
    return [...planPath(1, x, z, e.side * LANE_X, e.z), { x: head.x, z: head.z }];
  }
  const foot = footOf(e);
  if (Math.abs(z) < LANE_Z - 0.05 && Math.abs(x - foot.x) < 0.5) return [{ x, z }, { x: foot.x, z: foot.z }]; // already beside it
  // Ground floor: along whichever long lane is shorter, then sideways to the foot.
  let best = null;
  for (const laneZ of [LANE_Z, -LANE_Z]) {
    const points = [...planPath(0, x, z, foot.x, laneZ), { x: foot.x, z: foot.z }];
    if (!best || pathLength(points) < pathLength(best)) best = points;
  }
  return best;
}

/** The ride itself (x, y, z with y the floor level under you), from stepping on to stepping off. */
export function ridePath(e) {
  const [y0, y1] = [FLOORS[0].y, FLOORS[1].y];
  const upward = [
    footOf(e),
    { x: e.bottomX, y: y0, z: e.z },
    { x: slopeBottomX(e), y: y0, z: e.z },
    { x: slopeTopX(e), y: y1, z: e.z },
    { x: e.topX, y: y1, z: e.z },
    headOf(e),
  ];
  return e.up ? upward : upward.reverse();
}

/** After an up ride, the short walk from the head onto the end lane (x, z on the upper floor). */
export const exitPath = (e) => (e.up ? [{ x: e.side * LANE_X, z: e.z }] : []);

/** Horizontal direction of travel on the escalator. */
export const rideDirection = (e) => ({ x: e.up ? e.side : -e.side, z: 0 });

/** Rides you can start from here without a long walk, as arrow moves ({ points, dir, ride }). */
export function nearbyRides(floorIndex, x, z) {
  const rides = [];
  for (const e of escalatorsFrom(floorIndex)) {
    const points = approachPath(x, z, e);
    if (pathLength(points) <= NEAR + STEP_OFF) rides.push({ points, dir: rideDirection(e), ride: e });
  }
  return rides;
}

/** The escalator leaving this floor with the shortest walk to it. */
export function nearestEscalator(floorIndex, x, z) {
  let best = null;
  let bestLength = Infinity;
  for (const e of escalatorsFrom(floorIndex)) {
    const length = pathLength(approachPath(x, z, e));
    if (length < bestLength) {
      best = e;
      bestLength = length;
    }
  }
  return best;
}

/**
 * Builds the four escalators. Returns `pick(raycaster, maxDistance)`, which gives the
 * escalator under the pointer (or null), and `update(delta, still)` to move the steps.
 */
export function buildEscalators(scene) {
  const group = new THREE.Group();
  group.name = "escalators";

  const materials = {
    body: new THREE.MeshLambertMaterial({ color: 0xb9c0c8 }),
    plate: new THREE.MeshLambertMaterial({ color: 0x8e979f }),
    rail: new THREE.MeshLambertMaterial({ color: 0x1f2328 }),
    glass: new THREE.MeshBasicMaterial({ color: 0xbfe0f0, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
    lane: new THREE.MeshBasicMaterial({ color: 0x3fa7d6, transparent: true, opacity: 0.55, depthWrite: false }),
  };
  const parts = Object.fromEntries(Object.keys(materials).map((k) => [k, []]));
  const proxies = [];
  const steppers = []; // { mesh, e, phase }

  const halfW = ESCALATOR.width / 2;
  const glassH = 0.9;
  for (const e of ESCALATORS) {
    const { side, z } = e;
    const tilt = side * slope; // rotateZ angle that tips a box along the slope
    const midX = (slopeBottomX(e) + slopeTopX(e)) / 2;
    const midY = RISE / 2;
    // A box laid along the slope, `up` metres above the riding line, at `dz` across.
    const sloped = (key, w, h, d, up, dz = 0) =>
      parts[key].push(new THREE.BoxGeometry(w, h, d).translate(0, up, 0).rotateZ(tilt).translate(midX, midY, z + dz));
    // A box over a level end (`y` floor level) between two x values.
    const level = (key, x0, x1, y, h, up, d, dz = 0) =>
      parts[key].push(new THREE.BoxGeometry(Math.abs(x1 - x0), h, d).translate((x0 + x1) / 2, y + up, z + dz));

    // Truss under the steps, and the housings under the level ends
    sloped("body", slopeLength, 1.0, ESCALATOR.width, -0.75);
    level("body", slopeTopX(e), e.topX, RISE, 1.0, -0.75, ESCALATOR.width);
    // Comb plates where you step on and off
    level("plate", slopeBottomX(e), e.bottomX, 0, 0.04, 0.02, ESCALATOR.stepWidth);
    level("plate", slopeTopX(e), e.topX, RISE, 0.04, 0.02, ESCALATOR.stepWidth);
    // Glass balustrades and handrails on both sides
    for (const across of [halfW - 0.05, -(halfW - 0.05)]) {
      sloped("glass", slopeLength, glassH, 0.03, glassH / 2 + 0.1, across);
      sloped("rail", slopeLength, 0.08, 0.1, glassH + 0.14, across);
      for (const [x0, x1, y] of [[slopeBottomX(e), e.bottomX, 0], [slopeTopX(e), e.topX, RISE]]) {
        level("glass", x0, x1, y, glassH, glassH / 2 + 0.1, 0.03, across);
        level("rail", x0, x1, y, 0.08, glassH + 0.14, 0.1, across);
      }
    }

    // Moving steps: one row, slid along the slope and clipped at both ends of it
    const steps = [];
    for (let i = -1; i < STEP_COUNT; i++) {
      const x = slopeBottomX(e) + side * (i + 0.5) * STEP_TREAD;
      const top = (i + 1) * STEP_RISE;
      steps.push(new THREE.BoxGeometry(STEP_TREAD, 0.6, ESCALATOR.stepWidth).translate(x, top - 0.3, z));
    }
    const lowX = Math.min(slopeBottomX(e), slopeTopX(e));
    const highX = Math.max(slopeBottomX(e), slopeTopX(e));
    const stepMaterial = new THREE.MeshLambertMaterial({
      color: 0x51575e,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(1, 0, 0), -lowX), new THREE.Plane(new THREE.Vector3(-1, 0, 0), highX)],
    });
    const stepMesh = new THREE.Mesh(mergeGeometries(steps, false), stepMaterial);
    for (const g of steps) g.dispose();
    stepMesh.name = "escalator-steps";
    group.add(stepMesh);
    steppers.push({ mesh: stepMesh, e, phase: 0 });

    // Invisible box along the slope, for picking
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(slopeLength + 2 * flat, 2, ESCALATOR.width).translate(0, 0.4, 0).rotateZ(tilt).translate(midX, midY, z));
    proxy.visible = false;
    proxy.userData.escalator = e;
    group.add(proxy);
    proxies.push(proxy);

    // Short lane lines to where you step on and off
    const laneW = 0.3;
    if (e.up) {
      const foot = footOf(e);
      parts.lane.push(new THREE.PlaneGeometry(laneW, 2 * LANE_Z).rotateX(-Math.PI / 2).translate(foot.x, 0.012, 0));
    }
    const laneLen = Math.abs(side * LANE_X - e.topX);
    parts.lane.push(new THREE.PlaneGeometry(laneLen, laneW).rotateX(-Math.PI / 2).translate((side * LANE_X + e.topX) / 2, RISE + 0.012, z));
  }

  for (const [key, geometries] of Object.entries(parts)) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries, false), materials[key]);
    for (const g of geometries) g.dispose();
    mesh.name = `escalator-${key}`;
    if (key === "glass") mesh.renderOrder = 1;
    group.add(mesh);
  }
  scene.add(group);

  return {
    pick(raycaster, maxDistance) {
      const hit = raycaster.intersectObjects(proxies, false)[0];
      return hit && hit.distance <= maxDistance ? hit.object.userData.escalator : null;
    },
    update(delta, still) {
      if (still) return;
      for (const s of steppers) {
        // Up escalators carry their steps up the slope, down ones carry them down.
        s.phase = (((s.phase + ((s.e.up ? 1 : -1) * delta * STEP_SPEED) / Math.hypot(STEP_TREAD, STEP_RISE)) % 1) + 1) % 1;
        s.mesh.position.set(s.e.side * s.phase * STEP_TREAD, s.phase * STEP_RISE, 0);
      }
    },
  };
}
