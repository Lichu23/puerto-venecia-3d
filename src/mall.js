// Builds the mall shell: two floors around a central atrium, with walls, columns,
// glass railings and a skylight. All sizes are in metres.
//
// This is the generic v1 layout. Store fronts are added on top of it by stores.js,
// and in v2 the shape is adjusted to the real building.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const MALL = {
  halfX: 82, // inner face of the end walls (building is 164 m long: room for 92 ground-floor shops)
  halfZ: 18, // inner face of the long walls (building is 36 m wide)
  wallDepth: 0.5, // pilasters and fascias stick out this far from the walls
  floorHeight: 6,
  roofY: 12,
  slab: 0.4,
  voidHalfX: 66, // atrium opening in the upper floor
  voidHalfZ: 5,
  railGap: 0.1, // keeps the player this far from the glass railing
  columnRadius: 0.4,
};

export const FLOORS = [
  { id: "planta-baja", name: "Planta Baja", y: 0 },
  { id: "planta-alta", name: "Planta Alta", y: MALL.floorHeight },
];

// Atrium columns, just outside the opening on both sides.
const COLUMN_Z = MALL.voidHalfZ + 0.4;
export const COLUMNS = [];
for (let x = -MALL.voidHalfX; x <= MALL.voidHalfX; x += 22) {
  COLUMNS.push({ x, z: COLUMN_Z }, { x, z: -COLUMN_Z });
}

const TILE = 2; // floor tile size

/** True when a player of radius `r` can stand at (x, z) on the given floor. */
export function isWalkable(floorIndex, x, z, r) {
  const limitX = MALL.halfX - MALL.wallDepth - r;
  const limitZ = MALL.halfZ - MALL.wallDepth - r;
  if (Math.abs(x) > limitX || Math.abs(z) > limitZ) return false;

  if (floorIndex === 1) {
    const inVoidX = Math.abs(x) < MALL.voidHalfX + MALL.railGap + r;
    const inVoidZ = Math.abs(z) < MALL.voidHalfZ + MALL.railGap + r;
    if (inVoidX && inVoidZ) return false;
  }

  const minDist = MALL.columnRadius + r;
  for (const c of COLUMNS) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < minDist * minDist) return false;
  }
  return true;
}

/** Nearest walkable spot on the upper floor, for when the player arrives above the atrium. */
export function nearestWalkable(floorIndex, x, z, r) {
  if (isWalkable(floorIndex, x, z, r)) return { x, z };
  const side = z < 0 ? -1 : 1;
  return { x, z: side * (COLUMN_Z + MALL.columnRadius + r + 0.4) };
}

export function buildMall(scene, renderer) {
  const group = new THREE.Group();
  group.name = "mall";

  const materials = {
    floor: new THREE.MeshLambertMaterial({ map: makeTileTexture(renderer) }),
    wall: new THREE.MeshLambertMaterial({ color: 0xece8e1 }),
    trim: new THREE.MeshLambertMaterial({ color: 0xfafafa }),
    slab: new THREE.MeshLambertMaterial({ color: 0xdedad3 }),
    fascia: new THREE.MeshLambertMaterial({ color: 0x3b4149 }),
    metal: new THREE.MeshLambertMaterial({ color: 0x9aa3ad }),
    entrance: new THREE.MeshLambertMaterial({ color: 0x5d7f99 }),
    ceiling: new THREE.MeshLambertMaterial({ color: 0xf4f2ee, side: THREE.DoubleSide }),
    skylight: new THREE.MeshBasicMaterial({ color: 0xeaf4ff }),
    glass: new THREE.MeshBasicMaterial({
      color: 0xbfe0f0,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  };

  // Geometry is collected per material and merged, so the whole mall is about ten draw calls.
  const parts = Object.fromEntries(Object.keys(materials).map((k) => [k, []]));
  const box = (key, w, h, d, x, y, z) => {
    parts[key].push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  };

  const { halfX, halfZ, floorHeight, roofY, slab, voidHalfX, voidHalfZ, wallDepth } = MALL;
  const upperY = floorHeight;

  // Floors
  parts.floor.push(floorPlane(-halfX, halfX, -halfZ, halfZ, 0));
  const upperRects = [
    [-halfX, halfX, voidHalfZ, halfZ], // north walkway
    [-halfX, halfX, -halfZ, -voidHalfZ], // south walkway
    [voidHalfX, halfX, -voidHalfZ, voidHalfZ], // east end
    [-halfX, -voidHalfX, -voidHalfZ, voidHalfZ], // west end
  ];
  for (const [x0, x1, z0, z1] of upperRects) {
    parts.floor.push(floorPlane(x0, x1, z0, z1, upperY));
    // slab body, kept just under the tiles so they don't flicker
    box("slab", x1 - x0, slab, z1 - z0, (x0 + x1) / 2, upperY - slab / 2 - 0.01, (z0 + z1) / 2);
  }

  // Outer walls
  const wallT = 0.4;
  box("wall", halfX * 2 + wallT * 2, roofY, wallT, 0, roofY / 2, halfZ + wallT / 2);
  box("wall", halfX * 2 + wallT * 2, roofY, wallT, 0, roofY / 2, -halfZ - wallT / 2);
  box("wall", wallT, roofY, halfZ * 2, halfX + wallT / 2, roofY / 2, 0);
  box("wall", wallT, roofY, halfZ * 2, -halfX - wallT / 2, roofY / 2, 0);

  // Pilasters every 8 m give the walls rhythm (and mark future shop widths)
  for (let x = -halfX + 2; x <= halfX - 2; x += 8) {
    box("trim", 0.6, roofY, wallDepth, x, roofY / 2, halfZ - wallDepth / 2);
    box("trim", 0.6, roofY, wallDepth, x, roofY / 2, -halfZ + wallDepth / 2);
  }
  for (let z = -halfZ + 6; z <= halfZ - 6; z += 8) {
    box("trim", wallDepth, roofY, 0.6, halfX - wallDepth / 2, roofY / 2, z);
    box("trim", wallDepth, roofY, 0.6, -halfX + wallDepth / 2, roofY / 2, z);
  }

  // Fascia bands above the shopfronts on both floors (stores.js puts the name signs on them)
  for (const baseY of [0, upperY]) {
    const y = baseY + 5.1;
    for (const side of [1, -1]) {
      box("fascia", halfX * 2, 1, 0.06, 0, y, side * (halfZ - wallDepth - 0.03));
      box("fascia", 0.06, 1, halfZ * 2, side * (halfX - wallDepth - 0.03), y, 0);
    }
  }

  // Entrances at both ends of the ground floor
  for (const side of [1, -1]) {
    box("entrance", 0.1, 3.6, 8, side * (halfX - wallDepth - 0.05), 1.8, 0);
    box("metal", 0.12, 0.25, 8.4, side * (halfX - wallDepth - 0.05), 3.7, 0);
  }

  // Atrium columns, full height
  for (const c of COLUMNS) {
    parts.trim.push(new THREE.CylinderGeometry(MALL.columnRadius, MALL.columnRadius, roofY, 20).translate(c.x, roofY / 2, c.z));
  }

  // Glass railing and handrail around the atrium opening
  const railH = 1.1;
  const railY = upperY + railH / 2;
  const handY = upperY + railH + 0.03;
  const longLen = voidHalfX * 2;
  const shortLen = voidHalfZ * 2;
  for (const side of [1, -1]) {
    const z = side * (voidHalfZ + 0.02);
    box("glass", longLen, railH, 0.04, 0, railY, z);
    box("metal", longLen, 0.06, 0.1, 0, handY, z);
    const x = side * (voidHalfX + 0.02);
    box("glass", 0.04, railH, shortLen, x, railY, 0);
    box("metal", 0.1, 0.06, shortLen, x, handY, 0);
  }

  // Roof with a skylight over the atrium
  const ceiling = new THREE.PlaneGeometry(halfX * 2, halfZ * 2).rotateX(Math.PI / 2).translate(0, roofY, 0);
  parts.ceiling.push(ceiling);
  const skylight = new THREE.PlaneGeometry(longLen, shortLen).rotateX(Math.PI / 2).translate(0, roofY - 0.02, 0);
  parts.skylight.push(skylight);

  for (const [key, geometries] of Object.entries(parts)) {
    if (geometries.length === 0) continue;
    const merged = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    const mesh = new THREE.Mesh(merged, materials[key]);
    mesh.name = key;
    if (key === "glass") mesh.renderOrder = 1;
    group.add(mesh);
  }

  // Lighting: soft daylight from the skylight plus a sky/ground fill. No shadow maps (cheap on phones).
  // Ground colour stays near-white: it is what lights ceilings and slab undersides.
  const hemi = new THREE.HemisphereLight(0xffffff, 0xdcd9d3, 2.2);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.3);
  sun.position.set(20, 40, 12);
  group.add(hemi, sun);

  scene.add(group);
  return group;
}

/** Horizontal floor plane with tile UVs in world space, so tiles line up across pieces. */
function floorPlane(x0, x1, z0, z1, y) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / TILE, -pos.getZ(i) / TILE);
  }
  return g;
}

function makeTileTexture(renderer) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#dcd6cc";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#d3ccc1";
  ctx.fillRect(0, 0, size / 2, size / 2);
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
  ctx.strokeStyle = "#bfb7aa";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}
