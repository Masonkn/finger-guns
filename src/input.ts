import type { GameScene } from './render/scene';

export interface PlayerIntent {
  moveX: number; // world space
  moveY: number;
  aimX: number; // world space direction, 0,0 for none
  aimY: number;
  aimActive: boolean; // show the aim guide
  superAiming: boolean;
  fire: boolean;
  superFire: boolean;
  autoAim: boolean; // fire at the nearest target instead of aimX/aimY
  ability: boolean; // use the current kill-streak ability
}

interface Stick {
  pointerId: number;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  maxDrag: number;
  el: HTMLElement;
  knob: HTMLElement;
}

const DEADZONE = 18; // px a stick must move before it counts as aiming
const STICKS = ['moveStick', 'attackStick', 'superStick'] as const;
type StickSlot = (typeof STICKS)[number];

/**
 * Desktop: WASD/arrows to move, mouse to aim, click (hold) to shoot,
 * hold Space, E or right mouse to aim the super and release to fire it, Q for the ability.
 * Touch: left half is a floating move stick, right half is the attack stick
 * (drag to aim, release to shoot, tap to auto-aim), plus super and ability buttons.
 */
export class Input {
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, inside: false, down: false };
  private superHeld = false;
  private superReleased = false;
  private abilityPressed = false;
  private touchMode = false;
  private moveStick: Stick | null = null;
  private attackStick: Stick | null = null;
  private superStick: Stick | null = null;
  private pendingFire: { dx: number; dy: number; auto: boolean; isSuper: boolean } | null = null;

  constructor(
    private scene: GameScene,
    private root: HTMLElement,
    superButton: HTMLElement,
    abilityButton: HTMLElement,
  ) {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement;
    window.addEventListener('keydown', (e) => {
      if (e.repeat || typing(e)) return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.abilityPressed = true;
      if (e.code === 'Space' || e.code === 'KeyE') {
        this.superHeld = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (typing(e)) return;
      this.keys.delete(e.code);
      if ((e.code === 'Space' || e.code === 'KeyE') && this.superHeld) {
        this.superHeld = false;
        this.superReleased = true;
      }
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
      this.releaseAllSticks(false);
    });
    // Leaving the app (home swipe, app switcher, Slide Over) can swallow a touch's
    // pointerup on iOS, which used to leave a stick held until the page was reloaded.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAllSticks(false);
    });
    window.addEventListener('pagehide', () => this.releaseAllSticks(false));
    // Safety net: once no finger is on the screen, nothing can still be held.
    const allLifted = (e: TouchEvent) => {
      if (e.touches.length === 0) this.releaseAllSticks(true);
    };
    window.addEventListener('touchend', allLifted, { capture: true });
    window.addEventListener('touchcancel', allLifted, { capture: true });

    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
    // Fires after pointerup too; by then the stick is gone, so this only catches lost touches.
    root.addEventListener('lostpointercapture', (e) => this.onPointerCancel(e));
    superButton.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        this.superReleased = true; // click on desktop fires immediately at the mouse
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      this.touchMode = true;
      this.releaseStick('superStick', false);
      this.superStick = this.makeStick(e, false);
    });
    // A tap, not a stick: abilities need no aiming (dash goes the way you're moving).
    abilityButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.pointerType !== 'mouse') this.touchMode = true;
      this.abilityPressed = true;
    });
    abilityButton.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setScene(scene: GameScene) {
    this.scene = scene;
    this.releaseAllSticks(false);
    this.pendingFire = null;
  }

  get isTouch() {
    return this.touchMode;
  }

  /** Gathers this frame's intent. `px, py` is the player position in sim space. */
  read(px: number, py: number): PlayerIntent {
    const intent: PlayerIntent = {
      moveX: 0,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      aimActive: false,
      superAiming: false,
      fire: false,
      superFire: false,
      autoAim: false,
      ability: false,
    };

    // Movement.
    let sx = 0;
    let sy = 0;
    if (this.moveStick) {
      const len = Math.hypot(this.moveStick.dx, this.moveStick.dy);
      if (len > 6) {
        const k = Math.min(1, len / this.moveStick.maxDrag) / len;
        sx = this.moveStick.dx * k;
        sy = -this.moveStick.dy * k;
      }
    } else {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) sy += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) sy -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) sx += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) sx -= 1;
    }
    const mv = this.scene.screenDirToWorld(sx, sy);
    intent.moveX = mv.x;
    intent.moveY = mv.y;

    if (this.touchMode) {
      const stick = this.superStick ?? this.attackStick;
      if (stick && Math.hypot(stick.dx, stick.dy) > DEADZONE) {
        const d = this.scene.screenDirToWorld(stick.dx, -stick.dy);
        intent.aimX = d.x;
        intent.aimY = d.y;
        intent.aimActive = true;
        intent.superAiming = stick === this.superStick;
      }
      if (this.pendingFire) {
        const f = this.pendingFire;
        this.pendingFire = null;
        if (f.auto) intent.autoAim = true;
        else {
          const d = this.scene.screenDirToWorld(f.dx, -f.dy);
          intent.aimX = d.x;
          intent.aimY = d.y;
        }
        if (f.isSuper) intent.superFire = true;
        else intent.fire = true;
      }
    } else if (this.mouse.inside) {
      const g = this.scene.screenToGround(this.mouse.x, this.mouse.y);
      intent.aimX = g.x - px;
      intent.aimY = g.y - py;
      intent.aimActive = true;
      intent.superAiming = this.superHeld;
      intent.fire = this.mouse.down;
      if (this.superReleased) intent.superFire = true;
    }
    this.superReleased = false;
    intent.ability = this.abilityPressed;
    this.abilityPressed = false;
    return intent;
  }

  private onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.touchMode = false;
      this.mouse.inside = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.superHeld = true;
      return;
    }
    e.preventDefault();
    this.touchMode = true;
    // A new touch on a side takes that side over. If the old finger's pointerup was
    // lost, refusing new touches here is what left a stick stuck for good.
    const slot = e.clientX < window.innerWidth / 2 ? 'moveStick' : 'attackStick';
    this.releaseStick(slot, false);
    this[slot] = this.makeStick(e, slot === 'moveStick');
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.mouse.inside = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      return;
    }
    for (const s of [this.moveStick, this.attackStick, this.superStick]) {
      if (!s || s.pointerId !== e.pointerId) continue;
      s.dx = e.clientX - s.originX;
      s.dy = e.clientY - s.originY;
      const len = Math.hypot(s.dx, s.dy);
      const k = len > s.maxDrag ? s.maxDrag / len : 1;
      s.knob.style.transform = `translate(${s.dx * k}px, ${s.dy * k}px)`;
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2 && this.superHeld) {
        this.superHeld = false;
        this.superReleased = true;
      }
      return;
    }
    for (const slot of STICKS) {
      if (this[slot]?.pointerId === e.pointerId) this.releaseStick(slot, true);
    }
  }

  /** The system took the touch away (gesture, alert, too many fingers): drop it without shooting. */
  private onPointerCancel(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.mouse.down = false;
      this.superHeld = false;
      return;
    }
    for (const slot of STICKS) {
      if (this[slot]?.pointerId === e.pointerId) this.releaseStick(slot, false);
    }
  }

  /** Lets go of a stick; `fire` makes an attack/super stick shoot as on a normal release. */
  private releaseStick(slot: StickSlot, fire: boolean) {
    const s = this[slot];
    if (!s) return;
    if (fire && slot !== 'moveStick') {
      const dragged = Math.hypot(s.dx, s.dy) > DEADZONE;
      this.pendingFire = { dx: s.dx, dy: s.dy, auto: !dragged, isSuper: slot === 'superStick' };
    }
    s.el.remove();
    this[slot] = null;
  }

  private releaseAllSticks(fire: boolean) {
    for (const slot of STICKS) this.releaseStick(slot, fire);
  }

  private makeStick(e: PointerEvent, isMove: boolean): Stick {
    // Keep the touch's events on an element that never leaves the page, so its
    // pointerup still bubbles to window even if whatever was under the finger is removed.
    const target = e.currentTarget instanceof HTMLElement ? e.currentTarget : this.root;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; the all-fingers-lifted check cleans up.
    }
    const el = document.createElement('div');
    el.className = `stick ${isMove ? 'stick-move' : 'stick-attack'}`;
    const knob = document.createElement('div');
    knob.className = 'stick-knob';
    el.appendChild(knob);
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY}px`;
    this.root.appendChild(el);
    return { pointerId: e.pointerId, originX: e.clientX, originY: e.clientY, dx: 0, dy: 0, maxDrag: 55, el, knob };
  }
}
