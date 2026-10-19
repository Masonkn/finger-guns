import { ABILITY, AMMO, AbilityKind, AmmoKind, BRAWLER, PROP_HUNT, PROP_ICONS, PROP_KINDS, PROP_NAMES, PropKind, ZONE } from './sim/config';
import { type Brawler, type World, fingerCount, nextAbility } from './sim/world';
import type { GameScene } from './render/scene';

interface Label {
  el: HTMLElement;
  fill: HTMLElement;
  hpText: HTMLElement;
  ammo?: HTMLElement[];
  ammoRow?: HTMLElement;
  name: HTMLElement;
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
  // Prop hunt only
  private picker: HTMLElement | null = null;
  private pickerButtons = new Map<PropKind, HTMLElement>();
  private pendingProp: PropKind | null = null;
  private sleep: HTMLElement | null = null;
  private sleepCount: HTMLElement | null = null;

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
      const label: Label = { el: plate, fill, hpText, name, cubes, streak };
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
        label.ammoRow = ammoRow;
      }
      root.append(plate);
      this.labels.set(b.id, label);
    }
    if (world.propHunt) this.buildPropHunt();
  }

  /** The block picker for hiders and the sleep mask that covers the seeker's screen. */
  private buildPropHunt() {
    this.root.classList.add('hud-prophunt');
    this.picker = el('div', 'prop-picker');
    for (const kind of PROP_KINDS) {
      const b = el('button', 'prop-pick');
      b.innerHTML = `<span class="prop-pick-icon">${PROP_ICONS[kind]}</span><span>${PROP_NAMES[kind]}</span>`;
      // Its own tap, so picking a block never fires the stick behind it.
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.pendingProp = kind;
      });
      this.pickerButtons.set(kind, b);
      this.picker.append(b);
    }
    this.sleep = el('div', 'sleep-mask');
    const mask = el('div', 'sleep-mask-art');
    mask.innerHTML = '<span class="sleep-eye"></span><span class="sleep-eye"></span>';
    const title = el('div', 'sleep-title');
    title.textContent = "You're it! Shh… everyone is hiding";
    this.sleepCount = el('div', 'sleep-count');
    const tip = el('div', 'sleep-tip');
    tip.textContent = 'Find the blocks that look out of place. Shoot or touch a hider to find them.';
    this.sleep.append(el('div', 'sleep-zzz'), mask, title, this.sleepCount, tip);
    this.sleep.querySelector('.sleep-zzz')!.textContent = 'Z z z';
    this.root.append(this.picker, this.sleep);
  }

  /** The block the player tapped since the last frame, if any. */
  takeProp(): PropKind | null {
    const p = this.pendingProp;
    this.pendingProp = null;
    return p;
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

    const ph = w.propHunt;
    const iSeek = !!ph && ph.seekerId === player.id;
    for (const b of w.brawlers) {
      const label = this.labels.get(b.id)!;
      // A name over a block would give a hider away, so the seeker sees only their own.
      const named = !ph || !iSeek || b.id === player.id || !player.alive;
      const visible = b.alive && this.isVisible(b) && named;
      label.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const s = this.scene.toScreen(b.x, b.y, 2.05);
      label.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      label.fill.style.width = `${(b.hp / b.maxHp) * 100}%`;
      label.hpText.textContent = String(Math.ceil(b.hp));
      label.cubes.textContent = b.cubes > 0 ? `◆ ${b.cubes}` : '';
      label.streak.textContent = b.streak > 0 ? `🔥${b.streak}` : '';
      label.el.classList.toggle('plate-bush', b.inBush);
      if (ph) {
        const seeker = b.id === ph.seekerId;
        label.name.textContent = seeker ? `${ph.phase === 'hide' ? '💤' : '🔦'} ${b.name}` : b.name;
        if (label.ammoRow) label.ammoRow.style.display = seeker ? '' : 'none';
      }
      if (label.ammo) {
        label.ammo.forEach((seg, i) => {
          const v = Math.max(0, Math.min(1, b.ammo - i));
          seg.style.width = `${v * 100}%`;
          seg.classList.toggle('ammo-ready', v >= 1);
        });
      }
    }

    if (ph) {
      this.updatePropHunt(player, dt);
      return;
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

    this.updatePopups(dt);
  }

  private updatePopups(dt: number) {
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

  private updatePropHunt(player: Brawler, dt: number) {
    const w = this.world;
    const ph = w.propHunt!;
    const seeker = w.brawlers.find((b) => b.id === ph.seekerId)!;
    const iSeek = seeker.id === player.id;
    const hiding = w.brawlers.filter((b) => b.alive && b.id !== ph.seekerId).length;
    const left = Math.max(0, Math.ceil(ph.phaseEndsAt - w.time));
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    this.left.innerHTML = `<span class="hud-icon">🙈</span> ${hiding} hiding`;
    this.cubes.innerHTML = `Round ${ph.round}/${ph.rounds}`;
    this.cubes.classList.remove('hud-cubes');
    this.fingers.style.display = ph.phase === 'over' ? 'none' : '';
    this.fingers.innerHTML = `<span class="hud-icon">${ph.phase === 'hide' ? '💤' : '🔦'}</span> ${clock}`;
    this.fingers.classList.toggle('hud-ammo-low', ph.phase === 'seek' && left <= 10);
    this.streak.style.display = 'none';
    this.ammo.style.display = 'none';
    this.superButton.style.display = 'none';
    this.abilityButton.style.display = 'none';

    const nameOf = (id: number | null) => w.brawlers.find((b) => b.id === id)?.name ?? '';
    const flash = this.flash && this.time < this.flash.until ? this.flash.text : '';
    let banner = '';
    if (w.winnerId !== null) banner = '';
    else if (ph.phase === 'over') {
      const winners = ph.roundWinners.map(nameOf);
      const won = ph.roundWinners.includes(player.id)
        ? winners.length > 1 ? `You and ${winners.length - 1} more stayed hidden!` : 'You were the last one found! You win the round!'
        : ph.found.length === w.brawlers.length - 1
          ? `${winners[0]} was the last one found and wins the round!`
          : `Time's up! ${winners.length} hider${winners.length === 1 ? '' : 's'} win the round`;
      const next = ph.round < ph.rounds ? (ph.nextSeekerId === player.id ? " · You're it next!" : ph.nextSeekerId ? ` · ${nameOf(ph.nextSeekerId)} is it next` : '') : '';
      banner = won + next;
    } else if (!player.alive) {
      banner = ph.nextSeekerId === player.id ? "Found! You're it next round" : 'Found! Watch the hunt…';
    } else if (flash) banner = flash;
    else if (ph.phase === 'hide' && !iSeek) {
      const block = player.prop ? PROP_NAMES[player.prop] : 'block';
      banner = ph.blocks === 'pick' ? `Hide! Pick a block · ${seeker.name} wakes up in ${left}` : `Hide! You're a ${block.toLowerCase()} · ${seeker.name} wakes up in ${left}`;
    } else if (ph.phase === 'seek' && ph.phaseEndsAt - w.time > PROP_HUNT.seekTime - 4) {
      banner = iSeek ? 'Find them! Shoot or touch anything that looks wrong' : `${seeker.name} is awake! Hold still…`;
    }
    this.banner.textContent = banner;

    // Block picker: hiders choosing a block while the seeker sleeps.
    const picking = !iSeek && player.alive && ph.phase === 'hide' && ph.blocks === 'pick';
    this.picker!.style.display = picking ? '' : 'none';
    for (const [kind, b] of this.pickerButtons) b.classList.toggle('prop-on', kind === player.prop);
    this.picker!.dataset.hint = picking ? 'Shoot to swap to a random block' : '';

    const asleep = iSeek && ph.phase === 'hide' && w.winnerId === null;
    this.sleep!.classList.toggle('sleep-on', asleep);
    if (asleep) this.sleepCount!.textContent = `${left}`;
    this.updatePopups(dt);
  }

  destroy() {
    this.superButton.style.display = 'none';
    this.abilityButton.style.display = 'none';
    for (const l of this.labels.values()) l.el.remove();
    for (const p of this.popups) p.el.remove();
    this.root.querySelectorAll('.hud-top, .hud-banner, .prop-picker, .sleep-mask').forEach((n) => n.remove());
    this.root.classList.remove('hud-prophunt');
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
