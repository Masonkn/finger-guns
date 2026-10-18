// Gameplay tuning. Distances are in tiles, times in seconds.

export const MAP_SIZE = 50;
export const PLAYER_COUNT = 10;

export const BRAWLER = {
  radius: 0.42,
  speed: 3.6,
  maxHp: 3600,
  maxAmmo: 3,
  reloadTime: 1.4, // seconds per ammo segment
  shotCooldown: 0.28,
  regenDelay: 3, // seconds without shooting or being hit before healing
  regenPerSecond: 0.13, // fraction of max HP
  superChargePerHit: 0.2, // fraction of super gained per landed shot
  bushRevealDistance: 2.4,
};

export const BULLET = {
  speed: 15,
  range: 8.5,
  damage: 640,
  radius: 0.16,
};

export const SUPER = {
  bullets: 5,
  spread: 0.5, // radians, total fan width
  range: 7,
  damage: 900,
  speed: 17,
};

export const CRATE = {
  hp: 3000,
};

export const POWER_CUBE = {
  hpBonus: 400,
  damageBonus: 0.1,
  pickupRadius: 0.7,
};

export const ZONE = {
  startDelay: 20, // seconds before the zone starts closing
  closeDuration: 110, // seconds to reach its smallest size
  minHalfSize: 3,
  damagePerSecond: 900,
};

// --- Kill rewards ------------------------------------------------------------

/** Finger drops: every knockout drops the victim's finger, and picking one up adds a finger to your gun. */
export const FINGERS = {
  max: 5, // fingers on one hand, including the starting index finger
  spread: 0.07, // radians between neighbouring bullets of one multi-finger shot
  // Total damage of a shot that fully connects grows by this fraction per extra finger
  // (5 fingers = 1.8x), split evenly across the bullets so a grazing hit does less.
  damagePerExtraFinger: 0.2,
  pickupRadius: 0.75,
  dropRadius: 1.0, // how far from the death spot the dropped fingers land
};

/** Kill streak: +1 per knockout, back to 0 on death. Stacks with power cubes. */
export const STREAK = {
  damageBonus: 0.07, // per streak level
  hpBonus: 250, // max HP per streak level
  maxBonusLevel: 6, // bonuses stop growing past this streak
};

export type AbilityKind = 'dash' | 'shield' | 'rapidFire';

/** Abilities unlocked by kill streak. Q or the ability button uses the best one that is ready. */
export const ABILITY: Record<AbilityKind, { unlockStreak: number; cooldown: number; duration: number }> = {
  dash: { unlockStreak: 2, cooldown: 6, duration: 0.25 },
  shield: { unlockStreak: 4, cooldown: 12, duration: 1.8 },
  rapidFire: { unlockStreak: 6, cooldown: 15, duration: 2.5 },
};
export const ABILITY_ORDER: AbilityKind[] = ['rapidFire', 'shield', 'dash']; // best first
export const ABILITY_LOCKOUT = 0.6; // seconds after any ability before another can start
export const DASH_SPEED_MULTIPLIER = 3.2; // 0.25s at 3.2x speed is about 2.9 tiles
export const RAPID_FIRE_SHOT_COOLDOWN = 0.2; // replaces BRAWLER.shotCooldown; ammo is not used
