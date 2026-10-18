import { ABILITY, AMMO, AbilityKind, AmmoKind, BRAWLER, ZONE } from './sim/config';
import { type Brawler, type World, fingerCount, nextAbility } from './sim/world';
import type { GameScene } from './render/scene';

interface Label {
  el: HTMLElement;
  fill: HTMLElement;
  hpText: HTMLElement;
  ammo?: HTMLElement[];
  cubes: HTMLElement;
  streak: HTMLElement;
}

const ABILITY_LABEL: Record<AbilityKind, string> = { dash: 'DASH', shield: 'SHIELD', rapidFire: 'RAPID' };
const ABILITY_ICON: Record<AbilityKind, string> = { dash: '💨', shield: '🛡️', rapidFire: '⚡' };

/** DOM overlay: name plates, HP and ammo bars, counters and the super button. */
export class Hud {
  private labels = new Map<number, Label>();
  private left: HTMLElement;
  private cubes: HTMLElement;
  private streak: HTMLElement;
  private fingers: HTMLElement;
  private ammo: HTMLElement;
  private banner: HTMLElement;
  private flash: { text: string; until: number } | null = null;
  private time = 0;
  private popups: { el: HTMLElement; x: number; y: number; t: number }[] = [];

  constructor(
    private root: HTMLElement,
    private world: World,
    private scene: GameScene,
    private playerId: number,
    private superButton: HTMLElement,
    private abilityButton: HTMLElement,
    private isVisible: (b: Brawler) => boolean,
  ) {
    const top = el('div', 'hud-top');
    this.left = el('div', 'hud-pill');
    this.cubes = el('div', 'hud-pill hud-cubes');
    this.fingers = el('div', 'hud-pill hud-fingers');
    this.streak = el('div', 'hud-pill hud-streak');
    this.ammo = el('div', 'hud-pill hud-ammo');
    top.append(this.left, this.cubes, this.fingers, this.streak, this.ammo);
    this.banner = el('div', 'hud-banner');
    root.append(top, this.banner);

    const me = world.brawlers.find((b) => b.id === playerId)!;
    for (const b of world.brawlers) {
      const isPlayer = b.id === playerId;
      const role = isPlayer ? 'plate-me' : b.team === me.team ? 'plate-ally' : 'plate-enemy';
      const plate = el('div', `plate ${role}`);
      const name = el('div', 'plate-name');
      name.textContent = b.name;
      const streak = el('span', 'plate-streak');
      const top = el('div', 'plate-top');
      const cubes = el('span', 'plate-cubes');
      top.append(cubes, streak);
      const bar = el('div', 'plate-bar');
      const fill = el('div', 'plate-fill');
      const hpText = el('div', 'plate-hp');
      bar.append(fill, hpText);
      plate.append(top, name, bar);
      const label: Label = { el: plate, fill, hpText, cubes, streak };
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

  /** Short centre-screen message, e.g. when an ability unlocks. */
  announce(text: string, seconds = 2.5) {
    this.flash = { text, until: this.time + seconds };
  }

  abilityUnlocked(kind: AbilityKind) {
    this.announce(`${ABILITY_LABEL[kind]} unlocked! (Q)`);
  }

  ammoPickedUp(kind: AmmoKind) {
    const a = AMMO[kind];
    this.announce(`${a.icon} ${a.name.toUpperCase()} BULLETS! ${a.blurb}`, 2.2);
  }

  damagePopup(x: number, y: number, amount: number, onPlayer: boolean, blocked = false) {
    const p = el('div', `popup ${onPlayer ? 'popup-me' : ''} ${blocked ? 'popup-block' : ''}`);
    p.textContent = blocked ? 'BLOCK' : String(Math.round(amount));
    this.root.append(p);
    this.popups.push({ el: p, x: x + (Math.random() - 0.5) * 0.4, y, t: 0 });
  }

  update(dt: number) {
    this.time += dt;
    const w = this.world;
    const player = w.brawlers.find((b) => b.id === this.playerId)!;

    for (const b of w.brawlers) {
      const label = this.labels.get(b.id)!;
      const visible = b.alive && this.isVisible(b);
      label.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const s = this.scene.toScreen(b.x, b.y, 2.05);
      label.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      label.fill.style.width = `${(b.hp / b.maxHp) * 100}%`;
      label.hpText.textContent = String(Math.ceil(b.hp));
      label.cubes.textContent = b.cubes > 0 ? `◆ ${b.cubes}` : '';
      label.streak.textContent = b.streak > 0 ? `🔥${b.streak}` : '';
      label.el.classList.toggle('plate-bush', b.inBush);
      if (label.ammo) {
        label.ammo.forEach((seg, i) => {
          const v = Math.max(0, Math.min(1, b.ammo - i));
          seg.style.width = `${v * 100}%`;
          seg.classList.toggle('ammo-ready', v >= 1);
        });
      }
    }

    const left = w.teamSize > 1 ? `${w.aliveTeamCount} teams left` : `${w.aliveCount} left`;
    this.left.innerHTML = `<span class="hud-icon">✋</span> ${left}`;
    this.cubes.innerHTML = `<span class="hud-icon hud-cube">◆</span> ${player.cubes}`;
    const fingers = fingerCount(player);
    this.fingers.style.display = fingers > 1 ? '' : 'none';
    this.fingers.innerHTML = `<span class="hud-icon">☝️</span> ${fingers}`;
    this.streak.style.display = player.streak > 0 ? '' : 'none';
    this.streak.innerHTML = `<span class="hud-icon">🔥</span> ${player.streak}`;
    // Special bullets: what you have and how long it lasts.
    const special = player.alive && player.ammoKind !== 'normal';
    this.ammo.style.display = special ? '' : 'none';
    if (special) {
      const a = AMMO[player.ammoKind];
      const left = Math.max(0, Math.ceil(player.ammoUntil - w.time));
      this.ammo.style.setProperty('--ammo-color', `#${a.color.toString(16).padStart(6, '0')}`);
      this.ammo.innerHTML = `<span class="hud-icon">${a.icon}</span> ${a.name}${Number.isFinite(left) ? ` ${left}s` : ''}`;
      this.ammo.classList.toggle('hud-ammo-low', left <= 4);
    }

    const closing = w.time > ZONE.startDelay;
    const untilClose = Math.ceil(ZONE.startDelay - w.time);
    if (w.winnerId !== null) this.banner.textContent = '';
    else if (!player.alive) this.banner.textContent = w.isTeamAlive(player.team) ? 'Knocked out! Your team fights on…' : '';
    else if (this.flash && this.time < this.flash.until) this.banner.textContent = this.flash.text;
    else if (!closing && untilClose <= 5) this.banner.textContent = `Poison gas in ${untilClose}…`;
    else if (closing && w.time - ZONE.startDelay < 3) this.banner.textContent = 'The gas is closing in!';
    else if (w.isOutsideZone(player.x, player.y)) this.banner.textContent = 'Get out of the gas!';
    else this.banner.textContent = '';

    const charge = player.superCharge;
    this.superButton.style.setProperty('--charge', `${charge * 100}%`);
    this.superButton.classList.toggle('super-ready', charge >= 1);
    this.superButton.style.display = player.alive && w.winnerId === null ? 'block' : 'none';

    // Ability button: shows what Q / a tap will do and how long until it's ready.
    const ab = nextAbility(player, w.time);
    const showAbility = !!ab && player.alive && w.winnerId === null;
    this.abilityButton.style.display = showAbility ? 'block' : 'none';
    if (ab && showAbility) {
      const kind = ab.kind;
      const frac = ab.ready ? 1 : 1 - ab.remaining / Math.max(ab.total, ABILITY[kind].cooldown);
      this.abilityButton.style.setProperty('--cd', `${Math.max(0, frac) * 100}%`);
      this.abilityButton.classList.toggle('ability-ready', ab.ready);
      this.abilityButton.dataset.kind = kind;
      const icon = this.abilityButton.querySelector<HTMLElement>('.ability-icon')!;
      const label = this.abilityButton.querySelector<HTMLElement>('.ability-label')!;
      icon.textContent = ab.ready ? ABILITY_ICON[kind] : String(Math.ceil(ab.remaining));
      label.textContent = ABILITY_LABEL[kind];
    }

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
    this.abilityButton.style.display = 'none';
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
