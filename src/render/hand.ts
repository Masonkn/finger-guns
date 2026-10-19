import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GloveId, TopperId, buildTopper, gloveColor } from './cosmetics';
import { toon, withOutline } from './toon';

// A chunky right hand making a finger gun. Local +x is where it points.

const palmGeo = new RoundedBoxGeometry(0.42, 0.36, 0.26, 4, 0.09);
const fingerGeo = new THREE.CapsuleGeometry(0.075, 0.3, 6, 12);
const curledGeo = new THREE.CapsuleGeometry(0.068, 0.1, 6, 12);
const thumbGeo = new THREE.CapsuleGeometry(0.075, 0.16, 6, 12);
const cuffGeo = new THREE.CylinderGeometry(0.19, 0.2, 0.2, 20);
const bandGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.05, 20);
const gloveCuffGeo = new THREE.CylinderGeometry(0.24, 0.2, 0.1, 20); // flares toward the wrist
const ringGeo = new THREE.RingGeometry(0.58, 0.72, 40);
const nailGeo = new THREE.CircleGeometry(0.045, 12);
const shieldGeo = new THREE.SphereGeometry(0.95, 28, 18);

const BASE_Y = 0.78;
const SCALE = 1.6;
// Knuckle heights on the palm, index finger first. Collected fingers open from these
// slots in order and point straight ahead, side by side like a real finger gun.
const KNUCKLE_Y = [0.1, -0.01, -0.095, -0.18];

/** Colours of a dropped finger: its owner's skin, with a cuff in their sleeve colour. */
export interface FingerLook {
  skin: number;
  sleeve: number;
}

/** Whose hand this is, from the local player's point of view; sets the ring colour under it. */
export type HandRole = 'me' | 'ally' | 'enemy';
const RING_COLORS: Record<HandRole, number> = { me: 0x37d3ff, ally: 0x4f7dff, enemy: 0xff3b4a };

export class HandModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private thumbPivot = new THREE.Group();
  private fingers = new THREE.Group();
  private ring: THREE.Mesh;
  private shield: THREE.Mesh;
  private materials: THREE.Material[] = [];
  private fingerCount = 0;
  private topper: THREE.Group | null = null;
  private recoil = 0;
  private superFlash = 0;
  private rapid = 0;
  private shieldOn = 0;
  private bobPhase = Math.random() * 10;
  private deathT = -1;
  private skinMat: THREE.MeshToonMaterial;
  private nailMat: THREE.MeshBasicMaterial;
  private sleeveMat: THREE.MeshToonMaterial;
  private bandMat: THREE.MeshToonMaterial;
  private gloveCuff: THREE.Mesh;
  private skinColor: number;
  private glove: GloveId = 'none';
  private mask: THREE.Group | null = null;
  private maskOn = false;
  private maskLift = 1; // 0 over the eyes, 1 lifted all the way off

  constructor(sleeveColor: number, role: HandRole, skinColor: number, topper: TopperId = 'none', glove: GloveId = 'none') {
    // With a glove on, the "skin" material shows the glove colour instead.
    const skin = toon(skinColor);
    this.skinMat = skin;
    this.skinColor = skinColor;
    const sleeve = toon(sleeveColor);
    this.sleeveMat = sleeve;
    const band = toon(0xffffff);
    this.bandMat = band;
    this.nailMat = new THREE.MeshBasicMaterial({ color: 0xfff1ea });
    this.materials.push(skin, sleeve, band, this.nailMat);

    const palm = addMesh(palmGeo, skin);
    this.body.add(palm);
    this.body.add(this.fingers);
    this.setFingerCount(1);

    this.thumbPivot.position.set(0.0, 0.15, 0.06);
    const thumb = addMesh(thumbGeo, skin);
    thumb.position.set(0, 0.12, 0);
    this.thumbPivot.add(thumb);
    this.body.add(this.thumbPivot);
    this.setTopper(topper);

    const cuff = addMesh(cuffGeo, sleeve, 0.04);
    cuff.rotation.z = Math.PI / 2;
    cuff.position.set(-0.3, -0.01, 0);
    this.body.add(cuff);
    const bandMesh = new THREE.Mesh(bandGeo, band);
    bandMesh.rotation.z = Math.PI / 2;
    bandMesh.position.set(-0.22, -0.01, 0);
    this.body.add(bandMesh);
    this.gloveCuff = addMesh(gloveCuffGeo, skin, 0.035);
    this.gloveCuff.rotation.z = Math.PI / 2;
    this.gloveCuff.position.set(-0.17, -0.01, 0);
    this.body.add(this.gloveCuff);
    this.setSleeveColor(sleeveColor);
    this.setGlove(glove);

    this.body.rotation.order = 'YZX';
    this.body.scale.setScalar(SCALE);
    this.body.position.y = BASE_Y;
    this.root.add(this.body);

    const ringMat = new THREE.MeshBasicMaterial({
      color: RING_COLORS[role],
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.materials.push(ringMat);
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.root.add(this.ring);

    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x7fe8ff,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.materials.push(shieldMat);
    this.shield = new THREE.Mesh(shieldGeo, shieldMat);
    this.shield.position.y = 0.85;
    this.shield.visible = false;
    const shieldRim = new THREE.Mesh(shieldGeo, new THREE.MeshBasicMaterial({ color: 0xd9fbff, side: THREE.BackSide, transparent: true, opacity: 0.55, depthWrite: false }));
    shieldRim.scale.setScalar(1.04);
    this.shield.add(shieldRim);
    this.root.add(this.shield);
  }

  setSkinColor(color: number) {
    this.skinColor = color;
    this.skinMat.color.set(gloveColor(this.glove) ?? color);
  }

  /** Puts on a glove (or takes it off): palm, fingers and thumb take its colour, nails hide. */
  setGlove(id: GloveId) {
    this.glove = id;
    const color = gloveColor(id);
    this.skinMat.color.set(color ?? this.skinColor);
    this.nailMat.visible = color === null;
    this.gloveCuff.visible = color !== null;
  }

  setSleeveColor(color: number) {
    this.sleeveMat.color.set(color);
    this.bandMat.color.set(color).lerp(new THREE.Color(0xffffff), 0.55);
  }

  setRingVisible(visible: boolean) {
    this.ring.visible = visible;
  }

  /** Swaps the cosmetic worn on the thumb. It rides on the thumb pivot, so it follows the hammer animation. */
  setTopper(id: TopperId) {
    if (this.topper) {
      this.topper.removeFromParent();
      disposeTree(this.topper);
      // Topper geometries are built per topper, so they can go too.
      this.topper.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name !== 'outline') o.geometry.dispose();
      });
    }
    this.topper = buildTopper(id);
    this.thumbPivot.add(this.topper);
  }

  /**
   * Rebuilds the fingers: the index finger plus one per collected finger, each opening
   * straight out of the fist from the next knuckle down. The rest stay curled.
   */
  setFingerCount(count: number) {
    const n = Math.max(1, Math.min(KNUCKLE_Y.length, count));
    if (n === this.fingerCount) return;
    this.fingerCount = n;
    for (const child of [...this.fingers.children]) {
      child.removeFromParent();
      child.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) o.material.dispose();
      });
    }

    for (let k = 0; k < n; k++) {
      const finger = addMesh(fingerGeo, this.skinMat);
      finger.rotation.z = -Math.PI / 2;
      finger.position.set(0.36, KNUCKLE_Y[k], 0);
      this.fingers.add(finger);
      const nail = new THREE.Mesh(nailGeo, this.nailMat);
      nail.position.set(0.5, KNUCKLE_Y[k] + 0.055, 0);
      nail.rotation.x = -Math.PI / 2;
      this.fingers.add(nail);
    }

    // The fingers that haven't opened yet stay curled in their own knuckle slots.
    for (let k = n; k < KNUCKLE_Y.length; k++) {
      const f = addMesh(curledGeo, this.skinMat, 0.038);
      f.rotation.x = Math.PI / 2;
      f.position.set(0.21, KNUCKLE_Y[k], 0);
      this.fingers.add(f);
    }
  }

  shoot(isSuper: boolean) {
    this.recoil = isSuper ? 1.6 : 1;
    if (isSuper) this.superFlash = 1;
  }

  die() {
    if (this.deathT < 0) this.deathT = 0;
  }

  /** Back on its feet for a new prop hunt round. */
  revive() {
    if (this.deathT < 0) return;
    this.deathT = -1;
    this.body.rotation.x = 0;
    this.body.position.y = BASE_Y;
    this.ring.visible = true;
  }

  /** Hides the hand itself, for a prop hunt hider wearing a block disguise. */
  setBodyVisible(visible: boolean) {
    this.body.visible = visible;
  }

  /**
   * The prop hunt seeker's sleep mask: a padded band over the knuckles with closed eyes
   * drawn on. Taking it off lifts it up and away rather than snapping it out.
   */
  setSleepMask(on: boolean) {
    if (on && !this.mask) this.mask = this.buildMask();
    if (on) this.maskLift = 0;
    this.maskOn = on;
  }

  private buildMask(): THREE.Group {
    const g = new THREE.Group();
    const cloth = toon(0x3b2d7a);
    const trim = toon(0xff8fc4);
    const ink = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.materials.push(cloth, trim, ink);
    const band = addMesh(new RoundedBoxGeometry(0.3, 0.44, 0.34, 3, 0.08), cloth, 0.03);
    g.add(band);
    for (const z of [-0.18, 0.18]) {
      const edge = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.46, 0.03, 2, 0.012), trim);
      edge.position.z = z;
      g.add(edge);
    }
    // Two sleepy closed eyes on top, like the eyes printed on a real sleep mask.
    for (const z of [-0.075, 0.075]) {
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 14, Math.PI), ink);
      eye.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      eye.position.set(0.0, 0.225, z);
      g.add(eye);
    }
    g.position.set(0.05, 0.02, 0);
    this.body.add(g);
    return g;
  }

  get dead() {
    return this.deathT >= 0;
  }

  /** Ability visuals: a bubble while shielded, a hot glow while rapid firing. */
  setEffects(shielded: boolean, rapidFiring: boolean) {
    this.shieldOn = shielded ? 1 : 0;
    this.rapid = rapidFiring ? 1 : 0;
  }

  /** Called every frame with the brawler's sim state. */
  update(dt: number, x: number, y: number, facing: number, moving: boolean, hidden: boolean) {
    this.root.position.set(x, 0, y);
    this.root.visible = !hidden || this.dead;

    if (this.deathT >= 0) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.5);
      this.body.rotation.x = t * (Math.PI / 2);
      this.body.position.y = BASE_Y - t * 0.5;
      this.ring.visible = false;
      this.shield.visible = false;
      if (this.deathT > 2.5) this.root.visible = false;
      return;
    }

    // Smoothly turn toward the aim direction.
    const target = -facing;
    let delta = target - this.body.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.body.rotation.y += delta * Math.min(1, dt * 22);

    this.bobPhase += dt * (moving ? 14 : 3);
    const bob = Math.sin(this.bobPhase) * (moving ? 0.07 : 0.025);

    this.recoil = Math.max(0, this.recoil - dt * 6);
    const kick = easeOut(this.recoil);
    const dir = this.body.rotation.y;
    // Kick back along the aim direction and tip the finger up.
    this.body.position.x = -Math.cos(-dir) * kick * 0.22;
    this.body.position.z = -Math.sin(-dir) * kick * 0.22;
    this.body.position.y = BASE_Y + bob + kick * 0.05;
    this.body.rotation.z = kick * 0.45;
    this.body.rotation.x = moving ? Math.sin(this.bobPhase * 0.5) * 0.08 : 0;
    // Thumb is the hammer: cocked back at rest, slams forward on each shot.
    this.thumbPivot.rotation.z = 0.35 - kick * 1.3;

    this.superFlash = Math.max(0, this.superFlash - dt * 2.5);
    const heat = this.rapid * (0.35 + 0.2 * Math.sin(this.bobPhase * 3));
    const glowAmount = Math.max(this.superFlash, heat);
    this.skinMat.emissive.setRGB(glowAmount * 0.9, glowAmount * (this.rapid ? 0.35 : 0.6), 0);

    if (this.mask) {
      if (!this.maskOn) this.maskLift = Math.min(1, this.maskLift + dt * 1.4);
      const t = easeOut(this.maskLift);
      this.mask.position.y = 0.02 + t * 0.9;
      this.mask.rotation.z = t * 0.8;
      this.mask.scale.setScalar(1 - t * 0.5);
      this.mask.visible = this.maskLift < 1;
    }

    this.shield.visible = this.shieldOn > 0;
    if (this.shield.visible) {
      const pulse = 1 + Math.sin(this.bobPhase * 4) * 0.03;
      this.shield.scale.setScalar(pulse);
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    disposeTree(this.root);
  }
}

/** A loose finger for drop pickups: skin coloured, with a cuff in the owner's sleeve colour. */
export function buildFingerTrophy(look: FingerLook): THREE.Group {
  const g = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = -0.5;
  tilt.scale.setScalar(1.5);
  const finger = addMesh(fingerGeo, toon(look.skin), 0.045);
  finger.position.y = 0.06;
  tilt.add(finger);
  const nail = new THREE.Mesh(nailGeo, new THREE.MeshBasicMaterial({ color: 0xfff1ea }));
  nail.position.set(0.055, 0.2, 0);
  nail.rotation.y = Math.PI / 2;
  tilt.add(nail);
  const cuff = addMesh(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 16), toon(look.sleeve), 0.035);
  cuff.position.y = -0.14;
  tilt.add(cuff);
  g.add(tilt);
  return g;
}

function addMesh(geo: THREE.BufferGeometry, mat: THREE.Material, outline = 0.042) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  if (outline > 0) withOutline(m, outline);
  return m;
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) m.dispose();
  });
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}
