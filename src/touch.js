// Touch controls: a joystick pad (bottom-left) to walk, and dragging anywhere
// else on the 3D view to look around. Both work at the same time with two thumbs.

const KNOB_TRAVEL = 48; // px the knob can move from the centre
const DEAD_ZONE = 0.12; // ignore tiny thumb wobble

export function createTouchControls({ joystick, knob, lookSurface, player }) {
  // Joystick
  let joyPointer = null;
  let centreX = 0;
  let centreY = 0;

  function moveKnob(event) {
    let dx = event.clientX - centreX;
    let dy = event.clientY - centreY;
    const dist = Math.hypot(dx, dy);
    if (dist > KNOB_TRAVEL) {
      dx = (dx / dist) * KNOB_TRAVEL;
      dy = (dy / dist) * KNOB_TRAVEL;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;

    let x = dx / KNOB_TRAVEL;
    let y = -dy / KNOB_TRAVEL; // pushing up = walk forward
    if (Math.hypot(x, y) < DEAD_ZONE) x = y = 0;
    player.setMoveInput(x, y);
  }

  function releaseKnob(event) {
    if (event.pointerId !== joyPointer) return;
    joyPointer = null;
    knob.style.transform = "";
    joystick.classList.remove("is-active");
    player.setMoveInput(0, 0);
  }

  joystick.addEventListener("pointerdown", (event) => {
    if (joyPointer !== null) return;
    event.preventDefault();
    joyPointer = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    joystick.classList.add("is-active");
    const rect = joystick.getBoundingClientRect();
    centreX = rect.left + rect.width / 2;
    centreY = rect.top + rect.height / 2;
    moveKnob(event);
  });
  joystick.addEventListener("pointermove", (event) => {
    if (event.pointerId === joyPointer) moveKnob(event);
  });
  joystick.addEventListener("pointerup", releaseKnob);
  joystick.addEventListener("pointercancel", releaseKnob);
  joystick.addEventListener("lostpointercapture", releaseKnob);

  // Look: one finger dragging on the 3D view
  let lookPointer = null;
  let lastX = 0;
  let lastY = 0;

  lookSurface.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || lookPointer !== null) return;
    lookPointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    lookSurface.setPointerCapture(event.pointerId);
  });
  lookSurface.addEventListener("pointermove", (event) => {
    if (event.pointerId !== lookPointer) return;
    player.lookBy(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const endLook = (event) => {
    if (event.pointerId === lookPointer) lookPointer = null;
  };
  lookSurface.addEventListener("pointerup", endLook);
  lookSurface.addEventListener("pointercancel", endLook);
  lookSurface.addEventListener("lostpointercapture", endLook);
}
