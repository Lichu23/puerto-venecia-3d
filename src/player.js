// First-person viewer that moves like a street-level map, on lanes: click or tap the floor
// and the camera glides to the nearest lane point, following the lanes (forward/back along
// one, or a sideways hop to the other on the ground floor); drag anywhere to look around.
// Mouse, touch and pen all go through pointer events. On desktop, up/down (or W/S) step
// along the lane you face, left/right (or A/D) turn, and 1/2 change floor. Changing floor
// always means riding an escalator: walk to it, ride it, step off.

import * as THREE from "three";
import { approachPath, escalatorAt, exitPath, nearbyRides, nearestEscalator, rideDirection, ridePath } from "./escalators.js";
import { LANE_X, laneMoves, pathLength, planPath, snapToLane } from "./lanes.js";
import { FLOORS, MALL } from "./mall.js";

const EYE_HEIGHT = 1.65;
const MAX_REACH = 30; // metres from the camera a click on the floor is counted
const MIN_STEP = 0.4; // shorter moves are ignored
const KEY_STEP = 5; // metres per up/down key press
const KEY_TURN = Math.PI / 6; // 30 degrees per left/right key press
const LOOK_SPEED = { mouse: 0.003, touch: 0.004, pen: 0.004 }; // radians per pixel dragged
const TAP_SLOP = { mouse: 6, touch: 10, pen: 10 }; // px a press may move and still count as a click
const MAX_PITCH = Math.PI / 2 - 0.05; // don't flip over when looking straight up or down
const RIDE_TIME = 5; // seconds on the escalator (faster than real life, slow enough to look around)
const RIDE_PITCH = { up: 0.12, down: -0.3 }; // look a little up the slope, or down at the floor below

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const still = () => reducedMotion.matches;

// Glide time grows with distance, so short hops are quick and long ones still readable.
const glideDuration = (distance) => (still() ? 0 : THREE.MathUtils.clamp(0.35 + distance * 0.03, 0.4, 2.5));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} surface element that receives drags and clicks (the canvas)
 * @param {{ onFloorChange?: (floor) => void, onTap?: (x: number, y: number, pointerType: string) => void }} options
 */
export function createPlayer(camera, surface, { onFloorChange, onTap } = {}) {
  const look = new THREE.Euler(0, 0, 0, "YXZ");
  const forward = new THREE.Vector3();
  const hit = new THREE.Vector3();
  let floorIndex = 0;
  let enabled = false;
  let glide = null; // { points: Vector3[], lengths: number[], total, t, duration, onArrive }
  let turn = null; // { from, to: Quaternion, t, duration }
  let drag = null; // { id, type, startX, startY, lastX, lastY, moved }
  let riding = false; // on the way to, on, or stepping off an escalator: other input waits

  // Start just inside the west entrance doors, looking down the gallery; enter() walks in.
  camera.position.set(-MALL.halfX + 1.2, FLOORS[0].y + EYE_HEIGHT, 0);
  camera.rotation.set(0, -Math.PI / 2, 0, "YXZ");

  const eyeY = () => FLOORS[floorIndex].y + EYE_HEIGHT;

  /** Glide along lane points ({x, z}, at the current floor's eye height, or {x, y, z} with y the floor level). */
  function glideAlong(lanePoints, { duration, onArrive } = {}) {
    const points = [camera.position.clone(), ...lanePoints.map((p) => new THREE.Vector3(p.x, p.y === undefined ? eyeY() : p.y + EYE_HEIGHT, p.z))];
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    const total = lengths[lengths.length - 1];
    glide = { points, lengths, total, t: 0, duration: duration ?? glideDuration(total), onArrive };
    if (glide.duration === 0) update(0);
  }

  function turnTo(quaternion, duration) {
    turn = { from: camera.quaternion.clone(), to: quaternion, t: 0, duration: still() ? 0 : duration };
    if (turn.duration === 0) update(0);
  }

  /** Where a click along this ray would take the player, or null (sky, or too close to move). */
  function targetFromRay(ray) {
    const floorY = FLOORS[floorIndex].y;
    if (ray.direction.y > -1e-3) return null; // looking level or up: never meets the floor
    hit.copy(ray.origin).addScaledVector(ray.direction, (floorY - ray.origin.y) / ray.direction.y);

    // The lane comes from where the click really lands; only the distance along it is capped.
    const pos = camera.position;
    const spot = snapToLane(hit.x, hit.z);
    if (spot.lane === "n" || spot.lane === "s") spot.x = THREE.MathUtils.clamp(spot.x, pos.x - MAX_REACH, pos.x + MAX_REACH);
    else spot.z = THREE.MathUtils.clamp(spot.z, pos.z - MAX_REACH, pos.z + MAX_REACH);
    if (pathLength(planPath(floorIndex, pos.x, pos.z, spot.x, spot.z)) < MIN_STEP) return null;
    return new THREE.Vector3(spot.x, floorY, spot.z);
  }

  /**
   * Glide along the lanes to the lane point nearest `spot`. With `lookAt`, the view turns
   * on the way to face that point from where the glide ends. `onArrive` runs when it ends
   * (not if another glide replaces it).
   */
  function glideTo(spot, { lookAt, duration, onArrive } = {}) {
    const points = pathTo(spot);
    glideAlong(points, { duration: still() ? 0 : duration, onArrive });
    if (lookAt) {
      const end = points[points.length - 1];
      const dx = lookAt.x - end.x;
      const dz = lookAt.z - end.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(lookAt.y - eyeY(), Math.hypot(dx, dz));
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
      const duration = Math.max(glide?.duration ?? 0, camera.quaternion.angleTo(target) * 0.35);
      if (glide) glide.duration = duration; // arrive and finish turning together
      turnTo(target, duration);
    }
  }

  /** Lane path from the camera to the lane point nearest `spot`. */
  function pathTo(spot) {
    return planPath(floorIndex, camera.position.x, camera.position.z, spot.x, spot.z);
  }

  /** From the entrance doors onto the end lane, at a walking pace. */
  function enter() {
    glideTo({ x: -LANE_X, z: 0 }, { duration: 1.6 });
  }

  /**
   * Lane moves of `distance` from here, ignoring ones too short to matter, plus a ride on
   * any escalator you are standing next to (those moves carry `ride`).
   */
  function moves(distance) {
    const { x, z } = camera.position;
    return [...laneMoves(floorIndex, x, z, distance).filter((m) => pathLength(m.points) >= MIN_STEP), ...nearbyRides(floorIndex, x, z)];
  }

  /** Face along the escalator, tilted toward where it goes. */
  function rideView(e) {
    const dir = rideDirection(e);
    const yaw = Math.atan2(-dir.x, -dir.z);
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(e.up ? RIDE_PITCH.up : RIDE_PITCH.down, yaw, 0, "YXZ"));
  }

  /** Same heading as now, looking level. */
  function levelView() {
    look.setFromQuaternion(turn?.to ?? camera.quaternion);
    look.x = 0;
    return new THREE.Quaternion().setFromEuler(look);
  }

  /** Walk to an escalator leaving this floor, ride it to the other floor, and step off. */
  function ride(e) {
    if (riding || !e) return;
    riding = true;
    const toFloor = e.up ? 1 : 0;
    const finish = () => {
      riding = false;
    };
    glideAlong(approachPath(camera.position.x, camera.position.z, e), {
      onArrive: () => {
        turnTo(rideView(e), 0.6);
        glideAlong(ridePath(e), {
          duration: still() ? 0 : RIDE_TIME,
          onArrive: () => {
            floorIndex = toFloor;
            onFloorChange?.(FLOORS[toFloor]);
            turnTo(levelView(), 0.4);
            const exit = exitPath(e);
            if (exit.length) glideAlong(exit, { onArrive: finish });
            else finish();
          },
        });
      },
    });
  }

  /** Change floor by the nearest escalator. */
  function setFloor(index) {
    if (riding || index === floorIndex || !FLOORS[index]) return;
    ride(nearestEscalator(floorIndex, camera.position.x, camera.position.z));
  }

  /** Ride the escalator at this end of the atrium (side -1 west, 1 east) that leaves from this floor. */
  function rideAt(side) {
    ride(escalatorAt(floorIndex, side));
  }

  function turnBy(angle) {
    look.setFromQuaternion(turn?.to ?? camera.quaternion);
    look.y += angle;
    turnTo(new THREE.Quaternion().setFromEuler(look), 0.25);
  }

  /** Up/down keys: the lane move whose direction best matches the way the camera faces. */
  function stepBy(sign) {
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize().multiplyScalar(sign);
    let best = null;
    let bestDot = 0.5; // ignore moves more than ~60 degrees off the view
    for (const move of moves(KEY_STEP)) {
      const dot = move.dir.x * forward.x + move.dir.z * forward.z;
      if (dot > bestDot) {
        best = move;
        bestDot = dot;
      }
    }
    if (best?.ride) ride(best.ride);
    else if (best) glideAlong(best.points);
  }

  // Keyboard (desktop extra)
  function onKeyDown(event) {
    if (!enabled || riding || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.repeat && (glide || turn)) return; // holding a key: next move once this one lands
    switch (event.code) {
      case "ArrowUp":
      case "KeyW":
        stepBy(1);
        break;
      case "ArrowDown":
      case "KeyS":
        stepBy(-1);
        break;
      case "ArrowLeft":
      case "KeyA":
        turnBy(KEY_TURN);
        break;
      case "ArrowRight":
      case "KeyD":
        turnBy(-KEY_TURN);
        break;
      case "Digit1":
        setFloor(0);
        break;
      case "Digit2":
        setFloor(1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // Drag to look; a press that barely moves is a click/tap instead.
  function onPointerDown(event) {
    if (!enabled || drag || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag = { id: event.pointerId, type: event.pointerType, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    surface.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const slop = TAP_SLOP[drag.type] ?? 10;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > slop) {
      drag.moved = true;
      surface.classList.add("is-dragging");
      turn = null; // the user takes over the view
    }
    if (drag.moved) {
      const speed = LOOK_SPEED[drag.type] ?? 0.004;
      look.setFromQuaternion(camera.quaternion);
      look.y += (event.clientX - drag.lastX) * speed; // grab the view: drag right, the scene follows
      look.x += (event.clientY - drag.lastY) * speed;
      look.x = THREE.MathUtils.clamp(look.x, -MAX_PITCH, MAX_PITCH);
      camera.quaternion.setFromEuler(look);
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const wasTap = !drag.moved && event.type === "pointerup";
    endDrag();
    if (wasTap && enabled && !riding) onTap?.(event.clientX, event.clientY, event.pointerType);
  }

  function endDrag() {
    drag = null;
    surface.classList.remove("is-dragging");
  }

  document.addEventListener("keydown", onKeyDown);
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerUp);
  surface.addEventListener("lostpointercapture", onPointerUp);
  window.addEventListener("blur", endDrag);

  function update(delta) {
    const dt = Math.min(delta, 0.1);
    if (turn) {
      turn.t = turn.duration > 0 ? Math.min(1, turn.t + dt / turn.duration) : 1;
      camera.quaternion.slerpQuaternions(turn.from, turn.to, easeInOut(turn.t));
      if (turn.t === 1) turn = null;
    }
    if (!glide) return;
    glide.t = glide.duration > 0 ? Math.min(1, glide.t + dt / glide.duration) : 1;
    // Constant speed along the whole path, easing only at its start and end.
    const along = easeInOut(glide.t) * glide.total;
    const { points, lengths } = glide;
    let i = 1;
    while (i < points.length - 1 && lengths[i] < along) i++;
    const span = lengths[i] - lengths[i - 1];
    camera.position.lerpVectors(points[i - 1], points[i], span > 0 ? (along - lengths[i - 1]) / span : 1);
    if (glide.t === 1) {
      const { onArrive } = glide;
      glide = null;
      onArrive?.();
    }
  }

  function dispose() {
    document.removeEventListener("keydown", onKeyDown);
    surface.removeEventListener("pointerdown", onPointerDown);
    surface.removeEventListener("pointermove", onPointerMove);
    surface.removeEventListener("pointerup", onPointerUp);
    surface.removeEventListener("pointercancel", onPointerUp);
    surface.removeEventListener("lostpointercapture", onPointerUp);
    window.removeEventListener("blur", endDrag);
  }

  return {
    update,
    setFloor,
    glideTo,
    glideAlong,
    ride,
    rideAt,
    targetFromRay,
    pathTo,
    moves,
    enter,
    dispose,
    get floor() {
      return FLOORS[floorIndex];
    },
    get floorIndex() {
      return floorIndex;
    },
    get gliding() {
      return glide !== null || riding;
    },
    get riding() {
      return riding;
    },
    get dragging() {
      return drag?.moved ?? false;
    },
    /** Input is ignored while a menu or card covers the view. */
    set enabled(value) {
      enabled = value;
      if (!value) endDrag();
    },
    get enabled() {
      return enabled;
    },
  };
}
