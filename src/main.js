import * as THREE from "three";
import { buildEscalators } from "./escalators.js";
import { buildLaneLines } from "./lanes.js";
import { buildMall, FLOORS, isWalkable } from "./mall.js";
import { createArrows, createCursor } from "./markers.js";
import { createPlayer } from "./player.js";
import { buildStores, CATEGORY_GROUPS, createStorePicker, frontOf, loadStores } from "./stores.js";

const canvas = document.getElementById("scene");
const overlay = document.getElementById("overlay");
const startButton = document.getElementById("start");
const menuButton = document.getElementById("menu");
const message = document.getElementById("message");
const floorLabel = document.getElementById("floor-label");
const floorButtons = document.querySelectorAll(".floor-switch button");
const legend = document.getElementById("legend");
const storeCount = document.getElementById("store-count");
const aimHint = document.getElementById("aim-hint");
const card = document.getElementById("store-card");
const cardClose = document.getElementById("card-close");

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
renderer.localClippingEnabled = true; // escalator steps are clipped at the ends of the slope

const scene = new THREE.Scene();
const skyColor = new THREE.Color(0xcfd8e3);
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, 60, 170);

// Desktop screens get a wider view (less "zoomed in"); the mouse wheel zooms in and out.
const finePointer = window.matchMedia("(pointer: fine)").matches;
const FOV = { start: finePointer ? 82 : 70, min: 45, max: 95 };
const camera = new THREE.PerspectiveCamera(FOV.start, window.innerWidth / window.innerHeight, 0.1, 250);
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault(); // the page itself never scrolls
    camera.fov = THREE.MathUtils.clamp(camera.fov + Math.sign(event.deltaY) * 4, FOV.min, FOV.max);
    camera.updateProjectionMatrix();
  },
  { passive: false },
);

buildMall(scene, renderer);
buildLaneLines(scene);
const escalators = buildEscalators(scene);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Category legend in the start panel (textContent only: no HTML from data)
for (const group of CATEGORY_GROUPS) {
  const item = document.createElement("li");
  const swatch = document.createElement("span");
  swatch.className = "swatch";
  swatch.style.backgroundColor = group.color;
  item.append(swatch, group.label);
  legend.append(item);
}

// Stores load in the background; moving around can start before they appear.
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

const player = createPlayer(camera, canvas, {
  onFloorChange: (floor) => {
    floorLabel.textContent = floor.name;
    const index = FLOORS.indexOf(floor);
    for (const button of floorButtons) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.floor) === index));
    }
    destination = null;
  },
  onTap: (x, y, pointerType) => goTo(x, y, pointerType),
});

// Shop picking: the shop under the mouse or finger
const PICK_DISTANCE = 30; // metres
const STORE_VIEW_DISTANCE = 5; // aim this far out from a shopfront (the glide then snaps to a lane)
let pickStore = null;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function aimAt(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}

function storeAt(clientX, clientY) {
  if (!pickStore) return null;
  const ray = aimAt(clientX, clientY);
  return pickStore(ray.origin, ray.direction, player.floorIndex, PICK_DISTANCE);
}

const ESCALATOR_PICK_DISTANCE = 40; // metres
function escalatorUnder(clientX, clientY) {
  aimAt(clientX, clientY);
  return escalators.pick(raycaster, ESCALATOR_PICK_DISTANCE);
}

// Floor markers: the disc-and-chevron cursor (desktop hover, and where a glide is heading)
// and, on touch screens, the ring of arrows to tap.
const cursor = createCursor(scene);
const arrows = createArrows(scene);
const ARROW_STEP = 8; // metres one arrow tap moves
const floorHit = new THREE.Vector3();
const flatForward = new THREE.Vector3();

// Touch arrows show when the main pointer is a finger, or the last press was one.
const coarsePointer = window.matchMedia("(pointer: coarse)");
let touchInput = coarsePointer.matches;
canvas.addEventListener("pointerdown", (event) => (touchInput = event.pointerType !== "mouse" || coarsePointer.matches));

let destination = null; // { spot, dx, dz } of the current glide, shown by the cursor

/** Direction of the last leg of a lane path, for the chevron. */
function arrivalDirection(points) {
  for (let i = points.length - 1; i > 0; i--) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    const length = Math.hypot(dx, dz);
    if (length > 1e-3) return { dx: dx / length, dz: dz / length };
  }
  camera.getWorldDirection(flatForward);
  return { dx: flatForward.x, dz: flatForward.z };
}

/** Where a ray meets the current floor, or null. */
function floorPointOf(ray) {
  const y = player.floor.y;
  if (ray.direction.y > -1e-3) return null;
  return floorHit.copy(ray.origin).addScaledVector(ray.direction, (y - ray.origin.y) / ray.direction.y);
}

/** Where the cursor disc goes for a move to `spot`: under the pointer when that is on the floor. */
function cursorSpot(ray, spot) {
  const hit = floorPointOf(ray);
  return hit && isWalkable(player.floorIndex, hit.x, hit.z, 0) ? hit.clone() : spot;
}

function glideAlongMarked(points, spot, options) {
  destination = { spot, ...arrivalDirection(points) };
  return { ...options, onArrive: () => ((destination = null), options?.onArrive?.()) };
}

/** A click or tap: an arrow (touch), else an escalator, else the shop under it, else that spot on the floor. */
function goTo(clientX, clientY, pointerType) {
  const ray = aimAt(clientX, clientY);
  if (pointerType !== "mouse") {
    const hit = floorPointOf(ray);
    const move = hit && arrows.moveAt(hit.x, hit.z);
    if (move?.ride) {
      destination = null;
      return player.ride(move.ride);
    }
    if (move) {
      const end = move.points[move.points.length - 1];
      const spot = new THREE.Vector3(end.x, player.floor.y, end.z);
      return player.glideAlong(move.points, glideAlongMarked(move.points, spot));
    }
  }
  const escalator = escalatorUnder(clientX, clientY);
  if (escalator) {
    destination = null;
    return player.rideAt(escalator.side); // whichever of the pair goes to the other floor
  }
  const entry = storeAt(clientX, clientY);
  if (entry) return goToStore(entry);
  const spot = player.targetFromRay(ray);
  if (!spot) return;
  player.glideTo(spot, glideAlongMarked(player.pathTo(spot), cursorSpot(ray, spot)));
}

function goToStore({ store, slot }) {
  const front = frontOf(slot, STORE_VIEW_DISTANCE, 0);
  const shopWindow = frontOf(slot, 0.3, 3.2); // middle of the shop window, below the sign
  destination = null;
  player.glideTo(front, { lookAt: shopWindow, onArrive: () => openCard(store) });
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

  card.hidden = false;
  updateInput();
  cardClose.focus({ preventScroll: true });
}

function closeCard() {
  if (!cardOpen) return;
  cardOpen = false;
  card.hidden = true;
  updateInput();
}

cardClose.addEventListener("click", closeCard);
card.addEventListener("click", (event) => {
  if (event.target === card) closeCard(); // tap outside the panel
});

// Start / menu overlay
let started = false;
function showMenu() {
  overlay.hidden = false;
  startButton.textContent = "Continuar";
  updateInput();
  startButton.focus({ preventScroll: true });
}

function hideMenu() {
  if (!started) player.enter(); // walk in from the entrance doors
  started = true;
  overlay.hidden = true;
  message.textContent = "";
  updateInput();
}

// Moving and looking only work while nothing covers the 3D view.
function updateInput() {
  player.enabled = overlay.hidden && !cardOpen;
  menuButton.hidden = !started;
}

startButton.addEventListener("click", hideMenu);
menuButton.addEventListener("click", showMenu);

document.addEventListener("keydown", (event) => {
  if (event.code !== "Escape") return;
  if (cardOpen) closeCard();
  else if (!overlay.hidden) {
    if (started) hideMenu();
  } else showMenu();
});

for (const button of floorButtons) {
  button.addEventListener("click", () => player.setFloor(Number(button.dataset.floor)));
}

startButton.disabled = false;
startButton.textContent = "Empezar a pasear";
updateInput();

// Mouse hover: the marker on the floor, or the shop name next to the pointer.
let hover = null; // { x, y } of a mouse over the 3D view
canvas.addEventListener("pointermove", (event) => {
  hover = event.pointerType === "mouse" ? { x: event.clientX, y: event.clientY } : null;
});
canvas.addEventListener("pointerleave", () => (hover = null));

let hintText = null;
function updateMarkers(delta) {
  let hint = null;
  let shown = destination;
  if (hover && player.enabled && !player.dragging && !player.gliding) {
    if (escalatorUnder(hover.x, hover.y)) {
      hint = player.floorIndex === 0 ? "Escalera mecánica · clic para subir a Planta Alta" : "Escalera mecánica · clic para bajar a Planta Baja";
    } else {
      const store = storeAt(hover.x, hover.y)?.store;
      if (store) hint = `${store.name} · clic para ir`;
    }
    const ray = aimAt(hover.x, hover.y);
    const spot = hint ? null : player.targetFromRay(ray);
    shown = spot ? { spot: cursorSpot(ray, spot), ...arrivalDirection(player.pathTo(spot)) } : null;
  }
  cursor.show(shown?.spot ?? null, shown?.dx, shown?.dz);
  canvas.classList.toggle("over-store", hint !== null);

  if (hint !== hintText) {
    hintText = hint;
    aimHint.hidden = !hint;
    if (hint) aimHint.textContent = hint;
  }
  if (hint) aimHint.style.transform = `translate(calc(${hover.x}px - 50%), ${hover.y + 24}px)`;

  // Touch arrows: hidden while gliding, then fade back in around the new spot.
  if (touchInput && player.enabled && !player.gliding) {
    camera.getWorldDirection(flatForward);
    flatForward.y = 0;
    flatForward.normalize();
    arrows.update(player.moves(ARROW_STEP), camera, player.floor.y, flatForward, delta);
  } else {
    arrows.update(null);
  }
}

// Render loop
const timer = new THREE.Timer();
timer.connect(document); // freezes the delta while the tab is hidden

renderer.setAnimationLoop(() => {
  timer.update();
  const delta = timer.getDelta();
  player.update(delta);
  escalators.update(delta, reducedMotion.matches);
  updateMarkers(delta);
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
