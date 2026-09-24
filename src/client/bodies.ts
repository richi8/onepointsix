import * as THREE from 'three';
import { HEAD_RADIUS, hitboxes, LEGS_RADIUS, TORSO_RADIUS } from '../shared/hitbox.ts';
import type { PlayerSnap, Team } from '../shared/protocol.ts';

// Everyone else, drawn from exactly the volumes hit detection uses: a head
// sphere, a torso and legs. Placeholder figures until chunk 9 brings animated
// characters, coloured by side: operators in grey-blue, guards in olive and
// target dummies in orange.

const FALL_TIME = 0.45;
const FLASH_TIME = 0.1;
const HEAD = 0xd8c3a0;
const TORSO: Record<Team, number> = { operator: 0x3f556e, guard: 0x5a6638, dummy: 0xc4652b };
const LEGS: Record<Team, number> = { operator: 0x2e3238, guard: 0x4a4636, dummy: 0x4a4636 };

const sphere = new THREE.SphereGeometry(1, 16, 12);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
const gun = new THREE.BoxGeometry(0.06, 0.08, 0.6);

interface Figure {
  group: THREE.Group;
  head: THREE.Mesh;
  torso: THREE.Mesh;
  legs: THREE.Mesh;
  gun: THREE.Mesh;
  materials: THREE.MeshStandardMaterial[];
  /** Seconds since it died, or -1 while alive. */
  deadFor: number;
  flash: number;
}

export class Bodies {
  private readonly scene: THREE.Scene;
  private readonly figures = new Map<number, Figure>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(players: readonly PlayerSnap[], dt: number): void {
    const seen = new Set<number>();
    for (const p of players) {
      seen.add(p.id);
      const f = this.figures.get(p.id) ?? this.create(p.id, p.team);
      this.pose(f, p, dt);
    }
    for (const [id, f] of this.figures) {
      if (seen.has(id)) continue;
      this.scene.remove(f.group);
      for (const m of f.materials) m.dispose();
      this.figures.delete(id);
    }
  }

  /** Flash a body white where a round landed. */
  flash(id: number): void {
    const f = this.figures.get(id);
    if (f) f.flash = FLASH_TIME;
  }

  private create(id: number, team: Team): Figure {
    const materials = [HEAD, TORSO[team], LEGS[team], 0x24262a].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    const [head, torso, legs, held] = [sphere, cylinder, cylinder, gun].map((geo, i) => {
      const mesh = new THREE.Mesh(geo, materials[i]);
      mesh.castShadow = true;
      return mesh;
    });
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    group.add(head, torso, legs, held);
    this.scene.add(group);
    const f = { group, head, torso, legs, gun: held, materials, deadFor: -1, flash: 0 };
    this.figures.set(id, f);
    return f;
  }

  private pose(f: Figure, p: PlayerSnap, dt: number): void {
    // Hitboxes of the same pose at the origin, facing -z: offsets in the figure's own space.
    const h = hitboxes({ x: 0, y: 0, z: 0, yaw: 0, duck: p.duck, lean: p.lean });
    f.group.position.set(p.x, p.y, p.z);
    f.group.rotation.y = p.yaw;
    f.head.position.set(h.headX, h.headY, h.headZ);
    f.head.scale.setScalar(HEAD_RADIUS);
    f.torso.position.set(h.torsoX, h.hipY, h.torsoZ);
    f.torso.scale.set(TORSO_RADIUS, h.neckY - h.hipY, TORSO_RADIUS);
    f.legs.position.set(0, 0, 0);
    f.legs.scale.set(LEGS_RADIUS, h.hipY, LEGS_RADIUS);
    f.gun.position.set(h.torsoX + 0.12, h.neckY - 0.12, -0.35);

    // Topple backward on death; stand straight back up on respawn.
    f.deadFor = p.dead ? Math.max(f.deadFor, 0) + dt : -1;
    const fall = f.deadFor < 0 ? 0 : Math.min(f.deadFor / FALL_TIME, 1);
    f.group.rotation.x = (fall * fall * Math.PI) / 2;

    f.flash = Math.max(f.flash - dt, 0);
    const glow = f.flash / FLASH_TIME;
    for (const m of f.materials) m.emissive.setScalar(glow * 0.8);
  }
}
