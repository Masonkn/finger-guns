import * as THREE from 'three';
import type { Decal, Prop, ThemeLook } from './themes';
import { toon, withOutline } from './toon';

// Set dressing for map themes: the painted ground, decorations outside the arena,
// and things drifting through the air. None of it touches the game rules.

export function hash(a: number, b: number, c: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// --- Ground ------------------------------------------------------------------

/** Paints the arena floor: a two-tone checker, per-tile detail, and the odd decal. */
export function paintGround(look: ThemeLook, size: number, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size * px;
  const g = c.getContext('2d')!;
  const [light, dark] = look.ground;
  const [markLight, markDark] = look.marks;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let fill = (x + y) % 2 === 0 ? light : dark;
      if (look.pattern === 'stripes') fill = Math.floor(x / 2) % 2 === 0 ? light : dark; // mowed lanes
      if (look.pattern === 'gingham') {
        const n = (x % 2) + (y % 2);
        fill = n === 0 ? light : n === 1 ? dark : markDark;
      }
      g.fillStyle = fill;
      g.fillRect(x * px, y * px, px, px);
    }
  }

  if (look.pattern === 'camo') {
    // Overlapping blobs in three shades.
    const blobs = size * size * 0.6;
    for (let i = 0; i < blobs; i++) {
      g.fillStyle = [markLight, markDark, dark][i % 3];
      const bx = hash(i, 1, 2) * size * px;
      const by = hash(2, i, 1) * size * px;
      const r = px * (0.4 + hash(1, 2, i) * 0.6);
      g.beginPath();
      g.ellipse(bx, by, r * 1.4, r, hash(i, i, 3) * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.lineWidth = 2;
  g.lineCap = 'round';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let k = 0; k < 3; k++) {
        const tx = x * px + 4 + hash(x, y, k) * (px - 8);
        const ty = y * px + 6 + hash(y, x, k + 5) * (px - 10);
        const color = hash(x, k, y) < 0.5 ? markLight : markDark;
        if (look.pattern === 'grass' || look.pattern === 'stripes') {
          // Little V-shaped tufts.
          g.strokeStyle = color;
          g.beginPath();
          g.moveTo(tx - 3, ty - 4);
          g.lineTo(tx, ty + 1);
          g.lineTo(tx + 3, ty - 4);
          g.stroke();
        } else if (look.pattern === 'speckle') {
          g.fillStyle = color;
          g.beginPath();
          g.arc(tx, ty, 1.6 + hash(k, y, x) * 1.4, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }

  const decals = look.decals;
  if (decals) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (hash(x + 0.31, y, 9) >= decals.chance) continue;
        const color = decals.colors[Math.floor(hash(y, x, 11) * decals.colors.length)];
        g.save();
        g.translate(x * px + px / 2 + (hash(x, y, 12) - 0.5) * px * 0.3, y * px + px / 2 + (hash(y, x, 13) - 0.5) * px * 0.3);
        g.rotate(hash(x, y, 14) * Math.PI * 2);
        drawDecal(g, decals.shape, color, px * 0.32, decals.colors, x * size + y);
        g.restore();
      }
    }
  }
  return c;
}

function drawDecal(g: CanvasRenderingContext2D, shape: Decal, color: string, r: number, colors: string[], seed: number) {
  g.fillStyle = color;
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 1.2;
  switch (shape) {
    case 'flower': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.beginPath();
        g.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.42, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = color === '#ffe066' ? '#ff9a1f' : '#ffe066';
      g.beginPath();
      g.arc(0, 0, r * 0.32, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'heart':
      heartPath(g, r);
      g.fill();
      g.stroke();
      break;
    case 'shamrock': {
      for (let i = 0; i < 3; i++) {
        g.save();
        g.rotate((i / 3) * Math.PI * 2);
        g.translate(0, -r * 0.45);
        heartPath(g, r * 0.55);
        g.fill();
        g.restore();
      }
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(r * 0.3, r * 0.6, r * 0.1, r * 1.0);
      g.stroke();
      break;
    }
    case 'star':
      starPath(g, r, r * 0.45);
      g.fill();
      g.stroke();
      break;
    case 'leaf':
      g.beginPath();
      g.ellipse(0, 0, r * 0.45, r, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(0, r * 1.2);
      g.stroke();
      break;
    case 'egg':
      g.beginPath();
      g.ellipse(0, 0, r * 0.62, r * 0.85, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-r * 0.55, 0);
      g.lineTo(r * 0.55, 0);
      g.stroke();
      break;
    case 'confetti':
      for (let i = 0; i < 4; i++) {
        g.fillStyle = colors[(seed + i) % colors.length];
        g.save();
        g.translate((hash(seed, i, 1) - 0.5) * r * 2.4, (hash(i, seed, 2) - 0.5) * r * 2.4);
        g.rotate(hash(seed, i, 3) * Math.PI);
        g.fillRect(-r * 0.25, -r * 0.1, r * 0.5, r * 0.2);
        g.restore();
      }
      break;
    case 'coin':
      g.beginPath();
      g.arc(0, 0, r * 0.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      break;
  }
}

function heartPath(g: CanvasRenderingContext2D, r: number) {
  g.beginPath();
  g.moveTo(0, r * 0.9);
  g.bezierCurveTo(-r * 1.3, 0, -r * 0.7, -r * 1.0, 0, -r * 0.35);
  g.bezierCurveTo(r * 0.7, -r * 1.0, r * 1.3, 0, 0, r * 0.9);
  g.closePath();
}

function starPath(g: CanvasRenderingContext2D, outer: number, inner: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}

// --- Decorations outside the arena ------------------------------------------

/** Scatters the theme's props on the ground around the arena's rim. */
export function buildProps(kinds: Prop[], size: number): THREE.Group {
  const group = new THREE.Group();
  const count = 70;
  for (let i = 0; i < count; i++) {
    const side = i % 4;
    const along = -2 + hash(i, 3, 7) * (size + 4);
    const out = 1.4 + hash(7, i, 3) * 5;
    const x = side === 0 ? along : side === 1 ? along : side === 2 ? -out : size + out;
    const z = side === 0 ? -out : side === 1 ? size + out : along;
    const kind = kinds[Math.floor(hash(i, 9, 1) * kinds.length)];
    const prop = makeProp(kind, i);
    prop.position.set(x, 0, z);
    prop.rotation.y = hash(i, 1, 1) * Math.PI * 2;
    prop.scale.setScalar(0.85 + hash(1, i, 5) * 0.4);
    group.add(prop);
  }
  return group;
}

function part(geo: THREE.BufferGeometry, color: number, outline = 0.04): THREE.Mesh {
  const m = new THREE.Mesh(geo, toon(color));
  m.castShadow = true;
  if (outline > 0) withOutline(m, outline);
  return m;
}

function makeProp(kind: Prop, seed: number): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'pumpkin': {
      const body = part(new THREE.SphereGeometry(0.42, 14, 10), 0xf07a1a);
      body.scale.set(1, 0.72, 1);
      body.position.y = 0.3;
      const stem = part(new THREE.CylinderGeometry(0.05, 0.07, 0.2, 6), 0x4a7a2a, 0.02);
      stem.position.y = 0.66;
      g.add(body, stem);
      break;
    }
    case 'pine': {
      const trunk = part(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 6), 0x6a4426, 0.02);
      trunk.position.y = 0.25;
      g.add(trunk);
      for (let t = 0; t < 3; t++) {
        const cone = part(new THREE.ConeGeometry(0.75 - t * 0.18, 0.9, 8), 0x1f7a4a);
        cone.position.y = 0.75 + t * 0.5;
        g.add(cone);
        const cap = part(new THREE.ConeGeometry(0.42 - t * 0.1, 0.36, 8), 0xffffff, 0);
        cap.position.y = 0.75 + t * 0.5 + 0.28;
        g.add(cap);
      }
      break;
    }
    case 'gift': {
      const colors = [0xe8333a, 0x2f8a3a, 0x2a6ae6, 0xffd23a, 0xa34dff];
      const color = colors[seed % colors.length];
      const box = part(new THREE.BoxGeometry(0.6, 0.5, 0.6), color, 0.03);
      box.position.y = 0.25;
      const ribbonColor = color === 0xffd23a ? 0xe8333a : 0xffd23a;
      const r1 = part(new THREE.BoxGeometry(0.62, 0.52, 0.12), ribbonColor, 0);
      const r2 = part(new THREE.BoxGeometry(0.12, 0.52, 0.62), ribbonColor, 0);
      r1.position.y = r2.position.y = 0.25;
      g.add(box, r1, r2);
      break;
    }
    case 'snowman': {
      [0.38, 0.28, 0.2].reduce((y, r) => {
        const ball = part(new THREE.SphereGeometry(r, 14, 10), 0xffffff);
        ball.position.y = y + r;
        g.add(ball);
        return y + r * 1.7;
      }, 0);
      const nose = part(new THREE.ConeGeometry(0.05, 0.22, 6), 0xff8a1a, 0);
      nose.rotation.z = -Math.PI / 2;
      nose.position.set(0.28, 1.3, 0);
      g.add(nose);
      break;
    }
    case 'flag': {
      const pole = part(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), 0xd8d8e0, 0.02);
      pole.position.y = 1.1;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), toon(0xffffff, { map: flagTexture(), side: THREE.DoubleSide }));
      cloth.position.set(0.47, 1.85, 0);
      g.add(pole, cloth);
      break;
    }
    case 'egg': {
      const colors = [0xffb3d9, 0x9fe3ff, 0xfff07a, 0xc7a8ff, 0xa8f0c4];
      const egg = part(new THREE.SphereGeometry(0.3, 14, 10), colors[seed % colors.length]);
      egg.scale.set(1, 1.3, 1);
      egg.position.y = 0.38;
      g.add(egg);
      break;
    }
    case 'hay': {
      const bale = part(new THREE.CylinderGeometry(0.42, 0.42, 0.8, 14), 0xe2c25a);
      bale.rotation.z = Math.PI / 2;
      bale.position.y = 0.42;
      g.add(bale);
      break;
    }
    case 'palm': {
      const trunk = part(new THREE.CylinderGeometry(0.1, 0.16, 2.2, 7), 0xa0784a, 0.03);
      trunk.position.y = 1.1;
      trunk.rotation.z = 0.12;
      g.add(trunk);
      for (let i = 0; i < 6; i++) {
        const leaf = part(new THREE.SphereGeometry(0.5, 8, 6), 0x3fae3a, 0.03);
        leaf.scale.set(1.3, 0.12, 0.35);
        const a = (i / 6) * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.55 + 0.13, 2.1, Math.sin(a) * 0.55);
        leaf.rotation.y = -a;
        leaf.rotation.z = -0.35;
        g.add(leaf);
      }
      break;
    }
  }
  return g;
}

let flagTex: THREE.CanvasTexture | null = null;

function flagTexture(): THREE.CanvasTexture {
  if (flagTex) return flagTex;
  const c = document.createElement('canvas');
  c.width = 76;
  c.height = 52;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 === 0 ? '#c8263a' : '#ffffff';
    g.fillRect(0, i * 4, 76, 4);
  }
  g.fillStyle = '#1f3a8a';
  g.fillRect(0, 0, 32, 28);
  g.fillStyle = '#ffffff';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) g.fillRect(3 + x * 6, 3 + y * 6, 2, 2);
  flagTex = new THREE.CanvasTexture(c);
  flagTex.colorSpace = THREE.SRGBColorSpace;
  return flagTex;
}

// --- Things in the air -------------------------------------------------------

interface Flake {
  x: number;
  y: number;
  z: number;
  speed: number;
  phase: number;
  spin: number;
}

const SPREAD = 16; // half-width of the box of air kept around the camera
const TOP = 8;

/** Snow, leaves, petals or confetti drifting down around the camera (embers float up). */
export class AmbientFall {
  readonly mesh: THREE.InstancedMesh;
  private flakes: Flake[] = [];
  private dummy = new THREE.Object3D();
  private time = 0;
  private rise: boolean;

  constructor(private kind: NonNullable<ThemeLook['ambient']>['kind'], colors: number[], count: number) {
    const round = kind === 'snow' || kind === 'embers' || kind === 'sparkle';
    const geo = round ? new THREE.IcosahedronGeometry(kind === 'snow' ? 0.06 : 0.045, 0) : new THREE.PlaneGeometry(0.16, 0.1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.rise = kind === 'embers';
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.flakes.push({
        x: (Math.random() * 2 - 1) * SPREAD,
        y: Math.random() * TOP,
        z: (Math.random() * 2 - 1) * SPREAD,
        speed: this.baseSpeed() * (0.7 + Math.random() * 0.6),
        phase: Math.random() * Math.PI * 2,
        spin: 1 + Math.random() * 3,
      });
      this.mesh.setColorAt(i, col.set(colors[i % colors.length]));
    }
  }

  private baseSpeed(): number {
    switch (this.kind) {
      case 'snow':
        return 1.0;
      case 'confetti':
        return 1.3;
      case 'leaves':
        return 0.9;
      case 'petals':
        return 0.6;
      case 'embers':
        return 0.5;
      case 'sparkle':
        return 0.15;
    }
  }

  /** `cx, cz` is the point on the ground the camera looks at. */
  update(dt: number, cx: number, cz: number) {
    this.time += dt;
    this.flakes.forEach((f, i) => {
      f.y += (this.rise ? 1 : -1) * f.speed * dt;
      if (f.y < 0) f.y += TOP;
      if (f.y > TOP) f.y -= TOP;
      // Keep the box of air centred on the camera by wrapping flakes round it.
      f.x = wrap(f.x, cx);
      f.z = wrap(f.z, cz);
      const sway = this.kind === 'sparkle' ? 0 : Math.sin(this.time * 1.3 + f.phase) * 0.35;
      this.dummy.position.set(f.x + sway, f.y, f.z + sway * 0.5);
      this.dummy.rotation.set(this.time * f.spin, f.phase + this.time * f.spin * 0.7, 0);
      const twinkle = this.kind === 'sparkle' || this.kind === 'embers' ? 0.5 + 0.5 * Math.sin(this.time * 4 + f.phase) : 1;
      this.dummy.scale.setScalar(twinkle);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function wrap(v: number, centre: number): number {
  const span = SPREAD * 2;
  let d = v - centre;
  d = ((((d + SPREAD) % span) + span) % span) - SPREAD;
  return centre + d;
}
