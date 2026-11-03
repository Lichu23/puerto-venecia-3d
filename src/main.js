import * as THREE from "three";
import { buildMall, FLOORS } from "./mall.js";
import { createPlayer } from "./player.js";
import { buildStores, CATEGORY_GROUPS, loadStores } from "./stores.js";
import { createTouchControls } from "./touch.js";

const canvas = document.getElementById("scene");
const overlay = document.getElementById("overlay");
const startButton = document.getElementById("start");
const pauseButton = document.getElementById("pause");
const message = document.getElementById("message");
const floorLabel = document.getElementById("floor-label");
const floorButtons = document.querySelectorAll(".floor-switch button");
const legend = document.getElementById("legend");
const storeCount = document.getElementById("store-count");

// Same test the CSS uses to show the touch pad: is the main pointer a finger?
const touchMode = window.matchMedia("(pointer: coarse)").matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch (error) {
  startButton.textContent = "3D not available";
  message.textContent =
    "Your browser couldn't start 3D graphics (WebGL). Try another browser or update your graphics drivers.";
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap fill rate on high-DPI screens
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
const skyColor = new THREE.Color(0xcfd8e3);
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, 60, 170);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 250);

buildMall(scene, renderer);

// Category legend in the start panel (textContent only: no HTML from data)
for (const group of CATEGORY_GROUPS) {
  const item = document.createElement("li");
  const swatch = document.createElement("span");
  swatch.className = "swatch";
  swatch.style.backgroundColor = group.color;
  item.append(swatch, group.label);
  legend.append(item);
}

// Stores load in the background; walking can start before they appear.
loadStores()
  .then(({ indoor, outdoor }) => {
    buildStores(scene, renderer, indoor);
    const baja = indoor.filter((s) => s.floor === 0).length;
    storeCount.textContent = `${baja} stores on Planta Baja, ${indoor.length - baja} on Planta Alta` + (outdoor ? ` · ${outdoor} outdoor stores not shown yet` : "");
  })
  .catch((error) => {
    console.error(error);
    storeCount.textContent = "Couldn't load the store list. The building works, but without shops.";
  });

const player = createPlayer(camera, document.body, {
  onFloorChange: (floor) => {
    floorLabel.textContent = floor.name;
    const index = FLOORS.indexOf(floor);
    for (const button of floorButtons) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.floor) === index));
    }
  },
});

// Start / pause overlay
function showOverlay() {
  overlay.hidden = false;
  startButton.textContent = "Resume";
  startButton.focus({ preventScroll: true });
}

function hideOverlay() {
  overlay.hidden = true;
  message.textContent = "";
}

player.controls.addEventListener("lock", hideOverlay);
player.controls.addEventListener("unlock", showOverlay);
document.addEventListener("pointerlockerror", () => {
  message.textContent = "Couldn't capture the mouse. Wait a second and click again.";
});

startButton.addEventListener("click", () => {
  if (touchMode) {
    player.setTouchActive(true);
    hideOverlay();
  } else {
    player.controls.lock();
  }
});

pauseButton.addEventListener("click", () => {
  player.setTouchActive(false);
  showOverlay();
});

for (const button of floorButtons) {
  button.addEventListener("click", () => player.setFloor(Number(button.dataset.floor)));
}

if (touchMode) {
  createTouchControls({
    joystick: document.getElementById("joystick"),
    knob: document.getElementById("joystick-knob"),
    lookSurface: canvas,
    player,
  });
  startButton.disabled = false;
  startButton.textContent = "Start walking";
} else if ("requestPointerLock" in Element.prototype) {
  startButton.disabled = false;
  startButton.textContent = "Start walking";
} else {
  startButton.textContent = "Not supported";
  message.textContent = "This browser can't capture the mouse. Try Chrome, Edge, Firefox or Brave.";
}

// Render loop
const timer = new THREE.Timer();
timer.connect(document); // freezes the delta while the tab is hidden

renderer.setAnimationLoop(() => {
  timer.update();
  player.update(timer.getDelta());
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
