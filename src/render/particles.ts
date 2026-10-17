import * as THREE from 'three';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
}

/** Pooled chunky cube particles for hits, puffs and crate debris. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private free: number[] = [];
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(private capacity = 600) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.parts.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0, gravity: 0 });
      this.free.push(i);
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
    this.mesh.count = capacity;
    this.hideAll();
  }

  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    color: THREE.ColorRepresentation,
    opts: { speed?: number; size?: number; life?: number; gravity?: number; up?: number } = {},
  ) {
    const speed = opts.speed ?? 3;
    for (let n = 0; n < count; n++) {
      const i = this.free.pop();
      if (i === undefined) return;
      const p = this.parts[i];
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = (opts.up ?? 2) * (0.5 + Math.random());
      p.maxLife = p.life = (opts.life ?? 0.5) * (0.6 + Math.random() * 0.6);
      p.size = (opts.size ?? 0.12) * (0.7 + Math.random() * 0.6);
      p.gravity = opts.gravity ?? 9;
      this.mesh.setColorAt(i, this.color.set(color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.free.push(i);
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0);
      } else {
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt;
        p.y = Math.max(0.05, p.y + p.vy * dt);
        p.z += p.vz * dt;
        const k = p.life / p.maxLife;
        this.dummy.position.set(p.x, p.y, p.z);
        this.dummy.rotation.set(p.life * 7, p.life * 5, 0);
        this.dummy.scale.setScalar(p.size * (0.3 + 0.7 * k));
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private hideAll() {
    this.dummy.position.set(0, -100, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
