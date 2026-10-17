import { BRAWLER, ZONE } from './sim/config';
import type { World } from './sim/world';
import type { GameScene } from './render/scene';

interface Label {
  el: HTMLElement;
  fill: HTMLElement;
  hpText: HTMLElement;
  ammo?: HTMLElement[];
  cubes: HTMLElement;
}

/** DOM overlay: name plates, HP and ammo bars, counters and the super button. */
export class Hud {
  private labels = new Map<number, Label>();
  private left: HTMLElement;
  private cubes: HTMLElement;
  private banner: HTMLElement;
  private popups: { el: HTMLElement; x: number; y: number; t: number }[] = [];

  constructor(
    private root: HTMLElement,
    private world: World,
    private scene: GameScene,
    private playerId: number,
    private superButton: HTMLElement,
  ) {
    const top = el('div', 'hud-top');
    this.left = el('div', 'hud-pill');
    this.cubes = el('div', 'hud-pill hud-cubes');
    top.append(this.left, this.cubes);
    this.banner = el('div', 'hud-banner');
    root.append(top, this.banner);

    for (const b of world.brawlers) {
      const isPlayer = b.id === playerId;
      const plate = el('div', `plate ${isPlayer ? 'plate-me' : 'plate-enemy'}`);
      const name = el('div', 'plate-name');
      name.textContent = b.name;
      const cubes = el('div', 'plate-cubes');
      const bar = el('div', 'plate-bar');
      const fill = el('div', 'plate-fill');
      const hpText = el('div', 'plate-hp');
      bar.append(fill, hpText);
      plate.append(cubes, name, bar);
      const label: Label = { el: plate, fill, hpText, cubes };
      if (isPlayer) {
        const ammoRow = el('div', 'plate-ammo');
        label.ammo = [];
        for (let i = 0; i < BRAWLER.maxAmmo; i++) {
          const seg = el('div', 'ammo-seg');
          const segFill = el('div', 'ammo-fill');
          seg.append(segFill);
          ammoRow.append(seg);
          label.ammo.push(segFill);
        }
        plate.append(ammoRow);
      }
      root.append(plate);
      this.labels.set(b.id, label);
    }
  }

  damagePopup(x: number, y: number, amount: number, onPlayer: boolean) {
    const p = el('div', `popup ${onPlayer ? 'popup-me' : ''}`);
    p.textContent = String(Math.round(amount));
    this.root.append(p);
    this.popups.push({ el: p, x: x + (Math.random() - 0.5) * 0.4, y, t: 0 });
  }

  update(dt: number) {
    const w = this.world;
    const player = w.brawlers.find((b) => b.id === this.playerId)!;

    for (const b of w.brawlers) {
      const label = this.labels.get(b.id)!;
      const visible = b.alive && (b.id === this.playerId || !player.alive || w.canSee(player, b));
      label.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const s = this.scene.toScreen(b.x, b.y, 2.05);
      label.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      label.fill.style.width = `${(b.hp / b.maxHp) * 100}%`;
      label.hpText.textContent = String(Math.ceil(b.hp));
      label.cubes.textContent = b.cubes > 0 ? `◆ ${b.cubes}` : '';
      label.el.classList.toggle('plate-bush', b.inBush);
      if (label.ammo) {
        label.ammo.forEach((seg, i) => {
          const v = Math.max(0, Math.min(1, b.ammo - i));
          seg.style.width = `${v * 100}%`;
          seg.classList.toggle('ammo-ready', v >= 1);
        });
      }
    }

    this.left.innerHTML = `<span class="hud-icon">✋</span> ${w.aliveCount} left`;
    this.cubes.innerHTML = `<span class="hud-icon hud-cube">◆</span> ${player.cubes}`;

    const closing = w.time > ZONE.startDelay;
    const untilClose = Math.ceil(ZONE.startDelay - w.time);
    if (!player.alive || w.winnerId !== null) this.banner.textContent = '';
    else if (!closing && untilClose <= 5) this.banner.textContent = `Poison gas in ${untilClose}…`;
    else if (closing && w.time - ZONE.startDelay < 3) this.banner.textContent = 'The gas is closing in!';
    else if (w.isOutsideZone(player.x, player.y)) this.banner.textContent = 'Get out of the gas!';
    else this.banner.textContent = '';

    const charge = player.superCharge;
    this.superButton.style.setProperty('--charge', `${charge * 100}%`);
    this.superButton.classList.toggle('super-ready', charge >= 1);
    this.superButton.style.display = player.alive && w.winnerId === null ? 'block' : 'none';

    for (const p of this.popups) {
      p.t += dt;
      const s = this.scene.toScreen(p.x, p.y, 1.6 + p.t * 1.6);
      p.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.3 - p.t)})`;
      p.el.style.opacity = String(Math.max(0, 1 - p.t / 0.9));
    }
    this.popups = this.popups.filter((p) => {
      if (p.t < 0.9) return true;
      p.el.remove();
      return false;
    });
  }

  destroy() {
    this.superButton.style.display = 'none';
    for (const l of this.labels.values()) l.el.remove();
    for (const p of this.popups) p.el.remove();
    this.root.querySelectorAll('.hud-top, .hud-banner').forEach((n) => n.remove());
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
