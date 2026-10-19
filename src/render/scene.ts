import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { AMMO, AmmoKind, FINGERS, MAP_SIZE, PICKUP_AMMO_KINDS, PropKind, SUPER } from '../sim/config';
import { PropHuntView, type PropModel } from './prophunt';
import { Tile } from '../sim/map';
import { type Brawler, type World, ammoOf, fingerCount } from '../sim/world';
import { type PlayerLook, handSurfaceColor } from './cosmetics';
import { FingerLook, HandModel, buildFingerTrophy } from './hand';
import { Particles } from './particles';
import { AmbientFall, buildProps, hash, paintGround } from './dressing';
import { THEME_LOOKS, type ThemeLook } from './themes';
import type { MapTheme } from '../sim/themes';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  FadeUniforms,
  SwayUniforms,
  addFade,
  addSway,
  makeFadeUniforms,
  makeSwayUniforms,
  outlineMaterial,
  toon,
  withOutline,
} from './toon';

// Isometric framing: rotated 45° around the vertical axis and tilted down.
// True isometric is ~35°; a little steeper keeps more of the arena readable.
export const CAMERA_PITCH_DEG = 40;
export const CAMERA_YAW_DEG = 45;
const VIEW_HEIGHT = 14; // tiles visible vertically on a landscape screen


export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private hands = new Map<number, HandModel>();
  private crateMeshes = new Map<number, { mesh: THREE.Mesh; shake: number }>();
  private cubeMeshes = new Map<number, THREE.Mesh>();
  private fingerMeshes = new Map<number, THREE.Group>();
  /** Skin and sleeve colour of every brawler, for finger drops and collected fingers. */
  private looks = new Map<number, FingerLook>();
  private bulletMeshes = new Map<number, THREE.Mesh>();
  /** Spare bullet meshes, by bullet type ('super' for supers). */
  private bulletPools = new Map<string, THREE.Mesh[]>();
  private ammoMeshes = new Map<number, THREE.Group>();
  private ammoMats = new Map<AmmoKind, THREE.MeshToonMaterial>();
  private effectClock = 0; // paces flame, frost and ammo sparkle particles
  private particles = new Particles();
  private wallFade: FadeUniforms = makeFadeUniforms(0, 1.2);
  private bushFade: FadeUniforms = makeFadeUniforms(1, 2.0);
  private grassSway: SwayUniforms = makeSwayUniforms(0.09);
  private poison: THREE.InstancedMesh;
  private poisonGround: THREE.ShaderMaterial;
  private sun: THREE.DirectionalLight;
  private camTarget = new THREE.Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2);
  private aimLine: THREE.Mesh;
  private aimFan: THREE.Mesh;
  private aimSpray: THREE.Mesh; // shotgun spread
  private aimSprayWidth = -1;
  private dummy = new THREE.Object3D();
  private shake = 0;
  private clockTime = 0;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.95);
  private look: ThemeLook;
  private ambient: AmbientFall | null = null;
  private fireworkClock = 1;
  private propHunt: PropHuntView | null = null;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    private world: World,
    private playerId: number,
    private isVisible: (b: Brawler) => boolean,
    lookOf: (b: Brawler) => PlayerLook,
    theme: MapTheme = 'summer',
  ) {
    const look = (this.look = THEME_LOOKS[theme]);
    // Prop hunt is played at night, so the seeker's flashlight matters.
    const night = world.mode === 'propHunt';
    this.scene.background = new THREE.Color(look.sky);
    if (night) (this.scene.background as THREE.Color).lerp(new THREE.Color(0x04050c), 0.8);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.zoom = 1;

    const light = look.light ?? { sky: 0xdff1ff, ground: 0x6b5a7a, hemi: 1.4, sun: 2.2, sunColor: 0xffffff };
    this.scene.add(new THREE.HemisphereLight(light.sky, light.ground, light.hemi * (night ? 0.1 : 1)));
    this.sun = new THREE.DirectionalLight(night ? 0x8fa6ff : light.sunColor, light.sun * (night ? 0.06 : 1));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 18;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 80 });
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.buildGround();
    this.buildWalls();
    this.buildBushes();
    this.buildCrates();
    if (look.props) this.scene.add(buildProps(look.props, MAP_SIZE));
    if (look.ambient) {
      this.ambient = new AmbientFall(look.ambient.kind, look.ambient.colors, look.ambient.count ?? 80);
      this.scene.add(this.ambient.mesh);
    }
    this.poisonGround = this.buildPoisonGround();
    this.poison = this.buildPoisonClouds();
    this.scene.add(this.particles.mesh);

    world.brawlers.forEach((b) => {
      const me = world.brawlers.find((o) => o.id === playerId)!;
      const role = b.id === playerId ? 'me' : b.team === me.team ? 'ally' : 'enemy';
      const look = lookOf(b);
      const hand = new HandModel(look.sleeve, role, look.color, look.topper, look.glove);
      this.looks.set(b.id, { skin: handSurfaceColor(look), sleeve: look.sleeve });
      this.hands.set(b.id, hand);
      this.scene.add(hand.root);
    });
    if (night) {
      this.propHunt = new PropHuntView(this.scene, world, playerId, this.hands, this.particles, (kind, id) => this.makeProp(kind, id));
    }

    const aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
    const lineGeo = new THREE.PlaneGeometry(1, 0.5);
    lineGeo.translate(0.5, 0, 0);
    lineGeo.rotateX(-Math.PI / 2);
    this.aimLine = new THREE.Mesh(lineGeo, aimMat);
    this.aimLine.position.y = 0.05;
    this.scene.add(this.aimLine);
    this.aimSpray = new THREE.Mesh(new THREE.BufferGeometry(), aimMat);
    this.aimSpray.position.y = 0.05;
    this.scene.add(this.aimSpray);

    const fanGeo = new THREE.CircleGeometry(SUPER.range, 24, -SUPER.spread / 2, SUPER.spread);
    fanGeo.rotateX(-Math.PI / 2);
    this.aimFan = new THREE.Mesh(
      fanGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    this.aimFan.position.y = 0.06;
    this.scene.add(this.aimFan);

    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // On portrait screens keep the same width of arena visible instead.
    const viewH = aspect >= 1 ? VIEW_HEIGHT : (VIEW_HEIGHT * 1.15) / aspect;
    this.camera.top = viewH / 2;
    this.camera.bottom = -viewH / 2;
    this.camera.left = (-viewH * aspect) / 2;
    this.camera.right = (viewH * aspect) / 2;
    this.camera.updateProjectionMatrix();
  }

  /** Ground point (sim coords) under a screen pixel, at hand height. */
  screenToGround(px: number, py: number): { x: number; y: number } {
    const ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    return { x: hit.x, y: hit.z };
  }

  /** Converts a screen-space direction (x right, y up) into a sim-space direction. */
  screenDirToWorld(sx: number, sy: number): { x: number; y: number } {
    const yaw = THREE.MathUtils.degToRad(CAMERA_YAW_DEG);
    // Camera right and forward projected onto the ground.
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    return { x: rx * sx + fx * sy, y: rz * sx + fz * sy };
  }

  /** World position of a brawler's head, projected to screen pixels. */
  toScreen(x: number, y: number, height: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, height, y).project(this.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }

  addShake(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  render(dt: number, aim: { x: number; y: number; active: boolean; isSuper: boolean }) {
    this.clockTime += dt;
    const w = this.world;
    const player = w.brawlers.find((b) => b.id === this.playerId)!;
    this.handleEvents(player);

    // Follow the player, then a teammate once they're out, then whoever is still fighting.
    const follow = player.alive
      ? player
      : (this.propHunt?.spectateTarget() ??
        w.brawlers.find((b) => b.alive && b.team === player.team) ??
        w.brawlers.find((b) => b.alive) ??
        player);
    this.camTarget.lerp(new THREE.Vector3(follow.x, 0, follow.y), Math.min(1, dt * 6));
    this.placeCamera();

    this.effectClock += dt;
    const puff = this.effectClock >= 0.06; // about 16 puffs a second per effect
    if (puff) this.effectClock = 0;
    for (const b of w.brawlers) {
      const hand = this.hands.get(b.id)!;
      if (!b.alive) {
        hand.die();
      }
      const moving = Math.hypot(b.moveX, b.moveY) > 0.1;
      const hidden = !this.isVisible(b);
      if (b.alive) {
        hand.setFingerCount(1 + b.extraFingers.length);
        hand.setEffects(w.isShielded(b), w.isRapidFiring(b));
        if (w.isDashing(b) && !hidden) {
          this.particles.burst(b.x, 0.35, b.y, 1, 0xffffff, { speed: 0.6, size: 0.22, life: 0.35, gravity: 0, up: 0.4 });
        }
        if (puff && !hidden) this.statusEffects(b);
      }
      hand.update(dt, b.x, b.y, b.facing, moving, hidden);
    }
    this.propHunt?.update();

    this.grassSway.uSwayTime.value = this.clockTime;
    this.syncBullets();
    this.syncCrates(dt);
    this.syncCubes();
    this.syncFingers();
    this.syncAmmoPickups();
    this.updatePoison();
    this.ambient?.update(dt, this.camTarget.x, this.camTarget.z);
    this.launchFireworks(dt);
    this.particles.update(dt);

    // See-through fades centred on the player.
    const focus = new THREE.Vector3(player.x, 0.6, player.y);
    const viewDir = new THREE.Vector3();
    this.camera.getWorldDirection(viewDir);
    for (const u of [this.wallFade, this.bushFade]) {
      u.uFocus.value.copy(focus);
      u.uViewDir.value.copy(viewDir);
    }
    this.wallFade.uFadeAmount.value = player.alive ? 1 : 0;
    const target = player.alive && player.inBush ? 1 : 0;
    this.bushFade.uFadeAmount.value += (target - this.bushFade.uFadeAmount.value) * Math.min(1, dt * 8);

    // Aim guides: a line as long as your bullets fly, a spray for a shotgun, a fan for the super.
    // Prop hunt hiders' triggers change their block rather than shoot, so they get no aim guide.
    const showAim = player.alive && aim.active && (!w.propHunt || w.isSeeker(player));
    const angle = Math.atan2(aim.y, aim.x);
    const ammo = ammoOf(player);
    const spray = ammo.pellets > 1;
    this.aimLine.visible = showAim && !aim.isSuper && !spray;
    this.aimSpray.visible = showAim && !aim.isSuper && spray;
    this.aimFan.visible = showAim && aim.isSuper;
    this.aimLine.scale.x = ammo.range;
    if (spray) {
      const n = fingerCount(player);
      const count = ammo.pellets + ammo.pelletsPerFinger * (n - 1);
      const width = (count - 1) * FINGERS.spread + ammo.spread;
      if (width !== this.aimSprayWidth) {
        this.aimSprayWidth = width;
        this.aimSpray.geometry.dispose();
        this.aimSpray.geometry = new THREE.CircleGeometry(ammo.range, 20, -width / 2, width).rotateX(-Math.PI / 2);
      }
    }
    for (const m of [this.aimLine, this.aimFan, this.aimSpray]) {
      m.position.x = player.x;
      m.position.z = player.y;
      m.rotation.y = -angle;
    }
    (this.aimLine.material as THREE.MeshBasicMaterial).opacity = player.ammo >= 1 ? 0.24 : 0.08;

    this.renderer.render(this.scene, this.camera);
  }

  private placeCamera() {
    const pitch = THREE.MathUtils.degToRad(CAMERA_PITCH_DEG);
    const yaw = THREE.MathUtils.degToRad(CAMERA_YAW_DEG);
    const dist = 40;
    this.shake = Math.max(0, this.shake - 0.016 * 3);
    const sx = (Math.random() - 0.5) * this.shake * 0.4;
    const sz = (Math.random() - 0.5) * this.shake * 0.4;
    const t = this.camTarget;
    this.camera.position.set(
      t.x + Math.sin(yaw) * Math.cos(pitch) * dist + sx,
      t.y + Math.sin(pitch) * dist,
      t.z + Math.cos(yaw) * Math.cos(pitch) * dist + sz,
    );
    this.camera.lookAt(t.x + sx, t.y, t.z + sz);
    this.sun.position.set(t.x + 8, 20, t.z + 4);
    this.sun.target.position.copy(t);
  }

  private handleEvents(player: Brawler) {
    for (const e of this.world.events) {
      this.propHunt?.handleEvent(e);
      switch (e.type) {
        case 'shot': {
          this.hands.get(e.brawlerId)?.shoot(e.isSuper);
          const b = this.world.brawlers.find((x) => x.id === e.brawlerId)!;
          const tipX = b.x + Math.cos(b.facing) * 0.95;
          const tipY = b.y + Math.sin(b.facing) * 0.95;
          const flash = e.isSuper ? 0xfff3a0 : ammoOf(b).color;
          this.particles.burst(tipX, 1.0, tipY, e.isSuper ? 10 : 4, flash, { speed: 2, size: 0.1, life: 0.18, gravity: 0, up: 0.3 });
          if (e.brawlerId === player.id) this.addShake(e.isSuper ? 0.8 : 0.2);
          break;
        }
        case 'hit':
          if (e.blocked) {
            this.particles.burst(e.x, 0.8, e.y, 8, 0x7fe8ff, { speed: 3.5, size: 0.11, life: 0.3, up: 1 });
            break;
          }
          this.particles.burst(e.x, 0.6, e.y, 7, 0xffffff, { speed: 3, size: 0.1, life: 0.3 });
          if (e.kind === 'fire' || e.kind === 'ice') {
            this.particles.burst(e.x, 0.7, e.y, 10, AMMO[e.kind].color, { speed: 3, size: 0.13, life: 0.45, up: 2 });
          }
          if (e.targetId === player.id) this.addShake(0.5);
          break;
        case 'wallHit':
          this.particles.burst(e.x, 0.6, e.y, 4, 0x8fb4ff, { speed: 2, size: 0.09, life: 0.25 });
          break;
        case 'fingerDrop': {
          const look = this.looks.get(e.fromId);
          this.particles.burst(e.x, 0.6, e.y, 8, look?.sleeve ?? 0xffffff, { speed: 2, size: 0.12, life: 0.5, up: 3 });
          break;
        }
        case 'fingerPickup': {
          const b = this.world.brawlers.find((x) => x.id === e.brawlerId)!;
          const look = this.looks.get(e.fromId);
          this.particles.burst(b.x, 1.0, b.y, 14, look?.sleeve ?? 0xffd23a, { speed: 3, size: 0.13, life: 0.6, up: 3.5 });
          this.particles.burst(b.x, 1.0, b.y, 8, 0xffd23a, { speed: 2, size: 0.1, life: 0.5, up: 4 });
          if (b.id === player.id) this.addShake(0.3);
          break;
        }
        case 'ability': {
          const b = this.world.brawlers.find((x) => x.id === e.brawlerId)!;
          const color = e.ability === 'dash' ? 0xffffff : e.ability === 'shield' ? 0x7fe8ff : 0xff9a2e;
          this.particles.burst(b.x, 0.8, b.y, 16, color, { speed: 3.5, size: 0.14, life: 0.45, up: 2 });
          break;
        }
        case 'crateHit': {
          const c = this.crateMeshes.get(e.crateId);
          if (c) c.shake = 1;
          break;
        }
        case 'crateBreak': {
          const c = this.crateMeshes.get(e.crateId);
          if (c) {
            c.mesh.removeFromParent();
            this.crateMeshes.delete(e.crateId);
          }
          this.particles.burst(e.x, 0.5, e.y, 22, 0xb06b3a, { speed: 4, size: 0.18, life: 0.7, up: 4 });
          this.particles.burst(e.x, 0.5, e.y, 10, 0x6ef06a, { speed: 3, size: 0.12, life: 0.6, up: 3 });
          break;
        }
        case 'death': {
          this.particles.burst(e.x, 0.6, e.y, 26, 0xffffff, { speed: 4, size: 0.2, life: 0.8, up: 3 });
          this.particles.burst(e.x, 0.6, e.y, 12, 0x2c2333, { speed: 3, size: 0.16, life: 0.9, up: 2 });
          break;
        }
        case 'ammoPickup': {
          const b = this.world.brawlers.find((x) => x.id === e.brawlerId)!;
          this.particles.burst(b.x, 0.8, b.y, 16, AMMO[e.kind].color, { speed: 3, size: 0.14, life: 0.55, up: 3.5 });
          if (b.id === player.id) this.addShake(0.25);
          break;
        }
        case 'pickup': {
          const b = this.world.brawlers.find((x) => x.id === e.brawlerId)!;
          this.particles.burst(b.x, 0.8, b.y, 12, 0x6ef06a, { speed: 2.5, size: 0.12, life: 0.5, up: 3 });
          break;
        }
      }
    }
  }

  private buildGround() {
    const size = MAP_SIZE;
    const c = paintGround(this.look, size, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), toon(0xffffff, { map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(size / 2, 0, size / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Raised rim and outer border so the arena reads like a board.
    const border = new THREE.Mesh(new THREE.PlaneGeometry(size + 60, size + 60), toon(this.look.border));
    border.rotation.x = -Math.PI / 2;
    border.position.set(size / 2, -0.02, size / 2);
    this.scene.add(border);
    const rimMat = toon(this.look.rim); // a raised edge frames the arena
    for (let i = 0; i < 4; i++) {
      const horizontal = i < 2;
      const rim = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? size + 1 : 0.5, 0.5, horizontal ? 0.5 : size + 1), rimMat);
      rim.position.set(
        horizontal ? size / 2 : i === 2 ? -0.25 : size + 0.25,
        0.25,
        horizontal ? (i === 0 ? -0.25 : size + 0.25) : size / 2,
      );
      rim.castShadow = rim.receiveShadow = true;
      this.scene.add(rim);
    }
  }

  private buildWalls() {
    const map = this.world.map;
    const cells: [number, number][] = [];
    for (let y = 0; y < map.size; y++) {
      for (let x = 0; x < map.size; x++) if (map.tiles[y * map.size + x] === Tile.Wall) cells.push([x, y]);
    }
    const geo = this.brickGeo;
    const mat = toon(0xffffff, { map: this.brickTex });
    addFade(mat, this.wallFade);
    const walls = new THREE.InstancedMesh(geo, mat, cells.length);
    const hull = new THREE.InstancedMesh(geo, outlineMaterial(0.045, this.look.wallEdge ?? 0x141a45, this.wallFade), cells.length);
    const col = new THREE.Color();
    cells.forEach(([x, y], i) => {
      this.dummy.position.set(x + 0.5, 0, y + 0.5);
      this.dummy.updateMatrix();
      walls.setMatrixAt(i, this.dummy.matrix);
      hull.setMatrixAt(i, this.dummy.matrix);
      walls.setColorAt(i, col.set(this.wallColor(x, y)));
    });
    walls.castShadow = true;
    walls.receiveShadow = true;
    this.scene.add(walls, hull);
  }

  private brickGeo = new RoundedBoxGeometry(1, 1.2, 1, 2, 0.1).translate(0, 0.6, 0);
  private brickTex = brickTexture();

  /** The tint of the wall brick at a tile, by the theme's pattern. */
  private wallColor(x: number, y: number): number {
    const look = this.look;
    const n = look.walls.length;
    const pick = look.wallPattern === 'checker' ? (x + y) % n : look.wallPattern === 'rows' ? (x + y) % (n * 2) >> 1 : (x * 7 + y * 13) % n;
    return look.walls[((pick % n) + n) % n];
  }

  /** A prop hunt disguise, made of the same parts as the real thing on this map. */
  makeProp(kind: PropKind, brawlerId: number): PropModel {
    switch (kind) {
      case 'brick': {
        const mat = toon(0xffffff, { map: this.brickTex });
        const mesh = new THREE.Mesh(this.brickGeo, mat);
        mesh.add(new THREE.Mesh(this.brickGeo, outlineMaterial(0.045, this.look.wallEdge ?? 0x141a45)));
        mesh.castShadow = mesh.receiveShadow = true;
        // Takes the colour the wall pattern would have where it stands.
        return { obj: mesh, animate: (x, y) => mat.color.set(this.wallColor(Math.floor(x), Math.floor(y))) };
      }
      case 'crate': {
        const mesh = this.makeCrate();
        const gem = mesh.getObjectByName('gem')!;
        return {
          obj: mesh,
          animate: () => {
            gem.rotation.y = this.clockTime * 2;
            gem.position.y = 1.05 + Math.sin(this.clockTime * 3) * 0.06;
          },
        };
      }
      case 'bush': {
        const g = new THREE.Group();
        const inner = new THREE.Group();
        // Built as if on some tile in the middle of a patch, so the bush has a natural shape.
        inner.position.set(-12.5, 0, -7.5);
        this.buildBushCells([[12, 7]], inner);
        g.add(inner);
        return { obj: g };
      }
      case 'cube': {
        const m = new THREE.Mesh(this.cubeGeo, this.cubeMat);
        withOutline(m, 0.04);
        m.castShadow = true;
        // Bobs and spins just like the decoy cubes around it.
        return {
          obj: m,
          animate: () => {
            m.position.y = 0.45 + Math.sin(this.clockTime * 3 + brawlerId) * 0.1;
            m.rotation.set(0.6, this.clockTime * 1.8 + brawlerId, 0.3);
          },
        };
      }
      case 'ammo': {
        const g = this.makeAmmoBox(PICKUP_AMMO_KINDS[brawlerId % PICKUP_AMMO_KINDS.length]);
        const box = g.getObjectByName('box')!;
        return {
          obj: g,
          animate: () => {
            box.position.y = 0.55 + Math.sin(this.clockTime * 3 + brawlerId) * 0.1;
            box.rotation.set(0.35, this.clockTime * 1.5 + brawlerId, 0);
          },
        };
      }
    }
  }

  private buildBushes() {
    const map = this.world.map;
    const cells: [number, number][] = [];
    for (let y = 0; y < map.size; y++) {
      for (let x = 0; x < map.size; x++) if (map.tiles[y * map.size + x] === Tile.Bush) cells.push([x, y]);
    }
    this.buildBushCells(cells, this.scene);
  }

  private buildBushCells(cells: [number, number][], parent: THREE.Object3D) {
    const kind = this.look.bush.kind;
    if (kind === 'grass') this.buildGrass(cells, parent);
    else if (kind === 'round') this.buildRoundBushes(cells, parent);
    else this.buildPines(cells, parent);
  }

  /** Per-instance shade of the theme's bush colour: a little hue drift and lighter tips. */
  private bushShade(col: THREE.Color, h: number, h2: number) {
    const { color, spread = 0.04 } = this.look.bush;
    const hsl = { h: 0, s: 0, l: 0 };
    col.set(color).getHSL(hsl);
    return col.setHSL(hsl.h + (h - 0.5) * spread, hsl.s, hsl.l + h2 * 0.1);
  }

  private buildGrass(cells: [number, number][], parent: THREE.Object3D) {
    // Tall grass: clusters of tapered, leaning blades per bush tile. Darker and more
    // saturated than the lawn so the hiding spots stand out.
    const perTile = 9;
    const geo = new THREE.ConeGeometry(0.11, 1, 5, 3, true);
    geo.translate(0, 0.5, 0);
    geo.scale(1, 1, 0.42); // flatten into a blade
    // Darker at the root, lighter at the tip.
    const pos = geo.getAttribute('position');
    const shade = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = 0.55 + 0.45 * pos.getY(i);
      shade.set([k, k, k], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(shade, 3));

    const mat = toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide });
    addFade(mat, this.bushFade);
    addSway(mat, this.grassSway);
    const blades = new THREE.InstancedMesh(geo, mat, cells.length * perTile);
    const hull = new THREE.InstancedMesh(
      geo,
      outlineMaterial(0.03, this.look.bush.edge, this.bushFade, this.grassSway),
      cells.length * perTile,
    );
    const col = new THREE.Color();
    let i = 0;
    for (const [x, y] of cells) {
      for (let k = 0; k < perTile; k++) {
        const h = hash(x, y, k);
        const h2 = hash(y, x, k + 3);
        const h3 = hash(k, x, y);
        // Spread blades on a jittered 3x3 grid so each tile is evenly covered.
        const gx = (k % 3) / 3 + 0.17 + (h - 0.5) * 0.26;
        const gy = Math.floor(k / 3) / 3 + 0.17 + (h2 - 0.5) * 0.26;
        this.dummy.position.set(x + gx, 0, y + gy);
        this.dummy.rotation.set((h2 - 0.5) * 0.5, h * Math.PI * 2, (h3 - 0.5) * 0.5);
        const w = 0.9 + h3 * 0.45;
        this.dummy.scale.set(w, 0.95 + h * 0.6, w);
        this.dummy.updateMatrix();
        blades.setMatrixAt(i, this.dummy.matrix);
        hull.setMatrixAt(i, this.dummy.matrix);
        blades.setColorAt(i, this.bushShade(col, h2, h3));
        i++;
      }
    }
    blades.castShadow = true;
    blades.frustumCulled = hull.frustumCulled = false; // swaying tips can leave the static bounds
    parent.add(blades, hull);
  }

  private buildRoundBushes(cells: [number, number][], parent: THREE.Object3D) {
    // Leafy balls, three to a tile, like the very first version of the arena.
    const perTile = 3;
    const radius = 0.42;
    const geo = new THREE.IcosahedronGeometry(radius, 1);
    const mat = toon(0xffffff);
    addFade(mat, this.bushFade);
    const bushes = new THREE.InstancedMesh(geo, mat, cells.length * perTile);
    const hull = new THREE.InstancedMesh(geo, outlineMaterial(0.04, this.look.bush.edge, this.bushFade), cells.length * perTile);
    const col = new THREE.Color();
    const spots: THREE.Vector3[] = []; // points on the bushes' upper surface, for accents
    let i = 0;
    for (const [x, y] of cells) {
      for (let k = 0; k < perTile; k++) {
        const h = hash(x, y, k);
        const scale = 0.95 + h * 0.35;
        this.dummy.position.set(x + 0.2 + h * 0.6, 0.45 + hash(y, x, k) * 0.25, y + 0.2 + hash(k, x, y) * 0.6);
        this.dummy.rotation.set(h * 3, h * 5, 0);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        bushes.setMatrixAt(i, this.dummy.matrix);
        hull.setMatrixAt(i, this.dummy.matrix);
        bushes.setColorAt(i, this.bushShade(col, h, hash(k, y, x)));
        for (let a = 0; a < 3; a++) {
          const theta = hash(x + a, y, k + 20) * Math.PI * 2;
          const phi = 0.25 + hash(y, x + a, k + 21) * 1.0; // from the top down towards the side
          const r = radius * scale * 0.98;
          spots.push(
            new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
              .multiplyScalar(r)
              .add(this.dummy.position),
          );
        }
        i++;
      }
    }
    bushes.castShadow = true;
    parent.add(bushes, hull);
    this.buildAccents(cells, spots, 3 * perTile, parent);
  }

  private buildPines(cells: [number, number][], parent: THREE.Object3D) {
    // A little fir tree per tile: three stacked cones, white-tipped when it's snowy.
    const tiers: THREE.BufferGeometry[] = [];
    const tierShape = [
      [0.5, 0.75, 0.2],
      [0.4, 0.6, 0.62],
      [0.28, 0.5, 0.98],
    ];
    const green = new THREE.Color(1, 1, 1);
    const snow = new THREE.Color(1, 1, 1);
    this.bushShade(green, 0.5, 0);
    for (const [r, hgt, base] of tierShape) {
      const cone = new THREE.ConeGeometry(r, hgt, 8, 3);
      cone.translate(0, base + hgt / 2, 0);
      const pos = cone.getAttribute('position');
      const colors = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        const k = (pos.getY(v) - base) / hgt;
        const c = this.look.snowCaps && k > 0.55 ? snow : green;
        colors.set([c.r, c.g, c.b], v * 3);
      }
      cone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      tiers.push(cone.toNonIndexed());
    }
    const trunk = new THREE.CylinderGeometry(0.08, 0.1, 0.3, 6).toNonIndexed();
    trunk.translate(0, 0.15, 0);
    const brown = new THREE.Color(0x6a4426);
    trunk.setAttribute('color', new THREE.BufferAttribute(new Float32Array(trunk.getAttribute('position').count * 3).map((_, j) => [brown.r, brown.g, brown.b][j % 3]), 3));
    for (const t of [...tiers, trunk]) t.deleteAttribute('uv');
    const geo = mergeGeometries([trunk, ...tiers])!;
    geo.computeVertexNormals();

    const mat = toon(0xffffff, { vertexColors: true });
    addFade(mat, this.bushFade);
    const trees = new THREE.InstancedMesh(geo, mat, cells.length);
    const hull = new THREE.InstancedMesh(geo, outlineMaterial(0.035, this.look.bush.edge, this.bushFade), cells.length);
    const col = new THREE.Color();
    const spots: THREE.Vector3[] = [];
    cells.forEach(([x, y], i) => {
      const h = hash(x, y, 1);
      const scale = 0.9 + h * 0.25;
      this.dummy.position.set(x + 0.5 + (h - 0.5) * 0.15, 0, y + 0.5 + (hash(y, x, 2) - 0.5) * 0.15);
      this.dummy.rotation.set(0, h * Math.PI * 2, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      trees.setMatrixAt(i, this.dummy.matrix);
      hull.setMatrixAt(i, this.dummy.matrix);
      trees.setColorAt(i, col.setScalar(0.88 + hash(y, x, 3) * 0.12));
      for (let a = 0; a < 8; a++) {
        const [r, hgt, base] = tierShape[a % 3];
        const k = 0.1 + hash(x, y + a, 4) * 0.5; // how far up the tier
        const theta = hash(y + a, x, 5) * Math.PI * 2;
        const rr = r * (1 - k) * scale;
        spots.push(
          new THREE.Vector3(Math.cos(theta) * rr, (base + k * hgt) * scale, Math.sin(theta) * rr).add(this.dummy.position),
        );
      }
    });
    trees.castShadow = true;
    parent.add(trees, hull);
    this.buildAccents(cells, spots, 8, parent);
  }

  /** Flowers, fairy lights, gold coins, eggs or pumpkins dotted on the bushes. */
  private buildAccents(cells: [number, number][], spots: THREE.Vector3[], spotsPerTile: number, parent: THREE.Object3D) {
    const acc = this.look.accents;
    if (!acc || spots.length === 0) return;
    const size = acc.size ?? 0.08;
    const geo = new THREE.IcosahedronGeometry(size, acc.egg || size > 0.1 ? 2 : 1);
    if (acc.egg) geo.scale(1, 1.35, 1);
    const mat = acc.glow ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : toon(0xffffff);
    addFade(mat, this.bushFade);
    const picks: THREE.Vector3[] = [];
    cells.forEach((_, t) => {
      for (let a = 0; a < acc.perTile; a++) {
        const s = spots[t * spotsPerTile + Math.floor(hash(t, a, 31) * spotsPerTile)];
        if (s) picks.push(s);
      }
    });
    const mesh = new THREE.InstancedMesh(geo, mat, picks.length);
    const col = new THREE.Color();
    picks.forEach((p, i) => {
      this.dummy.position.copy(p);
      this.dummy.rotation.set(0, hash(i, 2, 3) * 6, (hash(i, 3, 2) - 0.5) * 0.6);
      this.dummy.scale.setScalar(0.85 + hash(i, 1, 4) * 0.3);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, col.set(acc.colors[i % acc.colors.length]));
    });
    parent.add(mesh);
    if (!acc.glow) {
      const hull = new THREE.InstancedMesh(geo, outlineMaterial(0.02, 0x1a1422, this.bushFade), picks.length);
      for (let i = 0; i < picks.length; i++) {
        mesh.getMatrixAt(i, this.dummy.matrix);
        hull.setMatrixAt(i, this.dummy.matrix);
      }
      parent.add(hull);
    }
  }

  /** Bursts of sparks high over the arena, for the 4th of July and New Year's. */
  private launchFireworks(dt: number) {
    const colors = this.look.fireworks;
    if (!colors) return;
    this.fireworkClock -= dt;
    if (this.fireworkClock > 0) return;
    this.fireworkClock = 1.6 + Math.random() * 1.8;
    const x = this.camTarget.x + (Math.random() - 0.5) * 16;
    const z = this.camTarget.z + (Math.random() - 0.5) * 16;
    const y = 6 + Math.random() * 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    this.particles.burst(x, y, z, 28, color, { speed: 4.5, size: 0.13, life: 1.1, gravity: 1.5, up: 0.6 });
    this.particles.burst(x, y, z, 8, 0xffffff, { speed: 2, size: 0.1, life: 0.6, gravity: 1, up: 0.4 });
  }

  private crateParts = {
    geo: new RoundedBoxGeometry(0.86, 0.86, 0.86, 2, 0.08).translate(0, 0.43, 0),
    mat: toon(0xc98a4b),
    strapGeo: new THREE.BoxGeometry(0.9, 0.16, 0.9),
    strapMat: toon(0x7a4a2a),
    gemGeo: new THREE.OctahedronGeometry(0.14),
    gemMat: new THREE.MeshBasicMaterial({ color: 0x6ef06a }),
  };

  private makeCrate(): THREE.Mesh {
    const p = this.crateParts;
    const mesh = new THREE.Mesh(p.geo, p.mat);
    withOutline(mesh, 0.045);
    mesh.castShadow = mesh.receiveShadow = true;
    const strap = new THREE.Mesh(p.strapGeo, p.strapMat);
    strap.position.y = 0.43;
    mesh.add(strap);
    const gem = new THREE.Mesh(p.gemGeo, p.gemMat);
    gem.position.y = 1.05;
    gem.name = 'gem';
    mesh.add(gem);
    return mesh;
  }

  private buildCrates() {
    for (const c of this.world.crates) {
      const mesh = this.makeCrate();
      mesh.position.set(c.x + 0.5, 0, c.y + 0.5);
      this.scene.add(mesh);
      this.crateMeshes.set(c.id, { mesh, shake: 0 });
    }
  }

  private syncCrates(dt: number) {
    for (const [, c] of this.crateMeshes) {
      c.shake = Math.max(0, c.shake - dt * 5);
      const s = 1 + c.shake * 0.08;
      c.mesh.scale.set(s, 1 - c.shake * 0.06, s);
      const gem = c.mesh.getObjectByName('gem');
      if (gem) {
        gem.rotation.y = this.clockTime * 2;
        gem.position.y = 1.05 + Math.sin(this.clockTime * 3) * 0.06;
      }
    }
  }

  private cubeGeo = new RoundedBoxGeometry(0.36, 0.36, 0.36, 2, 0.05);
  private cubeMat = makeCubeMaterial();

  private syncCubes() {
    const alive = new Set<number>();
    for (const c of this.world.cubes) {
      alive.add(c.id);
      let m = this.cubeMeshes.get(c.id);
      if (!m) {
        m = new THREE.Mesh(this.cubeGeo, this.cubeMat);
        withOutline(m, 0.04);
        m.castShadow = true;
        this.scene.add(m);
        this.cubeMeshes.set(c.id, m);
      }
      m.position.set(c.x, 0.45 + Math.sin(this.clockTime * 3 + c.id) * 0.1, c.y);
      m.rotation.set(0.6, this.clockTime * 1.8 + c.id, 0.3);
    }
    // The finger-gun picture on every face pulses gently.
    this.cubeMat.emissiveIntensity = 0.85 + Math.sin(this.clockTime * 4) * 0.15;
    for (const [id, m] of this.cubeMeshes) {
      if (!alive.has(id)) {
        m.removeFromParent();
        this.cubeMeshes.delete(id);
      }
    }
  }

  private fingerRingGeo = new THREE.RingGeometry(0.3, 0.42, 28);

  private syncFingers() {
    const alive = new Set<number>();
    for (const f of this.world.fingers) {
      alive.add(f.id);
      let g = this.fingerMeshes.get(f.id);
      if (!g) {
        const look = this.looks.get(f.fromId) ?? { skin: 0xffd2b0, sleeve: 0xffffff };
        g = new THREE.Group();
        const trophy = buildFingerTrophy(look);
        trophy.name = 'trophy';
        trophy.traverse((o) => (o.castShadow = true));
        g.add(trophy);
        const ring = new THREE.Mesh(
          this.fingerRingGeo,
          new THREE.MeshBasicMaterial({ color: look.sleeve, transparent: true, opacity: 0.8, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.04;
        g.add(ring);
        this.scene.add(g);
        this.fingerMeshes.set(f.id, g);
      }
      g.position.set(f.x, 0, f.y);
      const trophy = g.getObjectByName('trophy')!;
      trophy.position.y = 0.75 + Math.sin(this.clockTime * 3 + f.id) * 0.12;
      trophy.rotation.y = this.clockTime * 1.6 + f.id;
    }
    for (const [id, g] of this.fingerMeshes) {
      if (alive.has(id)) continue;
      g.removeFromParent();
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      this.fingerMeshes.delete(id);
    }
  }

  private bulletGeo = new THREE.SphereGeometry(1, 12, 8);

  private syncBullets() {
    const alive = new Set<number>();
    for (const b of this.world.bullets) {
      alive.add(b.id);
      const style = b.isSuper ? 'super' : b.kind;
      let m = this.bulletMeshes.get(b.id);
      if (!m) {
        m = this.bulletPools.get(style)?.pop();
        if (!m) {
          const color = b.isSuper ? 0xff9a2e : AMMO[b.kind].color;
          const edge = b.isSuper ? 0x8a2a00 : BULLET_EDGE[b.kind];
          m = new THREE.Mesh(this.bulletGeo, new THREE.MeshBasicMaterial({ color }));
          m.add(new THREE.Mesh(this.bulletGeo, outlineMaterial(0.35, edge)));
          m.userData.style = style;
        }
        this.scene.add(m);
        this.bulletMeshes.set(b.id, m);
      }
      const r = b.isSuper ? 0.2 : b.kind === 'shotgun' ? 0.1 : 0.15;
      const stretch = b.kind === 'sniper' && !b.isSuper ? 4 : 2.2;
      m.position.set(b.x, 0.95, b.y);
      m.rotation.set(0, -Math.atan2(b.dy, b.dx), 0);
      m.scale.set(r * stretch, r, r);
      // Fire and ice bullets leave a little trail.
      if (!b.isSuper && (b.kind === 'fire' || b.kind === 'ice') && Math.random() < 0.5) {
        this.particles.burst(b.x, 0.95, b.y, 1, AMMO[b.kind].color, { speed: 0.4, size: 0.09, life: 0.25, gravity: 0, up: 0.3 });
      }
    }
    for (const [id, m] of this.bulletMeshes) {
      if (alive.has(id)) continue;
      m.removeFromParent();
      const style = m.userData.style as string;
      if (!this.bulletPools.has(style)) this.bulletPools.set(style, []);
      this.bulletPools.get(style)!.push(m);
      this.bulletMeshes.delete(id);
    }
  }

  /** Flames on burning hands, frost on chilled ones, sparkles on special-ammo fingertips. */
  private statusEffects(b: Brawler) {
    const w = this.world;
    if (w.isBurning(b)) {
      this.particles.burst(b.x, 0.9, b.y, 2, Math.random() < 0.5 ? 0xff6a1f : 0xffc23a, {
        speed: 0.8, size: 0.16, life: 0.4, gravity: -2, up: 1.5,
      });
    }
    if (w.isChilled(b)) {
      this.particles.burst(b.x, 0.7, b.y, 2, Math.random() < 0.5 ? 0x8fe8ff : 0xffffff, {
        speed: 1.2, size: 0.12, life: 0.45, gravity: 1, up: 0.6,
      });
    }
    if (b.ammoKind !== 'normal') {
      const tipX = b.x + Math.cos(b.facing) * 0.95;
      const tipY = b.y + Math.sin(b.facing) * 0.95;
      this.particles.burst(tipX, 1.0, tipY, 1, AMMO[b.ammoKind].color, { speed: 0.4, size: 0.08, life: 0.3, gravity: 0, up: 0.5 });
    }
  }

  private ammoBoxGeo = new RoundedBoxGeometry(0.56, 0.56, 0.56, 2, 0.08);

  /** An ammo box group: the spinning box (named 'box') and the ring under it. */
  private makeAmmoBox(kind: AmmoKind): THREE.Group {
    const g = new THREE.Group();
    let mat = this.ammoMats.get(kind);
    if (!mat) {
      mat = makeAmmoMaterial(kind);
      this.ammoMats.set(kind, mat);
    }
    const box = new THREE.Mesh(this.ammoBoxGeo, mat);
    withOutline(box, 0.04);
    box.castShadow = true;
    box.name = 'box';
    g.add(box);
    const ring = new THREE.Mesh(
      this.ammoRingGeo,
      new THREE.MeshBasicMaterial({ color: AMMO[kind].color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(ring);
    return g;
  }
  private ammoRingGeo = new THREE.RingGeometry(0.4, 0.54, 28);

  /** Ammo boxes: a spinning box in the bullet type's colour with its picture on every face. */
  private syncAmmoPickups() {
    const alive = new Set<number>();
    for (const p of this.world.ammoPickups) {
      alive.add(p.id);
      let g = this.ammoMeshes.get(p.id);
      if (!g) {
        g = this.makeAmmoBox(p.kind);
        this.scene.add(g);
        this.ammoMeshes.set(p.id, g);
      }
      g.position.set(p.x, 0, p.y);
      const box = g.getObjectByName('box')!;
      box.position.y = 0.55 + Math.sin(this.clockTime * 3 + p.id) * 0.1;
      box.rotation.set(0.35, this.clockTime * 1.5 + p.id, 0);
    }
    for (const [id, g] of this.ammoMeshes) {
      if (alive.has(id)) continue;
      g.removeFromParent();
      ((g.children[1] as THREE.Mesh).material as THREE.Material).dispose(); // the ring; the box material is shared
      this.ammoMeshes.delete(id);
    }
  }

  private buildPoisonGround(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uHalf: { value: MAP_SIZE / 2 }, uTime: { value: 0 }, uCenter: { value: MAP_SIZE / 2 } },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vPos = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uHalf;
        uniform float uTime;
        uniform float uCenter;
        varying vec2 vPos;
        void main() {
          vec2 d = abs(vPos - vec2(uCenter));
          float outside = max(d.x, d.y) - uHalf;
          if (outside < 0.0) discard;
          // Toxic purple, swirling, with a bright pulsing edge so it never blends with the lawn.
          float n = sin(vPos.x * 1.3 + uTime * 1.5) * sin(vPos.y * 1.1 - uTime * 1.2);
          float swirl = sin(vPos.x * 0.6 - vPos.y * 0.7 + uTime * 2.2) * 0.5 + 0.5;
          float a = clamp(0.55 + outside * 0.08 + n * 0.08, 0.0, 0.82);
          vec3 col = mix(vec3(0.62, 0.24, 0.92), vec3(0.36, 0.08, 0.6), n * 0.5 + 0.5);
          col = mix(col, vec3(0.85, 0.45, 1.0), swirl * 0.25);
          float edge = 1.0 - smoothstep(0.0, 0.35, outside);
          float pulse = 0.75 + 0.25 * sin(uTime * 5.0);
          col = mix(col, vec3(1.0, 0.75, 1.0), edge * pulse);
          gl_FragColor = vec4(col, max(a, edge * 0.95));
        }
      `,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(MAP_SIZE / 2, 0.08, MAP_SIZE / 2);
    plane.renderOrder = 1;
    this.scene.add(plane);
    return mat;
  }

  private poisonCount = 260;

  private buildPoisonClouds(): THREE.InstancedMesh {
    const geo = new THREE.IcosahedronGeometry(0.7, 1);
    const mat = toon(0xa34dff, { transparent: true, opacity: 0.85 });
    const mesh = new THREE.InstancedMesh(geo, mat, this.poisonCount);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  private updatePoison() {
    const half = this.world.zoneHalfSize;
    const c = MAP_SIZE / 2;
    this.poisonGround.uniforms.uHalf.value = half;
    this.poisonGround.uniforms.uTime.value = this.clockTime;

    // Puffs ride along the edge of the safe square while it's inside the arena.
    const visible = half < MAP_SIZE / 2 - 0.05;
    const perimeter = half * 8;
    const n = this.poisonCount / 2;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < n; i++) {
        const idx = row * n + i;
        if (!visible) {
          this.dummy.scale.setScalar(0);
        } else {
          const t = ((i + row * 0.5) / n) * perimeter;
          const side = Math.floor(t / (half * 2));
          const u = (t % (half * 2)) - half;
          const off = half + 0.35 + row * 0.9;
          let x = c;
          let z = c;
          if (side === 0) [x, z] = [c + u, c - off];
          else if (side === 1) [x, z] = [c + off, c + u];
          else if (side === 2) [x, z] = [c - u, c + off];
          else [x, z] = [c - off, c - u];
          const wob = Math.sin(this.clockTime * 2 + i * 1.7 + row);
          this.dummy.position.set(x, 0.35 + row * 0.25 + wob * 0.08, z);
          this.dummy.rotation.set(i, this.clockTime * 0.5 + i, 0);
          this.dummy.scale.setScalar((0.75 + 0.25 * wob) * (row ? 1.1 : 0.85));
        }
        this.dummy.updateMatrix();
        this.poison.setMatrixAt(idx, this.dummy.matrix);
      }
    }
    this.poison.instanceMatrix.needsUpdate = true;
  }
}

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

/** White bricks with light mortar lines; the wall instance colour tints it blue. */
function brickTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#c3cff0';
  const rows = 4;
  const rh = 128 / rows;
  for (let r = 0; r < rows; r++) {
    g.fillRect(0, r * rh - 3, 128, 6);
    const off = r % 2 === 0 ? 0 : 32;
    for (let x = off; x <= 128; x += 64) g.fillRect(x - 3, r * rh, 6, rh);
  }
  // Soft highlight along the top of each brick.
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (let r = 0; r < rows; r++) g.fillRect(0, r * rh + 4, 128, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Power cube material: green, with a glowing white finger-gun picture on every face.
 * The same picture drives the emissive map, so the gun glows while the green stays toon-shaded.
 */
function makeCubeMaterial(): THREE.MeshToonMaterial {
  const draw = (bg: string) => {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = bg;
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#ffffff';
    g.shadowColor = '#ffffff';
    g.shadowBlur = 10;
    // Side-on finger gun pointing right, filling most of the face. Drawn twice to strengthen the glow.
    for (let i = 0; i < 2; i++) {
      roundRect(g, 8, 52, 18, 50, 6); // cuff
      roundRect(g, 22, 48, 54, 56, 16); // fist
      roundRect(g, 60, 48, 62, 22, 11); // index finger
      roundRect(g, 28, 12, 20, 50, 10); // thumb
    }
    // Creases between the curled fingers.
    g.shadowBlur = 0;
    g.strokeStyle = bg;
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (const y of [76, 90]) {
      g.beginPath();
      g.moveTo(46, y);
      g.lineTo(72, y);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  return toon(0xffffff, { map: draw('#55e85a'), emissive: 0xffffff, emissiveMap: draw('#1d7a22') });
}

const BULLET_EDGE: Record<AmmoKind, number> = {
  normal: 0xd46a00,
  shotgun: 0x6b6b80,
  fire: 0xa82200,
  ice: 0x1f7fb0,
  bouncy: 0x9a1f7f,
  sniper: 0x1f8a2a,
};

/** Ammo box material: the bullet type's colour with its icon on every face. */
function makeAmmoMaterial(kind: AmmoKind): THREE.MeshToonMaterial {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${AMMO[kind].color.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(size / 2, size / 2, 44, 0, Math.PI * 2);
  g.fill();
  g.font = '62px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(AMMO[kind].icon, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return toon(0xffffff, { map: tex, emissive: 0x333333 });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}
