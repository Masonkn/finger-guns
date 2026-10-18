import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toon, withOutline } from './toon';

// Hand colours and thumb toppers. All toppers are original designs built from
// primitives, sized in hand-body units (the thumb is a capsule of radius 0.075
// whose tip sits at y ≈ 0.27 above the thumb pivot).

export interface HandColor {
  name: string;
  hex: number;
}

export const HAND_COLORS: HandColor[] = [
  { name: 'Peach', hex: 0xffd2b0 },
  { name: 'Tan', hex: 0xf1b48c },
  { name: 'Caramel', hex: 0xd99a6c },
  { name: 'Bronze', hex: 0xb87850 },
  { name: 'Cocoa', hex: 0x8d5a3b },
  { name: 'Cream', hex: 0xffe0c4 },
  { name: 'Blue', hex: 0x4a90ff },
  { name: 'Green', hex: 0x48d66e },
  { name: 'Purple', hex: 0xa66bff },
  { name: 'Gold', hex: 0xffc83a },
  { name: 'Red', hex: 0xff5a5a },
  { name: 'Pink', hex: 0xff8ad8 },
  { name: 'Teal', hex: 0x2fd6c8 },
  { name: 'Snow', hex: 0xf2f4fb },
];

export type TopperId =
  | 'none'
  | 'marine'
  | 'knight'
  | 'goldRing'
  | 'gemRing'
  | 'crown'
  | 'viking'
  | 'robot'
  | 'pirate'
  | 'wizard';

export const TOPPERS: { id: TopperId; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'marine', name: 'Space Helmet' },
  { id: 'knight', name: 'Knight' },
  { id: 'goldRing', name: 'Gold Ring' },
  { id: 'gemRing', name: 'Gem Ring' },
  { id: 'crown', name: 'Crown' },
  { id: 'viking', name: 'Viking' },
  { id: 'robot', name: 'Robot' },
  { id: 'pirate', name: 'Pirate' },
  { id: 'wizard', name: 'Wizard' },
];

export function isTopperId(v: unknown): v is TopperId {
  return TOPPERS.some((t) => t.id === v);
}

const OUTLINE = 0.022;
const THUMB_TIP_Y = 0.27;

function part(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  opts: { rot?: [number, number, number]; scale?: [number, number, number]; outline?: number } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  if (opts.rot) m.rotation.set(...opts.rot);
  if (opts.scale) m.scale.set(...opts.scale);
  m.castShadow = true;
  const o = opts.outline ?? OUTLINE;
  if (o > 0) withOutline(m, o);
  return m;
}

const glow = (color: number) => new THREE.MeshBasicMaterial({ color });

/** Builds a topper as a group to add to the hand's thumb pivot. Front of the hand is +x. */
export function buildTopper(id: TopperId): THREE.Group {
  const g = new THREE.Group();
  g.name = 'topper';
  switch (id) {
    case 'none':
      break;

    case 'marine': {
      // Chunky armoured helmet: rounded dome, glowing visor band, rebreather and side vents.
      const armour = toon(0x3f6fd8);
      const trim = toon(0xffc83a);
      const dark = toon(0x2b2f3e);
      g.add(part(new THREE.SphereGeometry(0.115, 20, 14), armour, [0, 0.26, 0], { scale: [1.05, 1.0, 1.0] }));
      g.add(part(new RoundedBoxGeometry(0.06, 0.05, 0.17, 2, 0.015), glow(0x6ff7ff), [0.1, 0.27, 0], { outline: 0.015 }));
      g.add(part(new RoundedBoxGeometry(0.07, 0.06, 0.09, 2, 0.02), dark, [0.095, 0.2, 0], { outline: 0.015 }));
      for (const z of [-1, 1]) {
        g.add(part(new THREE.CylinderGeometry(0.04, 0.045, 0.05, 14), trim, [0.0, 0.23, z * 0.115], { rot: [Math.PI / 2, 0, 0] }));
        g.add(part(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10), dark, [0.0, 0.23, z * 0.143], { rot: [Math.PI / 2, 0, 0], outline: 0 }));
      }
      g.add(part(new RoundedBoxGeometry(0.2, 0.04, 0.035, 2, 0.012), trim, [-0.01, 0.375, 0]));
      break;
    }

    case 'knight': {
      // Rounded great helm with a visor slit and a red plume.
      const steel = toon(0xc9d3e0);
      const plume = toon(0xff3b4a);
      const gold = toon(0xffc83a);
      g.add(part(new THREE.CapsuleGeometry(0.105, 0.07, 8, 18), steel, [0, 0.25, 0]));
      g.add(part(new RoundedBoxGeometry(0.03, 0.022, 0.15, 1, 0.008), glow(0x1a1422), [0.1, 0.28, 0], { outline: 0 }));
      g.add(part(new RoundedBoxGeometry(0.02, 0.1, 0.02, 1, 0.006), steel, [0.105, 0.22, 0], { outline: 0.012 }));
      g.add(part(new THREE.CylinderGeometry(0.02, 0.025, 0.04, 10), gold, [0, 0.4, 0]));
      const sph = new THREE.SphereGeometry(0.05, 14, 10);
      g.add(part(sph, plume, [-0.01, 0.44, 0], { scale: [1.3, 0.9, 0.8] }));
      g.add(part(sph, plume, [-0.08, 0.45, 0], { scale: [1.4, 0.85, 0.75] }));
      g.add(part(sph, plume, [-0.15, 0.41, 0], { scale: [1.3, 0.8, 0.7] }));
      break;
    }

    case 'goldRing': {
      // Band worn around the middle of the thumb.
      const gold = toon(0xffc83a, { emissive: 0x4a3000 });
      g.add(part(new THREE.TorusGeometry(0.09, 0.03, 12, 28), gold, [0, 0.13, 0], { rot: [Math.PI / 2, 0, 0] }));
      break;
    }

    case 'gemRing': {
      const silver = toon(0xe1e7f0);
      const gem = toon(0xc04dff, { emissive: 0x3a0a66 });
      g.add(part(new THREE.TorusGeometry(0.09, 0.026, 12, 28), silver, [0, 0.13, 0], { rot: [Math.PI / 2, 0, 0] }));
      g.add(part(new THREE.CylinderGeometry(0.04, 0.03, 0.03, 12), silver, [0.115, 0.13, 0], { rot: [0, 0, -Math.PI / 2] }));
      g.add(part(new THREE.OctahedronGeometry(0.06, 0), gem, [0.15, 0.13, 0], { scale: [0.8, 1, 1] }));
      break;
    }

    case 'crown': {
      const gold = toon(0xffc83a, { emissive: 0x3a2400 });
      g.add(part(new THREE.CylinderGeometry(0.105, 0.095, 0.075, 22), gold, [0, 0.27, 0]));
      const spike = new THREE.ConeGeometry(0.028, 0.08, 10);
      const ball = new THREE.SphereGeometry(0.018, 10, 8);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const x = Math.cos(a) * 0.088;
        const z = Math.sin(a) * 0.088;
        g.add(part(spike, gold, [x, 0.345, z], { outline: 0.012 }));
        g.add(part(ball, gold, [x, 0.39, z], { outline: 0.01 }));
      }
      const jewel = new THREE.SphereGeometry(0.022, 10, 8);
      g.add(part(jewel, glow(0xff3b4a), [0.105, 0.27, 0], { outline: 0.01 }));
      g.add(part(jewel, glow(0x37a8ff), [0.075, 0.27, 0.075], { outline: 0.01 }));
      g.add(part(jewel, glow(0x37a8ff), [0.075, 0.27, -0.075], { outline: 0.01 }));
      break;
    }

    case 'viking': {
      // Round steel cap with a brass band, nose guard and two curved horns.
      const steel = toon(0x9aa7b8);
      const brass = toon(0xc98a3a);
      const horn = toon(0xfff0d2);
      g.add(part(new THREE.SphereGeometry(0.11, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), steel, [0, 0.235, 0], { scale: [1, 1.15, 1] }));
      g.add(part(new THREE.CylinderGeometry(0.115, 0.115, 0.035, 22), brass, [0, 0.235, 0]));
      g.add(part(new RoundedBoxGeometry(0.025, 0.09, 0.025, 1, 0.008), brass, [0.112, 0.2, 0], { outline: 0.012 }));
      g.add(part(new RoundedBoxGeometry(0.2, 0.025, 0.022, 1, 0.008), brass, [0, 0.36, 0], { rot: [0, 0, 0], scale: [0.6, 1, 1], outline: 0.01 }));
      for (const z of [-1, 1]) {
        const tip = part(new THREE.ConeGeometry(0.035, 0.16, 12), horn, [0, 0.33, z * 0.15], { rot: [z * 0.9, 0, 0] });
        g.add(tip);
      }
      break;
    }

    case 'robot': {
      // Boxy head with screen eyes, a grille mouth, ear bolts and an antenna.
      const metal = toon(0xb9c4d0);
      const dark = toon(0x3a3f55);
      const bolt = toon(0xff8a2a);
      g.add(part(new RoundedBoxGeometry(0.19, 0.17, 0.2, 2, 0.03), metal, [0, 0.27, 0]));
      g.add(part(new RoundedBoxGeometry(0.02, 0.08, 0.16, 1, 0.008), dark, [0.095, 0.29, 0], { outline: 0 }));
      const eye = new THREE.SphereGeometry(0.024, 10, 8);
      g.add(part(eye, glow(0x5af0ff), [0.108, 0.295, 0.04], { outline: 0 }));
      g.add(part(eye, glow(0x5af0ff), [0.108, 0.295, -0.04], { outline: 0 }));
      for (let i = -1; i <= 1; i++) {
        g.add(part(new THREE.BoxGeometry(0.01, 0.025, 0.012), dark, [0.1, 0.215, i * 0.03], { outline: 0 }));
      }
      for (const z of [-1, 1]) {
        g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), bolt, [0, 0.27, z * 0.11], { rot: [Math.PI / 2, 0, 0] }));
      }
      g.add(part(new THREE.CylinderGeometry(0.009, 0.009, 0.08, 8), dark, [0, 0.39, 0], { outline: 0 }));
      g.add(part(new THREE.SphereGeometry(0.025, 10, 8), glow(0xff4d5e), [0, 0.435, 0], { outline: 0.01 }));
      break;
    }

    case 'pirate': {
      // Wide black tricorn-style hat with a gold trim and a gold coin badge.
      const felt = toon(0x2e2838);
      const gold = toon(0xffc83a);
      g.add(part(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 28), felt, [0, 0.25, 0], { scale: [1.25, 1, 1] }));
      g.add(part(new THREE.TorusGeometry(0.17, 0.012, 8, 32), gold, [0, 0.262, 0], { rot: [Math.PI / 2, 0, 0], scale: [1.25, 1, 1], outline: 0 }));
      g.add(part(new THREE.SphereGeometry(0.1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), felt, [0, 0.255, 0], { scale: [1.05, 1.15, 1] }));
      g.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 14), gold, [0.1, 0.31, 0], { rot: [0, 0, -Math.PI / 2 + 0.3] }));
      for (const z of [-1, 1]) {
        g.add(part(new RoundedBoxGeometry(0.16, 0.07, 0.025, 1, 0.01), felt, [-0.02, 0.3, z * 0.15], { rot: [z * 0.5, z * 0.35, 0] }));
      }
      break;
    }

    case 'wizard': {
      // Tall bent cone hat with a brim, band and little stars.
      const cloth = toon(0x6a3cff);
      const band = toon(0xffc83a);
      g.add(part(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 28), cloth, [0, 0.25, 0]));
      g.add(part(new THREE.CylinderGeometry(0.105, 0.11, 0.035, 22), band, [0, 0.275, 0]));
      g.add(part(new THREE.ConeGeometry(0.105, 0.26, 22), cloth, [0, 0.42, 0]));
      g.add(part(new THREE.ConeGeometry(0.045, 0.12, 14), cloth, [-0.04, 0.58, 0], { rot: [0, 0, 0.7] }));
      const star = new THREE.OctahedronGeometry(0.025, 0);
      g.add(part(star, glow(0xfff27a), [0.07, 0.4, 0.03], { outline: 0.008 }));
      g.add(part(star, glow(0xfff27a), [0.035, 0.47, -0.05], { scale: [0.7, 0.7, 0.7], outline: 0.008 }));
      g.add(part(star, glow(0xfff27a), [0.06, 0.34, -0.06], { scale: [0.8, 0.8, 0.8], outline: 0.008 }));
      break;
    }
  }
  // Head toppers read better a touch bigger in the isometric view; grow them around the thumb tip.
  if (id !== 'goldRing' && id !== 'gemRing') {
    const k = 1.2;
    g.scale.setScalar(k);
    g.position.y = THUMB_TIP_Y * (1 - k);
  }
  return g;
}

// --- Saved look ----------------------------------------------------------------

export interface PlayerLook {
  color: number;
  topper: TopperId;
}

const LOOK_KEY = 'finger-guns:look';
export const DEFAULT_LOOK: PlayerLook = { color: HAND_COLORS[0].hex, topper: 'none' };

export function loadLook(): PlayerLook {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    if (!raw) return { ...DEFAULT_LOOK };
    const v = JSON.parse(raw) as Partial<PlayerLook>;
    return {
      color: typeof v.color === 'number' ? v.color : DEFAULT_LOOK.color,
      topper: isTopperId(v.topper) ? v.topper : DEFAULT_LOOK.topper,
    };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function saveLook(look: PlayerLook) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {
    // Storage blocked (private mode etc.): the look just won't persist.
  }
}

export function randomLook(): PlayerLook {
  const color = HAND_COLORS[Math.floor(Math.random() * HAND_COLORS.length)].hex;
  // Mostly wear something, so matches look varied.
  const topper = Math.random() < 0.15 ? 'none' : TOPPERS[1 + Math.floor(Math.random() * (TOPPERS.length - 1))].id;
  return { color, topper };
}
