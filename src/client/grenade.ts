import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A fragmentation grenade, built from shapes: an egg-shaped olive body, the
// fuse on top, the spoon down its side and the pin's ring. Its origin is the
// middle of the body, the fuse up +y and the spoon on the +x side. One size,
// 10 cm tall; the hands and the world draw it as it is.

const BODY = new THREE.MeshStandardMaterial({ color: 0x46512f, roughness: 0.75 });
const METAL = new THREE.MeshStandardMaterial({ color: 0x8a8a82, roughness: 0.45, metalness: 0.7 });

function bodyGeometry(): THREE.BufferGeometry {
  // A lathed egg, a little wider below the middle.
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    const r = Math.sin(a) * 0.029 * (1 + 0.08 * Math.cos(a));
    points.push(new THREE.Vector2(Math.max(r, 1e-4), -Math.cos(a) * 0.036));
  }
  return new THREE.LatheGeometry(points, 14);
}

function metalGeometry(): THREE.BufferGeometry {
  const fuse = new THREE.CylinderGeometry(0.011, 0.013, 0.02, 10).translate(0, 0.043, 0);
  const cap = new THREE.CylinderGeometry(0.008, 0.011, 0.006, 10).translate(0, 0.056, 0);
  // The spoon: a strip from the fuse head down the side, bowed out over the body.
  const spoon = new THREE.BoxGeometry(0.004, 0.058, 0.012).rotateZ(-0.35).translate(0.03, 0.022, 0);
  const lip = new THREE.BoxGeometry(0.02, 0.004, 0.012).translate(0.016, 0.052, 0);
  const ring = new THREE.TorusGeometry(0.011, 0.0018, 5, 14).rotateY(Math.PI / 2).translate(-0.004, 0.05, 0.017);
  const pin = new THREE.CylinderGeometry(0.0013, 0.0013, 0.026, 5).rotateX(Math.PI / 2).translate(-0.004, 0.047, 0.004);
  return mergeGeometries([fuse, cap, spoon, lip, ring, pin])!;
}

const GEOMETRY = { body: bodyGeometry(), metal: metalGeometry() };

/** A new grenade, sharing its geometry and materials with every other. */
export function grenadeModel(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEOMETRY.body, BODY);
  const metal = new THREE.Mesh(GEOMETRY.metal, METAL);
  body.castShadow = metal.castShadow = true;
  g.add(body, metal);
  return g;
}
