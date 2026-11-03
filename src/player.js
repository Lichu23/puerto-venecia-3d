// First-person player: mouse look (pointer lock), WASD / arrow keys to walk,
// Shift to run, and simple collision against the mall walls, columns and atrium.
// On touch screens, src/touch.js feeds it a joystick (setMoveInput) and finger look (lookBy).

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { FLOORS, MALL, isWalkable, nearestWalkable } from "./mall.js";

const EYE_HEIGHT = 1.65;
const RADIUS = 0.35;
const WALK_SPEED = 4.5; // m/s
const RUN_SPEED = 9;
const ACCELERATION = 12; // how quickly speed eases toward the target
const TOUCH_MAX_SPEED = 6; // joystick pushed all the way
const TOUCH_LOOK_SPEED = 0.005; // radians per pixel dragged
const MAX_PITCH = Math.PI / 2 - 0.05; // don't flip over when looking straight up or down

const MOVE_KEYS = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

export function createPlayer(camera, lockElement, { onFloorChange } = {}) {
  const controls = new PointerLockControls(camera, lockElement);
  const pressed = new Set();
  const velocity = new THREE.Vector2(); // x, z in world space
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector2();
  const analog = new THREE.Vector2(); // touch joystick: x = right, y = forward, length 0..1
  const look = new THREE.Euler(0, 0, 0, "YXZ");
  let running = false;
  let touchActive = false;
  let floorIndex = 0;

  const isActive = () => controls.isLocked || touchActive;

  // Start at the west entrance of the ground floor, looking down the gallery.
  camera.position.set(-MALL.halfX + 8, FLOORS[0].y + EYE_HEIGHT, 0); // just inside the west entrance
  camera.rotation.set(0, -Math.PI / 2, 0, "YXZ");

  function setFloor(index) {
    if (index === floorIndex || !FLOORS[index]) return;
    floorIndex = index;
    const spot = nearestWalkable(index, camera.position.x, camera.position.z, RADIUS);
    camera.position.set(spot.x, FLOORS[index].y + EYE_HEIGHT, spot.z);
    velocity.set(0, 0);
    onFloorChange?.(FLOORS[index]);
  }

  function onKeyDown(event) {
    if (!controls.isLocked) return;
    if (MOVE_KEYS[event.code]) {
      pressed.add(MOVE_KEYS[event.code]);
      event.preventDefault();
    } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      running = true;
    } else if (event.code === "Digit1") {
      setFloor(0);
    } else if (event.code === "Digit2") {
      setFloor(1);
    }
  }

  function onKeyUp(event) {
    if (MOVE_KEYS[event.code]) pressed.delete(MOVE_KEYS[event.code]);
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") running = false;
  }

  // Releasing the mouse (Esc) must not leave a key stuck down.
  function clearInput() {
    pressed.clear();
    analog.set(0, 0);
    running = false;
    velocity.set(0, 0);
  }

  /** Touch joystick input. x = right, y = forward; the length (0..1) sets the speed. */
  function setMoveInput(x, y) {
    analog.set(x, y);
    if (analog.lengthSq() > 1) analog.normalize();
  }

  /** Touch look: turn the camera by a finger drag of (dx, dy) pixels. */
  function lookBy(dx, dy) {
    if (!touchActive) return;
    look.setFromQuaternion(camera.quaternion);
    look.y -= dx * TOUCH_LOOK_SPEED;
    look.x -= dy * TOUCH_LOOK_SPEED;
    look.x = THREE.MathUtils.clamp(look.x, -MAX_PITCH, MAX_PITCH);
    camera.quaternion.setFromEuler(look);
  }

  function setTouchActive(value) {
    touchActive = value;
    if (!value) clearInput();
  }

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearInput);
  controls.addEventListener("unlock", clearInput);

  function update(delta) {
    if (!isActive()) return;
    const dt = Math.min(delta, 0.1); // avoid big jumps after a stall

    // Camera heading flattened onto the floor
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up);

    const f = Number(pressed.has("forward")) - Number(pressed.has("back"));
    const s = Number(pressed.has("right")) - Number(pressed.has("left"));
    if (f !== 0 || s !== 0) {
      // Keyboard: full speed in the pressed direction
      wish.set(forward.x * f + right.x * s, forward.z * f + right.z * s);
      wish.normalize().multiplyScalar(running ? RUN_SPEED : WALK_SPEED);
    } else {
      // Joystick: speed grows with how far the knob is pushed
      wish.set(forward.x * analog.y + right.x * analog.x, forward.z * analog.y + right.z * analog.x);
      wish.multiplyScalar(TOUCH_MAX_SPEED);
    }

    velocity.x = THREE.MathUtils.damp(velocity.x, wish.x, ACCELERATION, dt);
    velocity.y = THREE.MathUtils.damp(velocity.y, wish.y, ACCELERATION, dt);

    // Move one axis at a time so the player slides along walls instead of stopping.
    const pos = camera.position;
    const nx = pos.x + velocity.x * dt;
    if (isWalkable(floorIndex, nx, pos.z, RADIUS)) pos.x = nx;
    else velocity.x = 0;

    const nz = pos.z + velocity.y * dt;
    if (isWalkable(floorIndex, pos.x, nz, RADIUS)) pos.z = nz;
    else velocity.y = 0;
  }

  function dispose() {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", clearInput);
    controls.dispose();
  }

  return {
    controls,
    update,
    setFloor,
    setMoveInput,
    lookBy,
    setTouchActive,
    dispose,
    get floor() {
      return FLOORS[floorIndex];
    },
  };
}
