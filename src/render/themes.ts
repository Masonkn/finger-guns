import type { MapTheme } from '../sim/themes';

// How each map theme dresses the arena. The scene reads these; the layout never changes.

export type GroundPattern = 'grass' | 'speckle' | 'stripes' | 'gingham' | 'camo';
export type Decal = 'flower' | 'heart' | 'shamrock' | 'star' | 'leaf' | 'egg' | 'confetti' | 'coin';
/** grass: tall swaying blades. round: the original leafy bushes. pine: little fir trees. */
export type BushKind = 'grass' | 'round' | 'pine';
export type Prop = 'pumpkin' | 'pine' | 'gift' | 'snowman' | 'flag' | 'egg' | 'hay' | 'palm';
export type Ambient = 'snow' | 'confetti' | 'leaves' | 'petals' | 'embers' | 'sparkle';

export interface ThemeLook {
  ground: [string, string]; // checkerboard tiles
  marks: [string, string]; // light and dark detail painted on each tile
  pattern: GroundPattern;
  decals?: { shape: Decal; colors: string[]; chance: number }; // painted on some tiles
  /** Wall brick tints, picked per brick by `wallPattern`. */
  walls: number[];
  wallPattern?: 'random' | 'checker' | 'rows';
  wallEdge?: number; // outline colour
  bush: { kind: BushKind; color: number; spread?: number; edge: number };
  /** Little bright bits on the bushes: flowers, fairy lights, pumpkins, eggs. */
  accents?: { colors: number[]; perTile: number; size?: number; glow?: boolean; egg?: boolean };
  /** Snow on the tops of pine trees. */
  snowCaps?: boolean;
  rim: number; // the raised edge around the arena
  border: number; // the ground beyond it
  sky: number;
  light?: { sky: number; ground: number; hemi: number; sun: number; sunColor: number };
  props?: Prop[]; // decorations outside the arena
  ambient?: { kind: Ambient; colors: number[]; count?: number };
  fireworks?: number[];
}

const SUMMER: ThemeLook = {
  ground: ['#86d64f', '#7bcb47'],
  marks: ['#9fe66a', '#6ab83c'],
  pattern: 'grass',
  walls: [0x63aef0, 0x6badf1, 0x72abf1, 0x78aaf2, 0x7ea9f2],
  bush: { kind: 'grass', color: 0x50d172, edge: 0x0d2a14 },
  rim: 0x8a5a2e,
  border: 0x26395e,
  sky: 0x1d2b4f,
};

const SNOW: Pick<ThemeLook, 'ground' | 'marks' | 'pattern'> = {
  ground: ['#eef4fb', '#e2ebf6'],
  marks: ['#ffffff', '#c9d8ea'],
  pattern: 'speckle',
};

export const THEME_LOOKS: Record<MapTheme, ThemeLook> = {
  summer: SUMMER,

  // Round leafy bushes, like the very first version, in bloom.
  spring: {
    ground: ['#a3e46e', '#97da63'],
    marks: ['#c2f08f', '#80c653'],
    pattern: 'grass',
    decals: { shape: 'flower', colors: ['#ffffff', '#ffe066', '#ff9ecb'], chance: 0.12 },
    walls: [0xb9a7f0, 0xc4b3f5, 0xa996e6, 0xb0c6f7],
    bush: { kind: 'round', color: 0x76ce6a, edge: 0x10301a },
    accents: { colors: [0xff8fc4, 0xffffff, 0xffe066, 0xffb3d9], perTile: 4 },
    rim: 0x9a6a3a,
    border: 0x2f5c7a,
    sky: 0x9fd7ff,
    ambient: { kind: 'petals', colors: [0xffc2de, 0xffffff, 0xff9ecb], count: 60 },
  },

  fall: {
    ground: ['#b9bb5a', '#aeb052'],
    marks: ['#cfcf72', '#959638'],
    pattern: 'grass',
    decals: { shape: 'leaf', colors: ['#e8711f', '#d23c1c', '#f2b02a'], chance: 0.14 },
    walls: [0xb04a32, 0xbc5638, 0xa3402c, 0xc2603f],
    bush: { kind: 'round', color: 0xe0701e, spread: 0.1, edge: 0x4a1d0a },
    rim: 0x6e4524,
    border: 0x3b2c3f,
    sky: 0x40304a,
    props: ['pumpkin', 'hay'],
    ambient: { kind: 'leaves', colors: [0xe8711f, 0xd23c1c, 0xf2b02a], count: 70 },
  },

  winter: {
    ...SNOW,
    walls: [0x9fd2ee, 0xaad9f2, 0x8fc6e6, 0xb6def4],
    wallEdge: 0x1d3c66,
    bush: { kind: 'pine', color: 0x1f7a4a, edge: 0x0b2a1c },
    snowCaps: true,
    rim: 0x7c8fa8,
    border: 0x253a5e,
    sky: 0x1a2a48,
    light: { sky: 0xe8f2ff, ground: 0x8a9ac0, hemi: 1.5, sun: 2.0, sunColor: 0xf2f6ff },
    props: ['pine', 'snowman'],
    ambient: { kind: 'snow', colors: [0xffffff], count: 140 },
  },

  newYear: {
    ground: ['#3d3f86', '#363879'],
    marks: ['#ffd76a', '#c9cde8'],
    pattern: 'speckle',
    decals: { shape: 'confetti', colors: ['#ffd23a', '#ff5fa2', '#5fe3ff', '#ffffff'], chance: 0.12 },
    walls: [0xf2c53d, 0xd9dde8, 0x2a2440],
    wallPattern: 'checker',
    bush: { kind: 'round', color: 0x26604a, edge: 0x0a1f18 },
    accents: { colors: [0xffd76a, 0xffffff], perTile: 5, size: 0.06, glow: true },
    rim: 0xc9a23a,
    border: 0x17163a,
    sky: 0x0d0c26,
    light: { sky: 0xb8b8ff, ground: 0x3a2f5c, hemi: 1.2, sun: 1.8, sunColor: 0xe8e0ff },
    ambient: { kind: 'confetti', colors: [0xffd23a, 0xff5fa2, 0x5fe3ff, 0xffffff], count: 90 },
    fireworks: [0xffd23a, 0xff5fa2, 0x5fe3ff, 0xffffff],
  },

  // A calm sunrise: soft gold ground, white marble, doves-white blossoms.
  mlk: {
    ground: ['#e9dcae', '#e0d2a2'],
    marks: ['#f6edc8', '#c9b880'],
    pattern: 'speckle',
    walls: [0xeeeaf4, 0xe2dcec, 0xd6d0e2],
    wallEdge: 0x3a2f5c,
    bush: { kind: 'round', color: 0x3f8f5a, edge: 0x12301f },
    accents: { colors: [0xffffff, 0xf6f0ff], perTile: 3 },
    rim: 0x6e5aa0,
    border: 0x4a3f78,
    sky: 0xf0a868,
    light: { sky: 0xffe2c2, ground: 0x7a6a9a, hemi: 1.4, sun: 2.2, sunColor: 0xffe8c8 },
    ambient: { kind: 'petals', colors: [0xffffff], count: 40 },
  },

  valentines: {
    ground: ['#f7b8c9', '#f0aabe'],
    marks: ['#ffd3df', '#e08aa4'],
    pattern: 'speckle',
    decals: { shape: 'heart', colors: ['#e8264f', '#ffffff', '#ff6f91'], chance: 0.2 },
    walls: [0xe8264f, 0xff6f91, 0xc81d45, 0xff8fae],
    wallEdge: 0x4a0f22,
    bush: { kind: 'round', color: 0x2f8a3e, edge: 0x10301a },
    accents: { colors: [0xe8264f, 0xff3d6a, 0xffffff], perTile: 4, size: 0.1 },
    rim: 0xffffff,
    border: 0x5a1f3d,
    sky: 0x3d1028,
    ambient: { kind: 'petals', colors: [0xe8264f, 0xff6f91, 0xffffff], count: 60 },
  },

  // Marble monuments, neat hedges and gold stars.
  presidents: {
    ground: ['#79c46a', '#6fba60'],
    marks: ['#93d884', '#5ea852'],
    pattern: 'stripes',
    decals: { shape: 'star', colors: ['#ffd23a'], chance: 0.06 },
    walls: [0xf2f2f6, 0xe4e4ec, 0xd8d8e2],
    wallEdge: 0x1b2552,
    bush: { kind: 'round', color: 0x2a7a3a, spread: 0.01, edge: 0x0d2a14 },
    rim: 0x1b2f6b,
    border: 0x1b2552,
    sky: 0x14204a,
    props: ['flag'],
  },

  // Emerald clover field, rainbow walls and pots of gold coins in the bushes.
  stPatricks: {
    ground: ['#3fb04c', '#37a444'],
    marks: ['#5fcf6a', '#2a8a36'],
    pattern: 'grass',
    decals: { shape: 'shamrock', colors: ['#7ee37f', '#1f7a2c'], chance: 0.3 },
    walls: [0xe8333a, 0xf28a1f, 0xf2d21f, 0x38b84a, 0x2f7ae6, 0x8a4fd6],
    wallPattern: 'rows',
    bush: { kind: 'round', color: 0x1f7a2c, edge: 0x0a2610 },
    accents: { colors: [0xffd23a, 0xffc21a], perTile: 3, size: 0.08, glow: true },
    rim: 0x6e4524,
    border: 0x1c4a2a,
    sky: 0x123a22,
    ambient: { kind: 'sparkle', colors: [0xffd23a], count: 40 },
  },

  easter: {
    ground: ['#d4ef9a', '#cae690'],
    marks: ['#e6f8b8', '#a8cf6a'],
    pattern: 'grass',
    decals: { shape: 'egg', colors: ['#ffb3d9', '#9fe3ff', '#fff07a', '#c7a8ff'], chance: 0.1 },
    walls: [0xffb3d9, 0x9fe3ff, 0xfff07a, 0xc7a8ff, 0xa8f0c4],
    wallEdge: 0x4a3a6a,
    bush: { kind: 'round', color: 0x4fb84a, edge: 0x16361a },
    accents: { colors: [0xffb3d9, 0x9fe3ff, 0xfff07a, 0xc7a8ff], perTile: 2, size: 0.11, egg: true },
    rim: 0xffffff,
    border: 0x6fa8d8,
    sky: 0xbfe6ff,
    props: ['egg'],
  },

  mothersDay: {
    ground: ['#d8c9f0', '#cfbde9'],
    marks: ['#ece2fb', '#b3a0d6'],
    pattern: 'speckle',
    decals: { shape: 'flower', colors: ['#ff8fc4', '#ffffff', '#ffe066', '#c78aff'], chance: 0.25 },
    walls: [0xfff4e6, 0xffe8f0, 0xf6e8ff],
    wallEdge: 0x5a3a6a,
    bush: { kind: 'round', color: 0x3f9a4a, edge: 0x10301a },
    accents: { colors: [0xff8fc4, 0xc78aff, 0xffe066, 0xffffff], perTile: 6 },
    rim: 0xff8fc4,
    border: 0x5a3a7a,
    sky: 0x3a2a55,
    ambient: { kind: 'petals', colors: [0xff8fc4, 0xc78aff, 0xffffff], count: 60 },
  },

  // Quiet and green, with red poppies and flags.
  memorial: {
    ground: ['#8cc06a', '#82b660'],
    marks: ['#a3d283', '#6e9e52'],
    pattern: 'grass',
    decals: { shape: 'flower', colors: ['#d8262a'], chance: 0.1 },
    walls: [0xc9ccd4, 0xbcc0ca, 0xd4d6dc],
    wallEdge: 0x24283a,
    bush: { kind: 'round', color: 0x2f7a3a, edge: 0x0d2a14 },
    accents: { colors: [0xd8262a, 0xe8333a], perTile: 3 },
    rim: 0x5a5e6e,
    border: 0x2a3150,
    sky: 0x1b2340,
    props: ['flag'],
  },

  // A freshly mowed backyard.
  fathersDay: {
    ground: ['#8edc66', '#64b844'],
    marks: ['#a2e67c', '#55a238'],
    pattern: 'stripes',
    walls: [0x2a4a8a, 0x335598, 0x24407a],
    wallEdge: 0x0e1a38,
    bush: { kind: 'round', color: 0x2f8a3a, spread: 0.01, edge: 0x0d2a14 },
    rim: 0xb07a46,
    border: 0x3a5a2a,
    sky: 0x8fcfff,
    props: ['hay'],
  },

  juneteenth: {
    ground: ['#a9d06a', '#9fc660'],
    marks: ['#c2e283', '#86ae4a'],
    pattern: 'grass',
    decals: { shape: 'star', colors: ['#ffffff', '#e8333a'], chance: 0.06 },
    walls: [0xc8263a, 0x1f3a8a, 0xf2f2f2],
    wallPattern: 'checker',
    wallEdge: 0x10183a,
    bush: { kind: 'round', color: 0x2a8a3a, edge: 0x0d2a14 },
    accents: { colors: [0xffd23a, 0xe8333a], perTile: 3 },
    rim: 0xc8263a,
    border: 0x1b2a5e,
    sky: 0xf28a3a,
    light: { sky: 0xffe0b8, ground: 0x6a5a7a, hemi: 1.4, sun: 2.2, sunColor: 0xffe2b0 },
    ambient: { kind: 'sparkle', colors: [0xffd23a, 0xffffff], count: 40 },
  },

  july4: {
    ...SUMMER,
    decals: { shape: 'star', colors: ['#ffffff'], chance: 0.08 },
    walls: [0xe8333a, 0xf4f4f8, 0x2a4ac8],
    wallPattern: 'rows',
    wallEdge: 0x10183a,
    border: 0x14204a,
    sky: 0x0e1430,
    light: { sky: 0xd8dcff, ground: 0x5a4a7a, hemi: 1.3, sun: 2.0, sunColor: 0xffe6d0 },
    props: ['flag'],
    fireworks: [0xe8333a, 0xffffff, 0x4a7aff],
  },

  // End-of-summer picnic: a blue gingham blanket and a red barn.
  laborDay: {
    ground: ['#d6e6f7', '#b4cff0'],
    marks: ['#ffffff', '#8fb2e2'],
    pattern: 'gingham',
    walls: [0xb8382a, 0xc4452f, 0xa83022],
    wallEdge: 0x3a0f0a,
    bush: { kind: 'grass', color: 0xc9a83a, spread: 0.02, edge: 0x4a3810 },
    rim: 0x8a5a2e,
    border: 0x4a7a3a,
    sky: 0x8fcfff,
    props: ['hay'],
  },

  // A sandy coast with dune grass and the sea all round.
  columbus: {
    ground: ['#ecd9a4', '#e3cf96'],
    marks: ['#f6e8c0', '#cbb47a'],
    pattern: 'speckle',
    walls: [0x9a8a7a, 0x8a7a6a, 0xa89888],
    wallEdge: 0x2a2018,
    bush: { kind: 'grass', color: 0x8aa83a, spread: 0.03, edge: 0x2a3410 },
    rim: 0xb0844e,
    border: 0x2a86c8,
    sky: 0x7fc8f0,
    props: ['palm'],
  },

  halloween: {
    ground: ['#4c4060', '#443858'],
    marks: ['#5e5276', '#342a46'],
    pattern: 'speckle',
    walls: [0x8a8a9a, 0x7a7a8c, 0x9a9aa8],
    wallEdge: 0x0c0818,
    bush: { kind: 'round', color: 0x3a2a4a, spread: 0.02, edge: 0x0c0818 },
    accents: { colors: [0xff8a1a, 0xffa23a], perTile: 1, size: 0.16, glow: true },
    rim: 0x2a1f3a,
    border: 0x140f22,
    sky: 0x0b0814,
    light: { sky: 0xb8a8ff, ground: 0x2a1f3a, hemi: 1.1, sun: 1.6, sunColor: 0xd8c8ff },
    props: ['pumpkin'],
    ambient: { kind: 'embers', colors: [0xff8a1a, 0x9aff5a], count: 50 },
  },

  // Camouflage ground, sandbag walls and flags.
  veterans: {
    ground: ['#7a8a4e', '#728246'],
    marks: ['#5e6a3a', '#9aa06a'],
    pattern: 'camo',
    decals: { shape: 'star', colors: ['#ffffff'], chance: 0.04 },
    walls: [0xc8b07a, 0xbca46e, 0xd4bc86],
    wallEdge: 0x3a2e18,
    bush: { kind: 'round', color: 0x4a5a2a, edge: 0x1a2010 },
    rim: 0x5a4a2e,
    border: 0x2a3150,
    sky: 0x1b2340,
    props: ['flag'],
  },

  // Harvest field: corn-stalk bushes, pumpkins and falling leaves.
  thanksgiving: {
    ground: ['#c99a58', '#bf9050'],
    marks: ['#dcb06a', '#a67a3e'],
    pattern: 'grass',
    decals: { shape: 'leaf', colors: ['#e8711f', '#b8381c', '#f2b02a'], chance: 0.1 },
    walls: [0x8a5a2e, 0x9a6a3a, 0x7a4e26],
    wallEdge: 0x2a1808,
    bush: { kind: 'grass', color: 0xd9b23a, spread: 0.02, edge: 0x4a3810 },
    rim: 0x5a3a1e,
    border: 0x4a2f1f,
    sky: 0x3a2418,
    props: ['pumpkin', 'hay'],
    ambient: { kind: 'leaves', colors: [0xe8711f, 0xb8381c, 0xf2b02a], count: 50 },
  },

  christmas: {
    ...SNOW,
    walls: [0xe8333a, 0xf6f6f6],
    wallPattern: 'checker',
    wallEdge: 0x3a0a0f,
    bush: { kind: 'pine', color: 0x1f7a4a, edge: 0x0b2a1c },
    snowCaps: true,
    accents: { colors: [0xff4040, 0xffd23a, 0x4ad8ff, 0x7aff6a, 0xff7ad8], perTile: 8, size: 0.07, glow: true },
    rim: 0xc81d2a,
    border: 0x1f3350,
    sky: 0x0f1a30,
    light: { sky: 0xe8f2ff, ground: 0x8a9ac0, hemi: 1.4, sun: 1.9, sunColor: 0xfff2e0 },
    props: ['pine', 'gift', 'snowman'],
    ambient: { kind: 'snow', colors: [0xffffff], count: 140 },
  },
};
