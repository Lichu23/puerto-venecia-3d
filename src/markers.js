// Floor markers in the style of street-level maps:
// - the cursor: a see-through disc on the floor with a chevron pointing the way you'd move
//   (follows the mouse on desktop, and marks where a glide is heading);
// - the arrows: white chevrons in a ring on the floor ahead of you, one per lane move,
//   shown on touch screens so you can tap one to step that way.

import * as THREE from "three";

const LIFT = 0.03; // above the floor (and the lane lines) so nothing flickers

/** Flat chevron pointing along -z once laid on the floor (shape +y becomes -z). */
function chevronGeometry(width, height, thickness) {
  const w = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-w, -height / 2);
  shape.lineTo(0, height / 2);
  shape.lineTo(w, -height / 2);
  shape.lineTo(w, -height / 2 - thickness);
  shape.lineTo(0, height / 2 - thickness);
  shape.lineTo(-w, -height / 2 - thickness);
  shape.closePath();
  return new THREE.ShapeGeometry(shape).translate(0, thickness / 2, 0).rotateX(-Math.PI / 2);
}

const flat = (options) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, ...options });

/** Yaw that turns a chevron (pointing -z) to point along (dx, dz). */
const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

export function createCursor(scene) {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 48).rotateX(-Math.PI / 2), flat({ color: 0xffffff, opacity: 0.4 }));
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.8, 48).rotateX(-Math.PI / 2), flat({ color: 0xffffff, opacity: 0.5 }));
  const arrow = new THREE.Mesh(chevronGeometry(0.85, 0.4, 0.2).translate(0, 0.002, 0), flat({ color: 0x3a3f45, opacity: 0.55 }));
  disc.renderOrder = rim.renderOrder = 2;
  arrow.renderOrder = 3; // drawn last, on top of the disc
  group.add(disc, rim, arrow);
  group.visible = false;
  scene.add(group);

  return {
    /** Show the disc at a floor spot, its chevron pointing along (dx, dz); null hides it. */
    show(spot, dx = 0, dz = -1) {
      group.visible = spot !== null;
      if (!spot) return;
      group.position.set(spot.x, spot.y + LIFT, spot.z);
      arrow.rotation.y = yawOf(dx, dz);
    },
  };
}

const RING_AHEAD = 3.8; // metres from the camera to the middle of the arrow ring
const RING_RADIUS = 1.0; // metres from the ring middle to each arrow
const HIT_RADIUS = 0.75; // a tap this close to an arrow (on the floor) picks it
const FADE_TIME = 0.2; // seconds to fade in after a glide

export function createArrows(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const arrowGeometry = chevronGeometry(0.75, 0.32, 0.17);
  const shadowGeometry = arrowGeometry.clone().translate(0, -0.005, 0.05); // a soft drop shadow gives them some depth
  const arrowMaterial = flat({ color: 0xffffff, opacity: 0.92 });
  const shadowMaterial = flat({ color: 0x000000, opacity: 0.22 });
  const pool = [];
  let shown = []; // [{ x, z, move }]
  let fade = 0;

  function item(i) {
    if (!pool[i]) {
      const g = new THREE.Group();
      const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
      const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
      shadow.renderOrder = 2;
      arrow.renderOrder = 3; // always over its shadow
      g.add(shadow, arrow);
      group.add(g);
      pool[i] = g;
    }
    return pool[i];
  }

  return {
    /**
     * Lay out one arrow per move around a point ahead of the camera, or hide them all
     * (moves = null). `forward` is the camera's view direction flattened onto the floor.
     */
    update(moves, camera, floorY, forward, delta) {
      if (!moves) {
        group.visible = false;
        shown = [];
        fade = 0;
        return;
      }
      fade = Math.min(1, fade + delta / FADE_TIME);
      arrowMaterial.opacity = 0.92 * fade;
      shadowMaterial.opacity = 0.22 * fade;
      group.visible = true;

      const cx = camera.position.x + forward.x * RING_AHEAD;
      const cz = camera.position.z + forward.z * RING_AHEAD;
      shown = moves.map((move, i) => {
        const x = cx + move.dir.x * RING_RADIUS;
        const z = cz + move.dir.z * RING_RADIUS;
        const g = item(i);
        g.visible = true;
        g.position.set(x, floorY + LIFT, z);
        g.rotation.y = yawOf(move.dir.x, move.dir.z);
        return { x, z, move };
      });
      for (let i = moves.length; i < pool.length; i++) pool[i].visible = false;
    },

    /** The move whose arrow is under a floor point, or null. */
    moveAt(x, z) {
      let best = null;
      let bestD = HIT_RADIUS;
      for (const a of shown) {
        const d = Math.hypot(a.x - x, a.z - z);
        if (d < bestD) {
          best = a.move;
          bestD = d;
        }
      }
      return best;
    },
  };
}
