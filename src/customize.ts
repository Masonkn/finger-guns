import * as THREE from 'three';
import { GLOVES, HAND_COLORS, HandColor, PlayerLook, SLEEVE_COLORS, TOPPERS, saveLook } from './render/cosmetics';
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
    this.hand = new HandModel(look.sleeve, 'me', look.color, look.topper, look.glove);
    this.hand.setRingVisible(false);
    this.scene.add(this.hand.root);
    this.scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6b5a7a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);
    this.camera.position.set(1.8, 2.25, 2.4);
    this.camera.lookAt(0.12, 1.08, 0);

    this.swatches(root.querySelector<HTMLElement>('.cz-colors')!, HAND_COLORS, (hex) => ({ ...this.look, color: hex }));
    this.buttons(root.querySelector<HTMLElement>('.cz-gloves')!, GLOVES, (id) => ({ ...this.look, glove: id }));
    this.swatches(root.querySelector<HTMLElement>('.cz-sleeves')!, SLEEVE_COLORS, (hex) => ({ ...this.look, sleeve: hex }));
    this.buttons(root.querySelector<HTMLElement>('.cz-toppers')!, TOPPERS, (id) => ({ ...this.look, topper: id }));
    root.querySelector('#customize-close')!.addEventListener('click', () => this.close());
    this.refreshSelection();
  }

  private swatches(container: HTMLElement, colors: HandColor[], pick: (hex: number) => PlayerLook) {
    for (const c of colors) {
      const b = document.createElement('button');
      b.className = 'cz-swatch';
      b.style.background = `#${c.hex.toString(16).padStart(6, '0')}`;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.dataset.value = String(c.hex);
      b.addEventListener('click', () => this.set(pick(c.hex)));
      container.append(b);
    }
  }

  private buttons<T extends string>(container: HTMLElement, items: { id: T; name: string }[], pick: (id: T) => PlayerLook) {
    for (const item of items) {
      const b = document.createElement('button');
      b.className = 'cz-topper';
      b.textContent = item.name;
      b.dataset.value = item.id;
      b.addEventListener('click', () => this.set(pick(item.id)));
      container.append(b);
    }
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
    if (look.glove !== this.look.glove) this.hand.setGlove(look.glove);
    if (look.sleeve !== this.look.sleeve) this.hand.setSleeveColor(look.sleeve);
    this.look = look;
    saveLook(look);
    this.onChange(look);
    this.refreshSelection();
  }

  private refreshSelection() {
    const mark = (sel: string, value: string | number) =>
      this.root.querySelectorAll<HTMLElement>(`${sel} button`).forEach((b) => b.classList.toggle('cz-on', b.dataset.value === String(value)));
    mark('.cz-colors', this.look.color);
    mark('.cz-gloves', this.look.glove);
    mark('.cz-sleeves', this.look.sleeve);
    mark('.cz-toppers', this.look.topper);
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
