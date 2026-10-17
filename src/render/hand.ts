import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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

const BASE_Y = 0.78;
const SCALE = 1.6;

const SKIN_TONES = [0xffd2b0, 0xf1b48c, 0xd99a6c, 0xb87850, 0x8d5a3b, 0xffe0c4];

export class HandModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private thumbPivot = new THREE.Group();
  private ring: THREE.Mesh;
  private materials: THREE.Material[] = [];
  private recoil = 0;
  private superFlash = 0;
  private bobPhase = Math.random() * 10;
  private deathT = -1;
  private skinMat: THREE.MeshToonMaterial;

  constructor(sleeveColor: number, isPlayer: boolean, skinIndex: number) {
    const skin = toon(SKIN_TONES[skinIndex % SKIN_TONES.length]);
    this.skinMat = skin;
    const sleeve = toon(sleeveColor);
    const band = toon(new THREE.Color(sleeveColor).lerp(new THREE.Color(0xffffff), 0.55));
    const nail = new THREE.MeshBasicMaterial({ color: 0xfff1ea });
    this.materials.push(skin, sleeve, band, nail);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, outline = 0.042) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      if (outline > 0) withOutline(m, outline);
      return m;
    };

    const palm = add(palmGeo, skin);
    this.body.add(palm);

    const index = add(fingerGeo, skin);
    index.rotation.z = -Math.PI / 2;
    index.position.set(0.36, 0.1, 0);
    this.body.add(index);

    const tipNail = new THREE.Mesh(nailGeo, nail);
    tipNail.position.set(0.5, 0.155, 0);
    tipNail.rotation.x = -Math.PI / 2;
    this.body.add(tipNail);

    for (let i = 0; i < 3; i++) {
      const f = add(curledGeo, skin, 0.038);
      f.rotation.x = Math.PI / 2;
      f.position.set(0.21, -0.01 - i * 0.085, 0);
      this.body.add(f);
    }

    this.thumbPivot.position.set(0.0, 0.15, 0.06);
    const thumb = add(thumbGeo, skin);
    thumb.position.set(0, 0.12, 0);
    this.thumbPivot.add(thumb);
    this.body.add(this.thumbPivot);

    const cuff = add(cuffGeo, sleeve, 0.04);
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
    this.skinMat.emissive.setRGB(this.superFlash * 0.9, this.superFlash * 0.6, 0);
  }

  dispose() {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) o.material.dispose();
    });
  }
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}
