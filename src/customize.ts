import * as THREE from 'three';
import { HAND_COLORS, PlayerLook, TOPPERS, saveLook } from './render/cosmetics';
import { HandModel } from './render/hand';

/**
 * The Customize panel: pick a hand colour and a thumb topper, with a spinning
 * live preview. Choices are saved to localStorage as soon as they're made.
 */
export class CustomizePanel {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private hand: HandModel;
  private raf = 0;
  private last = 0;
  private spin = 0;
  private shotIn = 1;
  private returnTo: HTMLElement | null = null;

  constructor(
    private root: HTMLElement,
    private look: PlayerLook,
    private onChange: (look: PlayerLook) => void,
  ) {
    this.hand = new HandModel(0x2f8cff, 'me', look.color, look.topper);
    this.hand.setRingVisible(false);
    this.scene.add(this.hand.root);
    this.scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6b5a7a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);
    this.camera.position.set(1.55, 1.95, 2.05);
    this.camera.lookAt(0.12, 0.98, 0);

    const colors = root.querySelector<HTMLElement>('.cz-colors')!;
    for (const c of HAND_COLORS) {
      const b = document.createElement('button');
      b.className = 'cz-swatch';
      b.style.background = `#${c.hex.toString(16).padStart(6, '0')}`;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.dataset.color = String(c.hex);
      b.addEventListener('click', () => this.set({ ...this.look, color: c.hex }));
      colors.append(b);
    }
    const toppers = root.querySelector<HTMLElement>('.cz-toppers')!;
    for (const t of TOPPERS) {
      const b = document.createElement('button');
      b.className = 'cz-topper';
      b.textContent = t.name;
      b.dataset.topper = t.id;
      b.addEventListener('click', () => this.set({ ...this.look, topper: t.id }));
      toppers.append(b);
    }
    root.querySelector('#customize-close')!.addEventListener('click', () => this.close());
    this.refreshSelection();
  }

  open(from: HTMLElement) {
    this.returnTo = from;
    from.hidden = true;
    this.root.hidden = false;
    if (!this.renderer) {
      const canvas = this.root.querySelector<HTMLCanvasElement>('.cz-preview')!;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.draw(Math.min(0.1, (now - this.last) / 1000));
      this.last = now;
    };
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.root.hidden = true;
    if (this.returnTo) this.returnTo.hidden = false;
  }

  private set(look: PlayerLook) {
    if (look.color !== this.look.color) this.hand.setSkinColor(look.color);
    if (look.topper !== this.look.topper) this.hand.setTopper(look.topper);
    this.look = look;
    saveLook(look);
    this.onChange(look);
    this.refreshSelection();
  }

  private refreshSelection() {
    this.root.querySelectorAll<HTMLElement>('.cz-swatch').forEach((b) => {
      b.classList.toggle('cz-on', Number(b.dataset.color) === this.look.color);
    });
    this.root.querySelectorAll<HTMLElement>('.cz-topper').forEach((b) => {
      b.classList.toggle('cz-on', b.dataset.topper === this.look.topper);
    });
  }

  private draw(dt: number) {
    const r = this.renderer!;
    const canvas = r.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * r.getPixelRatio()) || canvas.height !== Math.floor(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
    // Turn slowly, and fire now and then so the thumb hammer (and topper) moves.
    this.spin += dt * 0.7;
    this.shotIn -= dt;
    if (this.shotIn <= 0) {
      this.hand.shoot(false);
      this.shotIn = 1.6;
    }
    this.hand.update(dt, 0, 0, -0.45 + Math.sin(this.spin) * 0.6, false, false);
    r.render(this.scene, this.camera);
  }
}
