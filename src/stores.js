// Shopfronts and name signs, generated from data/stores-by-floor.json.
//
// v1 layout: every indoor store gets a unit along the walls of its floor, grouped by zone
// and sorted by name. Positions are made up; v2 replaces them with the real ones.
//
// Store text comes from scraped pages, so it is only ever drawn onto a canvas or set with
// textContent, never parsed as HTML.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MALL } from "./mall.js";

export const CATEGORY_GROUPS = [
  { id: "fashion", label: "Moda", color: "#c2456e", match: ["Moda", "Calzado", "Complementos", "Lencería"] },
  { id: "food", label: "Restauración", color: "#e07b39", match: ["Restaurante", "Comida rápida", "Cafeterías", "Bar", "Pub"] },
  { id: "home", label: "Hogar", color: "#4f9d69", match: ["Hogar"] },
  { id: "sport", label: "Deportes", color: "#2f7fc1", match: ["Deportes"] },
  { id: "tech", label: "Electrónica", color: "#6a5acd", match: ["Telefonía", "electrónica"] },
  { id: "beauty", label: "Salud y belleza", color: "#2aa3a3", match: ["Salud", "Peluquer", "Óptica"] },
  { id: "jewel", label: "Joyería", color: "#b8952e", match: ["Joyería"] },
  { id: "leisure", label: "Ocio y juguetes", color: "#d6463a", match: ["Juguetes", "Disfraces", "Manualidades", "Papelería", "Libros", "Ocio"] },
  { id: "grocery", label: "Alimentación", color: "#7a9a2e", match: ["Alimentación", "Hipermercado", "Grandes almacenes"] },
  { id: "other", label: "Servicios y otros", color: "#6b7785", match: [] },
];
const OTHER = CATEGORY_GROUPS[CATEGORY_GROUPS.length - 1];

// Which floor of the 3D model each data floor goes on. "Planta -1" (parking) has no model
// yet, so its few businesses sit on the ground floor. Outdoor stores are left out for now.
const FLOOR_OF = { "Planta Baja": 0, "Planta -1": 0, "Planta Alta": 1 };
const ZONE_RANK = { Gallery: 0, Terrazas: 1 };

const UNIT = 4; // shop width; two per 8 m bay between pilasters
const SIGN_W = 3.6;
const SIGN_H = 0.8;
const CELL_W = 360; // sign texture cell, same 4.5:1 shape as the sign
const CELL_H = 80;
const ATLAS_COLS = 5;

export async function loadStores(url = "data/stores-by-floor.json") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Store list: HTTP ${response.status}`);
  return parseStores(await response.json());
}

/** Turns the grouped JSON into a flat, validated list. Unknown shapes are skipped. */
export function parseStores(data) {
  const indoor = [];
  let outdoor = 0;
  if (!data || typeof data !== "object") return { indoor, outdoor };

  for (const [floorName, zones] of Object.entries(data)) {
    if (!zones || typeof zones !== "object") continue;
    const floor = Object.hasOwn(FLOOR_OF, floorName) ? FLOOR_OF[floorName] : null;
    for (const [zoneName, stores] of Object.entries(zones)) {
      if (!Array.isArray(stores)) continue;
      for (const raw of stores) {
        const name = cleanText(raw?.name, 60);
        if (!name) continue;
        if (floor === null) {
          outdoor++;
          continue;
        }
        const categories = Array.isArray(raw.categories) ? raw.categories.map((c) => cleanText(c, 40)).filter(Boolean) : [];
        indoor.push({
          name,
          floor,
          floorName,
          zone: cleanText(zoneName, 60),
          section: cleanText(raw.section, 20),
          categories,
          group: groupOf(categories, raw.section),
          phone: cleanPhone(raw.phone),
          hours: cleanText(raw.hours, 80),
          description: cleanText(raw.description, 400),
          services: cleanList(raw.services, 12, 60),
          extras: cleanList(raw.extra_options, 6, 60),
          url: safeStoreUrl(raw.url),
        });
      }
    }
  }
  return { indoor, outdoor };
}

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanList(value, maxItems, maxLength) {
  return Array.isArray(value) ? value.map((v) => cleanText(v, maxLength)).filter(Boolean).slice(0, maxItems) : [];
}

// Phone numbers become tel: links, so only digits, spaces and a leading + are kept.
function cleanPhone(value) {
  const text = cleanText(value, 30);
  return /^\+?[\d ]{6,}$/.test(text) ? text : "";
}

// Links open the mall's own store page, so anything not on puertovenecia.com over https is dropped.
function safeStoreUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "puertovenecia.com" && host !== "www.puertovenecia.com")) return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function groupOf(categories, section) {
  for (const category of categories) {
    const group = CATEGORY_GROUPS.find((g) => g.match.some((m) => category.includes(m)));
    if (group) return group;
  }
  if (section === "restaurantes") return CATEGORY_GROUPS.find((g) => g.id === "food");
  return OTHER;
}

/**
 * Shop units along the walls of one floor, in walking order around the building:
 * north wall west→east, east end, south wall east→west, west end.
 * Each unit is { floor, wall, a, width }, where `a` is the centre along the wall.
 */
export function wallSlots(floor) {
  const { halfX, halfZ, wallDepth } = MALL;
  const slots = [];

  // Long walls: pilasters every 8 m from -halfX + 2, each bay holds two units.
  const longUnits = [];
  for (let x = -halfX + 2; x + 8 <= halfX - 2 + 1e-6; x += 8) {
    longUnits.push(x + UNIT / 2, x + UNIT * 1.5);
  }

  // End walls: pilasters at z = -12, -4, 4, 12; 8 m bays hold two units, the corner bays one.
  const edge = halfZ - wallDepth;
  const endBays = [[-edge, -12], [-12, -4], [-4, 4], [4, 12], [12, edge]];
  const endUnits = [];
  for (const [z0, z1] of endBays) {
    if (floor === 0 && z0 >= -4 && z1 <= 4) continue; // ground-floor entrance
    const length = z1 - z0;
    if (length > 6) endUnits.push({ a: z0 + length / 4, width: length / 2 }, { a: z0 + (length * 3) / 4, width: length / 2 });
    else endUnits.push({ a: (z0 + z1) / 2, width: length });
  }

  for (const a of longUnits) slots.push({ floor, wall: "n", a, width: UNIT });
  for (const u of [...endUnits].reverse()) slots.push({ floor, wall: "e", ...u });
  for (const a of [...longUnits].reverse()) slots.push({ floor, wall: "s", a, width: UNIT });
  for (const u of endUnits) slots.push({ floor, wall: "w", ...u });
  return slots;
}

/** Spreads the stores of each floor over its units: zones stay together, gaps are spread out. */
export function assignStores(stores) {
  const placed = [];
  for (const floor of [0, 1]) {
    const slots = wallSlots(floor);
    const onFloor = stores
      .filter((s) => s.floor === floor)
      .sort((p, q) => (ZONE_RANK[p.zone] ?? 2) - (ZONE_RANK[q.zone] ?? 2) || p.zone.localeCompare(q.zone, "es") || p.name.localeCompare(q.name, "es"));

    if (onFloor.length > slots.length) {
      console.warn(`Floor ${floor}: ${onFloor.length} stores but only ${slots.length} units; ${onFloor.length - slots.length} not shown.`);
    }
    const count = Math.min(onFloor.length, slots.length);
    const used = new Set();
    for (let i = 0; i < count; i++) {
      const index = Math.floor((i * slots.length) / count);
      used.add(index);
      placed.push({ store: onFloor[i], slot: slots[index] });
    }
    slots.forEach((slot, index) => {
      if (!used.has(index)) placed.push({ store: null, slot });
    });
  }
  return placed;
}

// Wall frame: where a unit sits and which way it faces (local +z points into the mall).
function wallFrame(slot) {
  const { halfX, halfZ } = MALL;
  switch (slot.wall) {
    case "n": return { x: slot.a, z: halfZ, rotY: Math.PI };
    case "s": return { x: slot.a, z: -halfZ, rotY: 0 };
    case "e": return { x: halfX, z: slot.a, rotY: -Math.PI / 2 };
    default: return { x: -halfX, z: slot.a, rotY: Math.PI / 2 };
  }
}

/** World position in front of a unit, at the given height and distance from the wall. */
export function frontOf(slot, distance, height) {
  const f = wallFrame(slot);
  const base = slot.floor * MALL.floorHeight;
  return new THREE.Vector3(f.x + Math.sin(f.rotY) * distance, base + height, f.z + Math.cos(f.rotY) * distance);
}

/**
 * Which shop the ray points at ({ store, slot }), or null. The ray only picks units on the given floor,
 * up to maxDistance metres away. The shell is a box, so the first wall the ray meets from
 * inside is the one it hits; no triangle raycast is needed.
 */
export function createStorePicker(placed) {
  const { halfX, halfZ, floorHeight } = MALL;
  const face = 0.25; // shop windows sit this far out from the wall
  const byWall = new Map();
  for (const entry of placed) {
    if (!entry.store) continue;
    const key = `${entry.slot.floor}${entry.slot.wall}`;
    if (!byWall.has(key)) byWall.set(key, []);
    byWall.get(key).push(entry);
  }

  return function pick(origin, direction, floor, maxDistance) {
    let best = Infinity;
    let wall = null;
    const test = (t, name) => {
      if (t > 0 && t < best) {
        best = t;
        wall = name;
      }
    };
    if (direction.z > 1e-6) test((halfZ - face - origin.z) / direction.z, "n");
    if (direction.z < -1e-6) test((-halfZ + face - origin.z) / direction.z, "s");
    if (direction.x > 1e-6) test((halfX - face - origin.x) / direction.x, "e");
    if (direction.x < -1e-6) test((-halfX + face - origin.x) / direction.x, "w");
    if (!wall || best > maxDistance) return null;

    const y = origin.y + direction.y * best - floor * floorHeight;
    if (y < 0 || y > 5.6) return null; // below the floor or above the sign band
    const a = wall === "n" || wall === "s" ? origin.x + direction.x * best : origin.z + direction.z * best;
    const units = byWall.get(`${floor}${wall}`) ?? [];
    return units.find((u) => Math.abs(a - u.slot.a) <= u.slot.width / 2) ?? null;
  };
}

export function buildStores(scene, renderer, stores) {
  const placed = assignStores(stores);
  const group = new THREE.Group();
  group.name = "stores";

  const fronts = [];
  const signs = [];
  const color = new THREE.Color();
  const white = new THREE.Color(0xffffff);
  const dark = new THREE.Color(0x22272d);

  // A box in unit-local space (u along the wall, v out from the wall), coloured per vertex.
  const part = (slot, w, h, d, u, y, v, hex) => {
    const f = wallFrame(slot);
    const g = new THREE.BoxGeometry(w, h, d).translate(u, slot.floor * MALL.floorHeight + y, v);
    g.rotateY(f.rotY).translate(f.x, 0, f.z);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) hex.toArray(colors, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    fronts.push(g);
  };

  for (const { store, slot } of placed) {
    const w = slot.width;
    const glassW = w - 0.5;
    part(slot, 0.2, 4.6, 0.35, -w / 2, 2.3, 0.175, white); // unit dividers (hidden inside pilasters at bay edges)
    part(slot, 0.2, 4.6, 0.35, w / 2, 2.3, 0.175, white);
    part(slot, glassW, 0.3, 0.12, 0, 0.15, 0.24, dark); // kick plate

    if (store) {
      color.set(store.group.color).lerp(white, 0.55);
      part(slot, glassW, 4.2, 0.06, 0, 2.4, 0.22, color); // shop window
      color.set(store.group.color).multiplyScalar(0.45);
      part(slot, Math.min(1.6, glassW - 0.4), 2.6, 0.04, 0, 1.6, 0.27, color); // door
      signs.push({ store, slot });
    } else {
      part(slot, glassW, 4.2, 0.06, 0, 2.4, 0.22, color.set(0xb4b8bd)); // empty unit: closed shutter
    }
  }

  const frontMesh = new THREE.Mesh(mergeGeometries(fronts, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
  frontMesh.name = "shopfronts";
  for (const g of fronts) g.dispose();
  group.add(frontMesh);

  for (const mesh of buildSigns(signs, renderer)) group.add(mesh);

  scene.add(group);
  return { group, placed };
}

// All signs share a few canvas atlases (one per page), so the signs are one or two draw calls.
function buildSigns(signs, renderer) {
  const maxH = Math.min(4096, renderer.capabilities.maxTextureSize);
  const rowsPerPage = Math.floor(maxH / CELL_H);
  const perPage = rowsPerPage * ATLAS_COLS;
  const meshes = [];

  for (let start = 0; start < signs.length; start += perPage) {
    const page = signs.slice(start, start + perPage);
    const rows = Math.ceil(page.length / ATLAS_COLS);
    const canvas = document.createElement("canvas");
    canvas.width = CELL_W * ATLAS_COLS;
    canvas.height = CELL_H * rows;
    const ctx = canvas.getContext("2d");

    const geometries = page.map(({ store, slot }, i) => {
      const col = i % ATLAS_COLS;
      const row = Math.floor(i / ATLAS_COLS);
      drawSign(ctx, col * CELL_W, row * CELL_H, store);

      // Canvas textures are flipped (flipY), so canvas row 0 is the top of the v range.
      const inset = 1;
      const u0 = (col * CELL_W + inset) / canvas.width;
      const u1 = ((col + 1) * CELL_W - inset) / canvas.width;
      const v1 = 1 - (row * CELL_H + inset) / canvas.height;
      const v0 = 1 - ((row + 1) * CELL_H - inset) / canvas.height;

      const width = Math.min(SIGN_W, slot.width - 0.4);
      const g = new THREE.PlaneGeometry(width, SIGN_H * (width / SIGN_W));
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));

      const f = wallFrame(slot);
      g.translate(0, slot.floor * MALL.floorHeight + 5.1, MALL.wallDepth + 0.075);
      g.rotateY(f.rotY).translate(f.x, 0, f.z);
      return g;
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }); // signs keep their exact colours
    const mesh = new THREE.Mesh(mergeGeometries(geometries, false), material);
    mesh.name = "signs";
    for (const g of geometries) g.dispose();
    meshes.push(mesh);
  }
  return meshes;
}

function drawSign(ctx, x, y, store) {
  const pad = 14;
  const maxWidth = CELL_W - pad * 2;
  const background = store.group.color;
  const textColor = isLight(background) ? "#111418" : "#ffffff";

  ctx.fillStyle = background;
  ctx.fillRect(x, y, CELL_W, CELL_H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, CELL_W, CELL_H);
  ctx.clip();
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Name: as big as fits on one line, then cut with an ellipsis if it is still too long.
  const family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  let size = 40;
  ctx.font = `700 ${size}px ${family}`;
  while (size > 22 && ctx.measureText(store.name).width > maxWidth) {
    size -= 2;
    ctx.font = `700 ${size}px ${family}`;
  }
  ctx.fillText(fitText(ctx, store.name, maxWidth), x + CELL_W / 2, y + CELL_H * 0.42);

  const label = store.categories[0] || store.group.label;
  ctx.globalAlpha = 0.8;
  ctx.font = `500 15px ${family}`;
  ctx.fillText(fitText(ctx, label, maxWidth), x + CELL_W / 2, y + CELL_H * 0.82);
  ctx.restore();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function isLight(hex) {
  const c = new THREE.Color(hex); // linear values
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.4;
}
