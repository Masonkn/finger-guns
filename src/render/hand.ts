import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TopperId, buildTopper } from './cosmetics';
import { toon, withOutline } from './toon';

// A chunky right hand making a finger gun. Local +x is where it points.

const palmGeo = new RoundedBoxGeometry(0.42, 0.36, 0.26, 4, 0.09);
const fingerGeo = new THREE.CapsuleGeometry(0.075, 0.3, 6, 12);
const curledGeo = new THREE.CapsuleGeometry(0.068, 0.1, 6, 12);
const thumbGeo = new THREE.CapsuleGeometry(0.075, 0.16, 6, 12);
const cuffGeo = new THREE.CylinderGeometry(0.19, 0.2, 0.2, 20);
const bandGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.05, 20);
const ringGeo = new THREE.RingGeometry(0.58, 0.72, 40);
const nailGeo = new THREE.CircleGeometry(0.045, 12);
const fingerBandGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.05, 14);
const shieldGeo = new THREE.SphereGeometry(0.95, 28, 18);

const BASE_Y = 0.78;
const SCALE = 1.6;
const FAN_ANGLE = 0.17; // radians between pointing fingers; wider than the bullet spread so it reads

/** Colours of a finger taken from another hand: its skin and a band in its sleeve colour. */
export interface FingerLook {
  skin: number;
  sleeve: number;
}

export class HandModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private thumbPivot = new THREE.Group();
  private fingers = new THREE.Group();
  private ring: THREE.Mesh;
  private shield: THREE.Mesh;
  private materials: THREE.Material[] = [];
  private fingerMaterials: THREE.Material[] = [];
  private fingerKey = '';
  private topper: THREE.Group | null = null;
  private recoil = 0;
  private superFlash = 0;
  private rapid = 0;
  private shieldOn = 0;
  private bobPhase = Math.random() * 10;
  private deathT = -1;
  private skinMat: THREE.MeshToonMaterial;
  private nailMat: THREE.MeshBasicMaterial;

  constructor(sleeveColor: number, isPlayer: boolean, skinColor: number, topper: TopperId = 'none') {
    const skin = toon(skinColor);
    this.skinMat = skin;
    const sleeve = toon(sleeveColor);
    const band = toon(new THREE.Color(sleeveColor).lerp(new THREE.Color(0xffffff), 0.55));
    this.nailMat = new THREE.MeshBasicMaterial({ color: 0xfff1ea });
    this.materials.push(skin, sleeve, band, this.nailMat);

    const palm = addMesh(palmGeo, skin);
    this.body.add(palm);
    this.body.add(this.fingers);
    this.setExtraFingers([]);

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

    this.body.rotation.order = 'YZX';
    this.body.scale.setScalar(SCALE);
    this.body.position.y = BASE_Y;
    this.root.add(this.body);

    const ringMat = new THREE.MeshBasicMaterial({
      color: isPlayer ? 0x37d3ff : 0xff3b4a,
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
    this.skinMat.color.set(color);
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
   * Rebuilds the pointing fingers: the index finger plus one per collected finger,
   * fanned so the silhouette grows. Curled fingers are used up first.
   */
  setExtraFingers(extras: FingerLook[]) {
    const key = extras.map((f) => `${f.skin}/${f.sleeve}`).join(',');
    if (key === this.fingerKey && this.fingers.children.length) return;
    this.fingerKey = key;
    for (const child of [...this.fingers.children]) {
      child.removeFromParent();
      child.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) o.material.dispose();
      });
    }
    for (const m of this.fingerMaterials) m.dispose();
    this.fingerMaterials = [];

    const n = 1 + extras.length;
    for (let k = 0; k < n; k++) {
      const pivot = new THREE.Group();
      pivot.position.set(0.14, 0.1 - k * 0.06, (k - (n - 1) / 2) * 0.03);
      pivot.rotation.y = ((n - 1) / 2 - k) * FAN_ANGLE;
      let mat: THREE.Material = this.skinMat;
      const extra = k > 0 ? extras[k - 1] : null;
      if (extra) {
        mat = toon(extra.skin);
        this.fingerMaterials.push(mat);
      }
      const finger = addMesh(fingerGeo, mat);
      finger.rotation.z = -Math.PI / 2;
      finger.position.set(0.22, 0, 0);
      pivot.add(finger);
      const nail = new THREE.Mesh(nailGeo, this.nailMat);
      nail.position.set(0.36, 0.055, 0);
      nail.rotation.x = -Math.PI / 2;
      pivot.add(nail);
      if (extra) {
        // A band in the original owner's sleeve colour shows whose finger it was.
        const bandMat = toon(extra.sleeve);
        this.fingerMaterials.push(bandMat);
        const band = addMesh(fingerBandGeo, bandMat, 0.025);
        band.rotation.z = Math.PI / 2;
        band.position.set(0.1, 0, 0);
        pivot.add(band);
      }
      this.fingers.add(pivot);
    }

    const curled = Math.max(0, 3 - extras.length);
    for (let i = 0; i < curled; i++) {
      const f = addMesh(curledGeo, this.skinMat, 0.038);
      f.rotation.x = Math.PI / 2;
      f.position.set(0.21, -0.18 + i * 0.085, 0);
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

    this.shield.visible = this.shieldOn > 0;
    if (this.shield.visible) {
      const pulse = 1 + Math.sin(this.bobPhase * 4) * 0.03;
      this.shield.scale.setScalar(pulse);
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    for (const m of this.fingerMaterials) m.dispose();
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
