import * as THREE from "three";
import { buildMall, FLOORS } from "./mall.js";
import { createPlayer } from "./player.js";
import { buildStores, CATEGORY_GROUPS, createStorePicker, loadStores } from "./stores.js";
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
const aimHint = document.getElementById("aim-hint");
const card = document.getElementById("store-card");
const cardClose = document.getElementById("card-close");

// Same test the CSS uses to show the touch pad: is the main pointer a finger?
const touchMode = window.matchMedia("(pointer: coarse)").matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch (error) {
  startButton.textContent = "3D no disponible";
  message.textContent =
    "Tu navegador no ha podido iniciar los gráficos 3D (WebGL). Prueba con otro navegador o actualiza los controladores gráficos.";
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
    const { placed } = buildStores(scene, renderer, indoor);
    pickStore = createStorePicker(placed);
    const baja = indoor.filter((s) => s.floor === 0).length;
    storeCount.textContent = `${baja} tiendas en Planta Baja, ${indoor.length - baja} en Planta Alta` + (outdoor ? ` · ${outdoor} tiendas exteriores aún no se muestran` : "");
  })
  .catch((error) => {
    console.error(error);
    storeCount.textContent = "No se ha podido cargar la lista de tiendas. El edificio funciona, pero sin tiendas.";
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

// Shop picking: the crosshair on desktop, a tap on touch screens
const PICK_DISTANCE = 30; // metres
let pickStore = null;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function storeAt(clientX, clientY) {
  if (!pickStore) return null;
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return pickStore(raycaster.ray.origin, raycaster.ray.direction, FLOORS.indexOf(player.floor), PICK_DISTANCE);
}

// Store text is only ever set with textContent (it comes from scraped pages).
let cardOpen = false;
function openCard(store) {
  cardOpen = true;
  document.getElementById("card-swatch").style.backgroundColor = store.group.color;
  document.getElementById("card-group-label").textContent = store.categories.join(" · ") || store.group.label;
  document.getElementById("card-name").textContent = store.name;
  document.getElementById("card-where").textContent = `${store.floorName} · ${store.zone}`;
  const description = document.getElementById("card-description");
  description.textContent = store.description;
  description.hidden = !store.description;

  const facts = document.getElementById("card-facts");
  facts.replaceChildren();
  const addFact = (label, value) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value;
    row.append(dt, dd);
    facts.append(row);
  };
  if (store.phone) {
    const tel = document.createElement("a");
    tel.href = `tel:${store.phone.replace(/ /g, "")}`;
    tel.textContent = store.phone;
    addFact("Teléfono", tel);
  }
  if (store.hours) addFact("Horario", store.hours);
  facts.hidden = facts.childElementCount === 0;

  const services = document.getElementById("card-services");
  services.replaceChildren(
    ...[...store.extras, ...store.services].map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
  services.hidden = services.childElementCount === 0;

  const link = document.getElementById("card-link");
  link.hidden = !store.url;
  if (store.url) link.href = store.url;

  aimHint.hidden = true;
  card.hidden = false;
  if (player.controls.isLocked) player.controls.unlock(); // the unlock handler sees cardOpen and skips the menu
  player.setTouchActive(false);
  cardClose.focus({ preventScroll: true });
}

function closeCard(resume) {
  if (!cardOpen) return;
  cardOpen = false;
  card.hidden = true;
  if (!resume) return showOverlay();
  if (touchMode) player.setTouchActive(true);
  else player.controls.lock();
}

cardClose.addEventListener("click", () => closeCard(true));
card.addEventListener("click", (event) => {
  if (event.target === card) closeCard(true); // tap outside the panel
});
document.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && cardOpen) closeCard(false);
});

// Desktop: click while walking opens the shop under the crosshair.
document.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || !player.controls.isLocked) return;
  const store = storeAt(window.innerWidth / 2, window.innerHeight / 2);
  if (store) openCard(store);
});

// Touch: a short tap (not a look drag) opens the shop under the finger.
if (touchMode) {
  let tap = null;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" && event.isPrimary) tap = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp };
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!tap || event.pointerId !== tap.id) return;
    const moved = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
    const quick = event.timeStamp - tap.t < 350;
    tap = null;
    if (moved > 10 || !quick || cardOpen || !overlay.hidden) return;
    const store = storeAt(event.clientX, event.clientY);
    if (store) openCard(store);
  });
  canvas.addEventListener("pointercancel", () => (tap = null));
}

// Start / pause overlay
function showOverlay() {
  overlay.hidden = false;
  startButton.textContent = "Continuar";
  startButton.focus({ preventScroll: true });
}

function hideOverlay() {
  overlay.hidden = true;
  message.textContent = "";
}

player.controls.addEventListener("lock", hideOverlay);
player.controls.addEventListener("unlock", () => {
  if (!cardOpen) showOverlay();
});
document.addEventListener("pointerlockerror", () => {
  message.textContent = "No se ha podido capturar el ratón. Espera un segundo y vuelve a hacer clic.";
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
  startButton.textContent = "Empezar a pasear";
} else if ("requestPointerLock" in Element.prototype) {
  startButton.disabled = false;
  startButton.textContent = "Empezar a pasear";
} else {
  startButton.textContent = "No compatible";
  message.textContent = "Este navegador no puede capturar el ratón. Prueba con Chrome, Edge, Firefox o Brave.";
}

// Render loop
const timer = new THREE.Timer();
timer.connect(document); // freezes the delta while the tab is hidden

// Desktop hint under the crosshair, checked ten times a second
let hintTimer = 0;
let hintStore = null;
function updateAimHint(delta) {
  hintTimer -= delta;
  if (hintTimer > 0) return;
  hintTimer = 0.1;
  const store = player.controls.isLocked ? storeAt(window.innerWidth / 2, window.innerHeight / 2) : null;
  if (store === hintStore) return;
  hintStore = store;
  aimHint.hidden = !store;
  if (store) aimHint.textContent = `${store.name} · clic para ver información`;
}

renderer.setAnimationLoop(() => {
  timer.update();
  const delta = timer.getDelta();
  player.update(delta);
  if (!touchMode) updateAimHint(delta);
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
