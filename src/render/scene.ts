import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BULLET, MAP_SIZE, SUPER } from '../sim/config';
import { Tile } from '../sim/map';
import type { Brawler, World } from '../sim/world';
import { HandModel } from './hand';
import { Particles } from './particles';
import { FadeUniforms, addFade, makeFadeUniforms, outlineMaterial, toon, withOutline } from './toon';

// Isometric framing: rotated 45° around the vertical axis and tilted down.
// True isometric is ~35°; a little steeper keeps more of the arena readable.
export const CAMERA_PITCH_DEG = 40;
export const CAMERA_YAW_DEG = 45;
const VIEW_HEIGHT = 14; // tiles visible vertically on a landscape screen

const SLEEVE_COLORS = [0x2f8cff, 0xff4d5e, 0xffb321, 0x9b5bff, 0x2fd17a, 0xff7ad9, 0x1fd6d6, 0xff7f2a, 0xc8e34a, 0x8c96a8];

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private hands = new Map<number, HandModel>();
  private crateMeshes = new Map<number, { mesh: THREE.Mesh; shake: number }>();
  private cubeMeshes = new Map<number, THREE.Mesh>();
  private bulletMeshes = new Map<number, THREE.Mesh>();
  private bulletPool: THREE.Mesh[] = [];
  private superBulletPool: THREE.Mesh[] = [];
  private particles = new Particles();
  private wallFade: FadeUniforms = makeFadeUniforms(0, 1.2);
  private bushFade: FadeUniforms = makeFadeUniforms(1, 2.0);
  private poison: THREE.InstancedMesh;
  private poisonGround: THREE.ShaderMaterial;
  private sun: THREE.DirectionalLight;
  private camTarget = new THREE.Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2);
  private aimLine: THREE.Mesh;
  private aimFan: THREE.Mesh;
  private dummy = new THREE.Object3D();
  private shake = 0;
  private clockTime = 0;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.95);

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    private world: World,
    private playerId: number,
    private isVisible: (b: Brawler) => boolean,
  ) {
    this.scene.background = new THREE.Color(0x1d2b4f);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.zoom = 1;

    this.scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6b5a7a, 1.4));
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
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
    this.poisonGround = this.buildPoisonGround();
    this.poison = this.buildPoisonClouds();
    this.scene.add(this.particles.mesh);

    world.brawlers.forEach((b, i) => {
      const hand = new HandModel(SLEEVE_COLORS[i % SLEEVE_COLORS.length], b.id === playerId, i);
      this.hands.set(b.id, hand);
      this.scene.add(hand.root);
    });

    const aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
    const lineGeo = new THREE.PlaneGeometry(1, 0.5);
    lineGeo.translate(0.5, 0, 0);
    lineGeo.rotateX(-Math.PI / 2);
    this.aimLine = new THREE.Mesh(lineGeo, aimMat);
    this.aimLine.scale.x = BULLET.range;
    this.aimLine.position.y = 0.05;
    this.scene.add(this.aimLine);

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

    // Follow the player (or whoever is still fighting once they're out).
    const follow = player.alive ? player : (w.brawlers.find((b) => b.alive) ?? player);
    this.camTarget.lerp(new THREE.Vector3(follow.x, 0, follow.y), Math.min(1, dt * 6));
    this.placeCamera();

    for (const b of w.brawlers) {
      const hand = this.hands.get(b.id)!;
      if (!b.alive) {
        hand.die();
      }
      const moving = Math.hypot(b.moveX, b.moveY) > 0.1;
      const hidden = !this.isVisible(b);
      hand.update(dt, b.x, b.y, b.facing, moving, hidden);
    }

    this.syncBullets();
    this.syncCrates(dt);
    this.syncCubes();
    this.updatePoison();
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

    // Aim guides.
    const showAim = player.alive && aim.active;
    const angle = Math.atan2(aim.y, aim.x);
    this.aimLine.visible = showAim && !aim.isSuper;
    this.aimFan.visible = showAim && aim.isSuper;
    for (const m of [this.aimLine, this.aimFan]) {
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
      switch (e.type) {
        case 'shot': {
          this.hands.get(e.brawlerId)?.shoot(e.isSuper);
          const b = this.world.brawlers.find((x) => x.id === e.brawlerId)!;
          const tipX = b.x + Math.cos(b.facing) * 0.95;
          const tipY = b.y + Math.sin(b.facing) * 0.95;
          this.particles.burst(tipX, 1.0, tipY, e.isSuper ? 10 : 4, 0xfff3a0, { speed: 2, size: 0.1, life: 0.18, gravity: 0, up: 0.3 });
          if (e.brawlerId === player.id) this.addShake(e.isSuper ? 0.8 : 0.2);
          break;
        }
        case 'hit':
          this.particles.burst(e.x, 0.6, e.y, 7, 0xffffff, { speed: 3, size: 0.1, life: 0.3 });
          if (e.targetId === player.id) this.addShake(0.5);
          break;
        case 'wallHit':
          this.particles.burst(e.x, 0.6, e.y, 4, 0xd8c3a0, { speed: 2, size: 0.09, life: 0.25 });
          break;
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
    const c = document.createElement('canvas');
    c.width = c.height = size * 8;
    const g = c.getContext('2d')!;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        g.fillStyle = (x + y) % 2 === 0 ? '#e9c88f' : '#e2bd82';
        g.fillRect(x * 8, y * 8, 8, 8);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), toon(0xffffff, { map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(size / 2, 0, size / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Raised rim and outer border so the arena reads like a board.
    const border = new THREE.Mesh(new THREE.PlaneGeometry(size + 60, size + 60), toon(0x35486e));
    border.rotation.x = -Math.PI / 2;
    border.position.set(size / 2, -0.02, size / 2);
    this.scene.add(border);
    const rimMat = toon(0x6a4a8c);
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
    const geo = new RoundedBoxGeometry(1, 1.2, 1, 2, 0.1);
    geo.translate(0, 0.6, 0);
    const mat = toon(0xffffff);
    addFade(mat, this.wallFade);
    const walls = new THREE.InstancedMesh(geo, mat, cells.length);
    const hull = new THREE.InstancedMesh(geo, outlineMaterial(0.045, 0x2a1b2e, this.wallFade), cells.length);
    const col = new THREE.Color();
    cells.forEach(([x, y], i) => {
      this.dummy.position.set(x + 0.5, 0, y + 0.5);
      this.dummy.updateMatrix();
      walls.setMatrixAt(i, this.dummy.matrix);
      hull.setMatrixAt(i, this.dummy.matrix);
      const v = ((x * 7 + y * 13) % 5) / 5;
      walls.setColorAt(i, col.setHSL(0.07 + v * 0.02, 0.55, 0.52 + v * 0.06));
    });
    walls.castShadow = true;
    walls.receiveShadow = true;
    this.scene.add(walls, hull);
  }

  private buildBushes() {
    const map = this.world.map;
    const cells: [number, number][] = [];
    for (let y = 0; y < map.size; y++) {
      for (let x = 0; x < map.size; x++) if (map.tiles[y * map.size + x] === Tile.Bush) cells.push([x, y]);
    }
    const perTile = 3;
    const geo = new THREE.IcosahedronGeometry(0.42, 1);
    const mat = toon(0xffffff);
    addFade(mat, this.bushFade);
    const bushes = new THREE.InstancedMesh(geo, mat, cells.length * perTile);
    const hull = new THREE.InstancedMesh(geo, outlineMaterial(0.04, 0x10301a, this.bushFade), cells.length * perTile);
    const col = new THREE.Color();
    let i = 0;
    for (const [x, y] of cells) {
      for (let k = 0; k < perTile; k++) {
        const h = hash(x, y, k);
        this.dummy.position.set(x + 0.2 + h * 0.6, 0.45 + hash(y, x, k) * 0.25, y + 0.2 + hash(k, x, y) * 0.6);
        this.dummy.rotation.set(h * 3, h * 5, 0);
        this.dummy.scale.setScalar(0.95 + h * 0.35);
        this.dummy.updateMatrix();
        bushes.setMatrixAt(i, this.dummy.matrix);
        hull.setMatrixAt(i, this.dummy.matrix);
        bushes.setColorAt(i, col.setHSL(0.3 + h * 0.04, 0.62, 0.38 + h * 0.1));
        i++;
      }
    }
    bushes.castShadow = true;
    this.scene.add(bushes, hull);
  }

  private buildCrates() {
    const geo = new RoundedBoxGeometry(0.86, 0.86, 0.86, 2, 0.08);
    geo.translate(0, 0.43, 0);
    const mat = toon(0xc98a4b);
    const strapGeo = new THREE.BoxGeometry(0.9, 0.16, 0.9);
    const strapMat = toon(0x7a4a2a);
    const gemGeo = new THREE.OctahedronGeometry(0.14);
    const gemMat = new THREE.MeshBasicMaterial({ color: 0x6ef06a });
    for (const c of this.world.crates) {
      const mesh = new THREE.Mesh(geo, mat);
      withOutline(mesh, 0.045);
      mesh.castShadow = mesh.receiveShadow = true;
      const strap = new THREE.Mesh(strapGeo, strapMat);
      strap.position.y = 0.43;
      mesh.add(strap);
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.y = 1.05;
      gem.name = 'gem';
      mesh.add(gem);
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
  private cubeMat = toon(0x55e85a, { emissive: 0x1d7a22 });

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
    for (const [id, m] of this.cubeMeshes) {
      if (!alive.has(id)) {
        m.removeFromParent();
        this.cubeMeshes.delete(id);
      }
    }
  }

  private bulletGeo = new THREE.SphereGeometry(1, 12, 8);
  private bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff27a });
  private superMat = new THREE.MeshBasicMaterial({ color: 0xff9a2e });

  private syncBullets() {
    const alive = new Set<number>();
    for (const b of this.world.bullets) {
      alive.add(b.id);
      let m = this.bulletMeshes.get(b.id);
      if (!m) {
        const pool = b.isSuper ? this.superBulletPool : this.bulletPool;
        m = pool.pop();
        if (!m) {
          m = new THREE.Mesh(this.bulletGeo, b.isSuper ? this.superMat : this.bulletMat);
          const hull = new THREE.Mesh(this.bulletGeo, outlineMaterial(0.35, b.isSuper ? 0x8a2a00 : 0xd46a00));
          m.add(hull);
          m.userData.isSuper = b.isSuper;
        }
        this.scene.add(m);
        this.bulletMeshes.set(b.id, m);
      }
      const r = b.isSuper ? 0.2 : 0.15;
      m.position.set(b.x, 0.95, b.y);
      m.rotation.set(0, -Math.atan2(b.dy, b.dx), 0);
      m.scale.set(r * 2.2, r, r);
    }
    for (const [id, m] of this.bulletMeshes) {
      if (alive.has(id)) continue;
      m.removeFromParent();
      (m.userData.isSuper ? this.superBulletPool : this.bulletPool).push(m);
      this.bulletMeshes.delete(id);
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
          float n = sin(vPos.x * 1.3 + uTime * 1.5) * sin(vPos.y * 1.1 - uTime * 1.2);
          float a = clamp(0.45 + outside * 0.08 + n * 0.08, 0.0, 0.75);
          gl_FragColor = vec4(mix(vec3(0.25, 0.85, 0.35), vec3(0.1, 0.55, 0.25), n * 0.5 + 0.5), a);
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
    const mat = toon(0x4fd65a, { transparent: true, opacity: 0.85 });
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

function hash(a: number, b: number, c: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
