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
