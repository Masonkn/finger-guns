import * as THREE from 'three';
import { PROP_HUNT, PropKind } from '../sim/config';
import type { Brawler, GameEvent, World } from '../sim/world';
import type { HandModel } from './hand';
import type { Particles } from './particles';

/** A block a hider can be dressed as, built by the scene so it matches the map's own blocks. */
export interface PropModel {
  obj: THREE.Object3D;
  /** Per-frame motion that the real thing has too (power cubes bob and spin, crate gems turn). */
  animate?(x: number, y: number): void;
}

const FLASHLIGHT_COLOR = 0xfff1c4;

/**
 * Prop hunt on screen: hiders drawn as blocks, the seeker's sleep mask and flashlight,
 * and a small glow around your own hand so you can find it in the dark.
 */
export class PropHuntView {
  private disguises = new Map<number, { kind: PropKind; model: PropModel }>();
  private spot: THREE.SpotLight;
  private beam: THREE.Mesh;
  private glow: THREE.PointLight;

  constructor(
    scene: THREE.Scene,
    private world: World,
    private playerId: number,
    private hands: Map<number, HandModel>,
    private particles: Particles,
    private makeProp: (kind: PropKind, brawlerId: number) => PropModel,
  ) {
    const range = PROP_HUNT.flashlightRange;
    const angle = PROP_HUNT.flashlightAngle;
    this.spot = new THREE.SpotLight(FLASHLIGHT_COLOR, 70, range + 3, angle, 0.45, 1.1);
    scene.add(this.spot, this.spot.target);

    // The beam on the ground, so hiders can see where the seeker is looking.
    const beamGeo = new THREE.CircleGeometry(range, 24, -angle, angle * 2);
    beamGeo.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        color: FLASHLIGHT_COLOR,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.beam.position.y = 0.07;
    this.beam.renderOrder = 2;
    scene.add(this.beam);

    this.glow = new THREE.PointLight(0xc9d8ff, 6, 4.5, 1.2);
    scene.add(this.glow);
  }

  private get seeker(): Brawler | undefined {
    const ph = this.world.propHunt;
    return ph ? this.world.brawlers.find((b) => b.id === ph.seekerId) : undefined;
  }

  /** Who the camera follows once you've been found: the seeker, to watch the hunt. */
  spectateTarget(): Brawler | undefined {
    return this.seeker;
  }

  handleEvent(e: GameEvent) {
    if (e.type === 'found') {
      this.particles.burst(e.x, 0.8, e.y, 30, 0xffd23a, { speed: 4, size: 0.16, life: 0.8, up: 4 });
      this.particles.burst(e.x, 0.8, e.y, 16, 0xff5ad2, { speed: 3, size: 0.12, life: 0.7, up: 3 });
    } else if (e.type === 'disguise') {
      // A puff of smoke as the hider turns into something else.
      this.particles.burst(e.x, 0.6, e.y, 18, 0xe8e4f0, { speed: 2.2, size: 0.2, life: 0.55, up: 1.5, gravity: -1 });
    }
  }

  update() {
    const w = this.world;
    const ph = w.propHunt!;
    for (const b of w.brawlers) {
      const hand = this.hands.get(b.id)!;
      const seeker = b.id === ph.seekerId;
      if (b.alive && hand.dead) hand.revive();
      hand.setSleepMask(seeker && ph.phase === 'hide');
      // Rings would give hiders away: only yours and the seeker's show.
      if (b.alive) hand.setRingVisible(b.id === this.playerId || seeker);

      const kind = b.alive && !seeker ? b.prop : null;
      const current = this.disguises.get(b.id);
      if (current && current.kind !== kind) {
        current.model.obj.removeFromParent();
        this.disguises.delete(b.id);
      }
      if (kind && (!current || current.kind !== kind)) {
        const model = this.makeProp(kind, b.id);
        hand.root.add(model.obj);
        this.disguises.set(b.id, { kind, model });
      }
      hand.setBodyVisible(!kind);
      this.disguises.get(b.id)?.model.animate?.(b.x, b.y);
    }

    // The flashlight comes on when the sleep mask comes off.
    const s = this.seeker;
    const lit = !!s && s.alive && ph.phase !== 'hide';
    this.spot.visible = this.beam.visible = lit;
    if (s && lit) {
      const fx = Math.cos(s.facing);
      const fy = Math.sin(s.facing);
      this.spot.position.set(s.x + fx * 0.3, 1.7, s.y + fy * 0.3);
      this.spot.target.position.set(s.x + fx * 5, 0, s.y + fy * 5);
      this.beam.position.x = s.x + fx * 0.4;
      this.beam.position.z = s.y + fy * 0.4;
      this.beam.rotation.y = -s.facing;
    }

    const me = w.brawlers.find((b) => b.id === this.playerId)!;
    this.glow.visible = me.alive;
    this.glow.position.set(me.x, 2.2, me.y);
  }
}
