// Shared type definitions for game data. Everything here is plain data so it
// can be written to and read from human-readable JSON save files.

export const STAT_KEYS = ['health', 'mana', 'pAtk', 'mAtk', 'defense', 'resist', 'movement', 'vision', 'pPen', 'pPenPct', 'mPen', 'mPenPct'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_INFO: Record<StatKey, { name: string; short: string; description: string }> = {
  health: { name: 'Health', short: 'HP', description: 'Maximum health. The unit falls at 0.' },
  mana: { name: 'Mana', short: 'MP', description: 'Maximum mana. (No skill costs mana yet.)' },
  pAtk: { name: 'Physical Attack', short: 'P.Atk', description: 'Power of physical skills. A skill deals a % of this as damage.' },
  mAtk: { name: 'Magic Attack', short: 'M.Atk', description: 'Power of magic skills and healing.' },
  defense: { name: 'Defense', short: 'Def', description: 'Reduces damage taken: each point of Defense is +1% effective health.' },
  resist: { name: 'Resist', short: 'Res', description: 'Shrugs off debuffs: each point of Resist is +1% effective resistance to debuffs.' },
  movement: { name: 'Movement', short: 'Move', description: 'Movement points per turn (forest costs 2).' },
  vision: { name: 'Vision', short: 'Vis', description: 'How far the unit can see, in tiles. Enemies outside your units\' vision (or behind rocks) are hidden in fog of war.' },
  pPen: { name: 'Physical Penetration', short: 'P.Pen', description: 'Flat Defense ignored by your Physical damage (after the percent part).' },
  pPenPct: { name: 'Physical Penetration %', short: 'P.Pen%', description: 'Percent of Defense ignored by your Physical damage. Percents from different sources multiply (50% and 25% = 62.5%).' },
  mPen: { name: 'Magic Penetration', short: 'M.Pen', description: 'Flat Defense ignored by your Magical damage (after the percent part).' },
  mPenPct: { name: 'Magic Penetration %', short: 'M.Pen%', description: 'Percent of Defense ignored by your Magical damage. Percents from different sources multiply (50% and 25% = 62.5%).' },
};

/** Penetration stats: shown together as one line per damage type ("P.Pen: 50% | 10"), not in the usual stat lists. */
export const PEN_KEYS = ['pPen', 'pPenPct', 'mPen', 'mPenPct'] as const satisfies readonly StatKey[];
/** Stats with an icon (src/art/stats/<stat>.svg, bundled; see src/art/statIcons.ts). Penetration shares one icon per damage type. */
export const STAT_ICONS: readonly StatKey[] = ['health', 'mana', 'pAtk', 'mAtk', 'defense', 'resist', 'movement', 'vision', 'pPen', 'mPen'];
/** Penetration stats that are whole percents (50 = 50%). */
export const PEN_PCT_KEYS: readonly StatKey[] = ['pPenPct', 'mPenPct'];

/** Talent grades, worst to best. A stat's talent sets how fast it grows with level. */
export const TALENT_GRADES = ['F', 'D', 'C', 'B', 'A', 'S'] as const;
export type Talent = (typeof TALENT_GRADES)[number];
export type Talents = Partial<Record<StatKey, Talent>>;
export type BodyInvestment = Partial<Record<StatKey, number>>;

/**
 * What must be clear between attacker and target:
 *  sight – no sight-blocking terrain (rock). Used by spells and arcing projectiles.
 *  fire  – line of FIRE: no blocking terrain AND no unit (friend or foe) in the way.
 */
export type LosRule = 'sight' | 'fire';

/** Equipment quality tier (equipment.json "qualities"). Base stats scale with it; stat modifiers don't. */
export type QualityId = string;

export interface QualityDef {
  id: QualityId;
  name: string;
  /** Multiplier on the equipment's base stats (Crude 1, Common 2, Fine 4, Masterwork 7). */
  baseMultiplier: number;
  /** Gold value of a weapon or armor of this quality. */
  value: number;
  /** Only enemies use it (Goblin-Made): can't be equipped by the party. */
  enemyOnly: boolean;
}

/** What a weapon or armor gives: flat base stats (x quality), then multipliers on the unit's stats. */
interface GearStats {
  /** Flat stats added before the multipliers, times the quality's baseMultiplier. */
  base: Partial<Stats>;
  /** Multipliers on the unit's stats (1.2 = 120%), applied after base stats. Penetration % (pPenPct, mPenPct) combines multiplicatively with other sources instead (see combinePenPct). */
  modifiers: Partial<Stats>;
}

export interface WeaponDef extends GearStats {
  id: string;
  name: string;
  /** Weapon class ("Mage", "2 Handed"...). */
  class: string;
  /** Short tag drawn on battle tokens. */
  tag: string;
  description: string;
  /** Pose and weapon drawn on figures (src/art/unitArt.js). */
  art: string;
  /** Skills granted by the weapon. The first one is the basic attack. */
  skills: string[];
  /** The weapon's range in tiles (the Basic Attack's, and skills with a `weaponRange`). */
  range: number;
  /** Unarmed: not an item (what a unit without a weapon fights with). */
  builtIn: boolean;
}

export interface ArmorDef extends GearStats {
  id: string;
  name: string;
  description: string;
  /** Outfit drawn on figures (src/art/unitArt.js). */
  outfit: string;
  /** No Armor: not an item. */
  builtIn: boolean;
}

/** An equipped weapon or armor: its type (equipment.json id) and quality. */
export interface Gear {
  type: string;
  quality: QualityId;
  /** Handed out from the party's stash: it goes back there if the member leaves the party. */
  issued?: boolean;
}

/** Kinds of equipment (and of the slots a character wears them in). */
export const GEAR_KINDS = ['weapon', 'armor'] as const;
export type GearKind = (typeof GEAR_KINDS)[number];
/** Kinds of item in the party's stash: equipment, junk (sold at the marketplace) and trophies (turned in at the city gate). */
export const ITEM_KINDS = [...GEAR_KINDS, 'junk', 'trophy'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** A piece of equipment in the party's stash. */
export interface GearItem {
  id: string;
  kind: GearKind;
  type: string;
  quality: QualityId;
}

/**
 * Loot that isn't equipment: junk (broken gear, pelts, goblin-made weapons...) to sell, or a trophy (an ear, a fang...)
 * to turn in at the city gate. Name and value are fixed when it drops.
 */
export interface LootItem {
  id: string;
  kind: 'junk' | 'trophy';
  name: string;
  /** Gold it's worth. */
  value: number;
  /** Where it came from: the enemy type, or "broken" for broken gear. */
  source: string;
}

export type Item = GearItem | LootItem;

/** A piece of gear ordered from the Smithy (paid up front). */
export interface SmithyOrder {
  id: string;
  kind: GearKind;
  type: string;
  quality: QualityId;
  /** Days of work done so far (it's ready at the quality's orderDays). */
  worked: number;
  /** Gold paid (refunded if cancelled before work starts). */
  paid: number;
  /** Day it was ordered. */
  day: number;
}
export const isGearItem = (i: Item): i is GearItem => i.kind === 'weapon' || i.kind === 'armor';

export interface TagDef {
  id: string;
  name: string;
  description: string;
}

/** A status effect definition (Burn, Chilled...). Shields are handled separately. */
export interface StatusDef {
  id: string;
  name: string;
  description: string;
  /** Cleanse removes debuffs. */
  debuff: boolean;
  /** Re-applying adds stacks (otherwise it just refreshes the duration). */
  stacking: boolean;
  /** When the duration counts down: at the start or the end of the affected unit's turn. */
  tick: 'start' | 'end';
  /** Damage per stack at the start of the unit's turn, as a fraction of max health. */
  damagePctMaxHpPerStack?: number;
  /** Stat changes while active (per stack for stacking effects). */
  statMods?: Partial<Stats>;
  /** Percent stat changes while active (-0.25 = -25%), applied after flat changes and terrain. */
  statPct?: Partial<Stats>;
  /**
   * A flat stat bonus worked out from the caster's stats when applied (Protection:
   * Defense + 25% of the caster's M.Atk). Kept on the unit's status as its `amount`.
   */
  casterScaled?: { stat: StatKey; pAtk?: number; mAtk?: number };
  /** Enemies can't target the unit directly or trigger overwatch on it (area attacks still hit). Ends when it attacks. */
  stealth?: boolean;
  /** Stacking statuses: the most stacks it can have. One more turns it into `overflow` instead. */
  maxStacks?: number;
  /** What a stack past `maxStacks` becomes (Chilled -> Frozen), and for how many turns. */
  overflow?: { status: string; turns: number };
  /** Can't move (walk, Dash, Movement skills) and loses its movement AP at the start of its turn. */
  frozen?: boolean;
  /** Loses one stack each time it ticks and ends at 0 stacks (Burn, Chilled), instead of lasting a number of turns. Stacks are turns, not strength. */
  decay?: boolean;
  /** Its damage (damagePctMaxHpPerStack, instantDamagePctMaxHp) is reduced by Defense and absorbed by shields, like a hit. */
  mitigated?: boolean;
  /** Instant: applying it deals this share of the unit's max Health at once (ignores Defense and shields); it isn't kept. */
  instantDamagePctMaxHp?: number;
  /** Toggled on and off by a skill (see SkillDef.toggleStatus); lasts until switched off. */
  toggle?: boolean;
  /** Mana the unit pays at the start of each of its turns to keep it; it switches off when it can't. */
  manaPerTurn?: number;
  /**
   * Toggles: a share of max HP (ignoring Defense and shields) paid when switched on and at the start of each turn
   * (Soul Ignition). It can't be switched on, and switches off, when the unit has no more HP than that.
   */
  hpPctPerTurn?: number;
  /** The next time the unit spends its last AP this turn, it gets one free movement action (Hit and Run). */
  bonusMove?: boolean;
  /** Runs out unused at the end of the turn: the skill that gave it refunds its mana and cooldown (Hit and Run). */
  refundIfUnused?: boolean;
  /** Weapon attacks (basic attacks, Overwatch, opportunity attacks, 'weapon' skills) add this hit to each target they hit. */
  weaponOnHit?: DamagePart;
  /** Statuses each weapon on-hit adds to the target (Fire Weapon: a stack of Burn). */
  weaponOnHitStatus?: { status: string; turns: number; stacks?: number }[];
  /** A weapon enchantment (Arcane, Fire, Ice Weapon): a weapon holds one at a time, so switching one on switches the others off. */
  enchantment?: boolean;
  /** Can't be shrugged off by Resist (Revealed). */
  unresisted?: boolean;
  /** Visible to the other team through fog of war, and can't be Stealthed (Revealed). */
  reveals?: boolean;
  /** Immune to debuffs while active (Tough It Out). */
  debuffImmune?: boolean;
  /** Loses this many AP at the start of its turn, the movement AP first (Staggered from Sucker Punch). */
  apLoss?: number;
  /** The next Mage spell that costs 2 AP or ends the turn costs 1 AP instead; used up by it (Quick Cast). */
  quickCast?: boolean;
  /** A toggle that only lasts the turn it's switched on: it switches off by itself when the unit's turn ends (Quick Cast). */
  thisTurnOnly?: boolean;
  /** Basic attacks cost no AP and ignore their cooldown, one stack per attack (In the Zone). */
  freeBasicAttacks?: boolean;
  /** Leaves a zone on the unit's tile when applied (Explosion: Burning Ground), from the applier's stats. */
  zone?: ZoneDef;
  /** Mana each weapon attack's extra hit costs; without it the status switches off. */
  manaPerHit?: number;
}

/**
 * Damage types. A hit is split by what it scales with: P.Atk, Def and missing Health deal
 * Physical damage, M.Atk deals Magical damage. Both are reduced by Defense for now; the split is
 * where type-specific rules (magic resistance, physical / magic penetration) will hook in.
 */
export const DAMAGE_TYPES = ['physical', 'magical'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** One hit of a damaging skill. Values are fractions (0.8 = 80%). */
export interface DamagePart {
  pAtk?: number;
  mAtk?: number;
  /** Scales with the attacker's Defense (e.g. a shield bash). */
  def?: number;
  /** Fraction of the target's missing health. */
  missingHp?: number;
}

/**
 * How a skill is aimed:
 *  unit      – click a tile in range; affects the unit standing there (empty tiles allowed)
 *  self      – centered on the caster (optionally hitting everything within aoeRadius)
 *  line      – aim at a tile in range; hits the first matching unit on the straight path to it
 *  cone      – pick a direction; sets up an overwatch cone
 *  emptyTile – an empty, walkable tile (e.g. teleport)
 *  move      – a tile the unit can walk to (Dash)
 *  ground    – any tile in range; places a lasting zone there (see ZoneDef), or hits the `shape` around it (Smite)
 *  passive   – never used: always in effect while learned (Fighting Spirit)
 */
export type SkillTarget = 'unit' | 'self' | 'line' | 'cone' | 'emptyTile' | 'move' | 'ground' | 'passive';

/**
 * A lasting area on the ground (Firestorm, Blizzard). Every tile a unit enters inside it
 * hits it once; a unit that ends its turn inside is hit `endTurnHits` times.
 * A hit = `hit` damage (from the caster's stats) + `applyStatus`.
 */
export interface ZoneDef {
  /** Display name (status zones such as Burning Ground; skill zones use the skill's name). */
  name?: string;
  /**
   * Fire, ice or water. A tile holds one elemental effect at a time: a new one replaces the old there.
   * Draft spreads fire zones.
   */
  element?: ZoneElement;
  /** Tiles within this distance of the aimed tile (1.5 = a 3x3 square). */
  radius: number;
  /** How many of the caster's team's turns it lasts (it counts down at the start of each). */
  turns: number;
  /** Damage per hit (none: the zone only applies statuses, e.g. Rain). */
  hit?: DamagePart;
  applyStatus: { status: string; turns: number; stacks?: number }[];
  /** Status stacks moved per hit, only on units that already have that status (Rain: +1 Chilled, -1 Burn). */
  shiftStatus?: { status: string; stacks: number }[];
  endTurnHits: number;
  /** Who it affects: everyone ('any', the default) or only the caster's enemies (Rain). */
  affects?: 'any' | 'enemy';
  /** Percent stat changes for affected units standing in it (Rain: -25% P.Atk and M.Atk). */
  statPct?: Partial<Stats>;
  /**
   * A wind-up (Brutal Strike): harmless to walk through or end a turn on; at the start of the caster's next turn it hits
   * every unit it affects standing on it once, then it's gone.
   */
  delayed?: boolean;
}

export const ELEMENTS = ['fire', 'ice', 'water'] as const;
export type ZoneElement = (typeof ELEMENTS)[number];

/**
 * Action points a skill costs. Units have 2 AP a turn: a movement AP and an action AP.
 *  0     – free action
 *  1     – uses the movement AP if unspent, else the action AP; the turn goes on while AP remain
 *  2     – uses both AP; the turn goes on (free actions still allowed)
 *  'end' – uses all remaining AP and ends the unit's turn
 */
export type ApCost = 0 | 1 | 2 | 'end';
export const AP_COSTS: readonly ApCost[] = [0, 1, 2, 'end'];

export interface ConeDef {
  /** Full width of the cone in degrees. */
  angle: number;
  /** Reach in tiles (Euclidean). Omitted = the skill's range (for 'weapon' skills, the weapon's). */
  radius?: number;
  /** Stop the enemy's movement on the tile where it is hit. */
  interrupt: boolean;
  los?: LosRule;
}

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  target: SkillTarget;
  /** Which units the skill affects. 'any' = friend and foe alike. */
  affects: 'enemy' | 'ally' | 'any';
  /** Euclidean range in tiles (1 = orthogonal neighbours, 1.5 = includes diagonals). */
  range: number;
  minRange: number;
  /** Line requirement for the target tile (omit for melee / no requirement). */
  los?: LosRule;
  /** Turns the skill is unavailable after use (1 = can't be used next turn; 0 = every turn). */
  cooldown: number;
  /** Action points it costs (see ApCost). */
  ap: ApCost;
  /** Mana spent on use. */
  mana: number;
  /** Classification tags (see skills.json "tags"). engage / movement / weapon / free change behavior. */
  tags: string[];
  /** For 'movement' skills: range = floor(rangeScale x Movement). */
  rangeScale?: number;
  /** Damage hits, applied in order. */
  hits?: DamagePart[];
  /** Heals mAtk x the caster's M.Atk, plus missingHp x the target's missing HP (Emergency Heal). */
  heal?: { mAtk: number; missingHp?: number };
  /** Shield points: a fraction of the target's max HP and/or of the caster's M.Atk. */
  shield?: { maxHpPct?: number; mAtk?: number; turns: number };
  applyStatus?: { status: string; turns: number; stacks?: number }[];
  knockback?: number;
  cleanse?: boolean;
  /** For target 'self': affect units within this distance of the caster. For 'emptyTile' (Heroic Leap): of the tile it lands on. */
  aoeRadius?: number;
  cone?: ConeDef;
  /** For target 'ground': the zone it places. */
  zone?: ZoneDef;
  teleport?: boolean;
  /** Dash next to the target (path of at most `range` steps, diagonals allowed) before hitting it. With `teleport`: appear next to it instead. */
  charge?: boolean;
  /** Skill-tree skills: the character level needed to learn it (1 = from the start). */
  level: number;
  /** Hit with the user's weapon basic attack this many times (in place of `hits`). */
  basicAttack?: number;
  /** For `basicAttack` skills: damage multiplier for each swing in order (Double Strike: [1, 0.5]). Missing = 1. */
  basicAttackDamage?: number[];
  /**
   * Damage multiplier from the target's missing Health (Execute): 1x at full Health, growing smoothly to `max`
   * at `atHealth` of max Health and below. Uses Health before the hit; on-hit effects aren't multiplied.
   */
  missingHpBonus?: { max: number; atHealth: number };
  /** Engage the target (as the Engage tag does) only when it is within this many tiles (Basic Attack: adjacent = 1.5). */
  engageWithin?: number;
  /** Statuses put on the user before the skill resolves (never resisted). */
  selfStatus?: { status: string; turns: number; stacks?: number }[];
  /** Damage the user takes (after its own Defense) when the target survives the hits. */
  recoilIfSurvives?: DamagePart;
  /** A basic attack with switchable modes (the Bow): skill ids, the first is the default. */
  modes?: string[];
  /** Short name of a mode skill (Direct, Indirect, Melee). */
  modeName?: string;
  /** Range as a multiple of the weapon's range (needs `range` on the weapon). */
  weaponRange?: number;
  /** For `basicAttack` skills: use the weapon mode with this tag (e.g. 'melee') instead of the current mode. */
  basicMode?: string;
  /** Cycles the user's weapon to its next mode. */
  switchMode?: boolean;
  /** Switch this status on (paying the skill's mana) or, if it's on, off again (free). */
  toggleStatus?: string;
  /** Toggles: the cooldown starts when it switches off, not when it's switched on (Soul Ignition). */
  cooldownAfterOff?: boolean;
  /** The user gets a stack of this status per unit the skill hit, allies included (Heroic Leap: Heroic Guard). */
  selfStatusPerUnitHit?: { status: string; turns: number };
  /** Passives: extra Vision while Stealthed (Scout). */
  stealthVision?: number;
  /** For target 'ground' without a zone: the tiles it hits around the aimed tile ('cross' = the tile and its 4 neighbours). */
  shape?: 'cross';
  /** Damage multiplier against units with a unit tag (Smite: x2 against Evil). */
  bonusVsTag?: { tag: string; mult: number };
  /** Status stacks moved on targets that already have that status (Draft: +1 Burn on burning targets). */
  shiftStatus?: { status: string; stacks: number }[];
  /** Fire zones on the tiles hit spread to every tile within this distance of them, keeping their duration (Draft). */
  spreadFire?: number;
  /** After hitting the target, push it this many tiles in a direction the user picks (Sonic Boom). */
  push?: number;
  /** After the first strike, break away for free and charge a second target within `range` of where you landed (Blitz). */
  followUp?: boolean;
  /** Only on an engaged target (engaged with someone else), from one of the 3 tiles behind it (Backstab). */
  backstab?: boolean;
  /** Extra Physical Penetration % on this skill's hits, combined multiplicatively with the user's own. */
  pPenPct?: number;
  /** The unit right behind the target (away from the user) takes this share of the user's basic attack (Power Strike: 1 = 100%). */
  pierce?: number;
  /** For 'weapon' self areas without a radius: added to the weapon's range (Circle Swing (Spear): -0.5). */
  weaponRangeBonus?: number;
}

export type SkillTab = string;

export interface SkillTreeDef {
  id: string;
  name: string;
  tab: SkillTab;
  skills: string[];
}

export const BODY_MODELS = ['m1', 'm2', 'm3', 'm4', 'f1', 'f2', 'f3', 'f4'] as const;
export type BodyModel = (typeof BODY_MODELS)[number];
/** Body models only enemies use (bandits). */
export const ENEMY_MODELS = ['b1', 'b2', 'b3', 'b4', 'g1', 'g2', 'o1', 'o2', 's1', 's2'] as const;
export type EnemyModel = (typeof ENEMY_MODELS)[number];
export type UnitModel = BodyModel | EnemyModel;

export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];
export const SKIN_TONES = ['pale', 'light', 'fair', 'olive', 'lightBrown', 'brown'] as const;
export type SkinTone = (typeof SKIN_TONES)[number];
export const HAIR_STYLES = {
  male: ['crewCut', 'bowlCut', 'permed', 'tied'],
  female: ['bobCut', 'ponytail', 'crownBraid', 'downWithBangs', 'braided', 'bun'],
} as const;
export type HairStyle = (typeof HAIR_STYLES)[Sex][number];
export const HAIR_COLORS = ['black', 'darkBrown', 'brown', 'auburn', 'red', 'blonde', 'ash'] as const;
export type HairColor = (typeof HAIR_COLORS)[number];
export const FACE_COUNT = 4;

/** A custom look, drawn at runtime by src/art/unitArt.js. */
export interface Look {
  sex: Sex;
  skin: SkinTone;
  /** 1-4 (each sex has its own four faces). */
  face: number;
  hair: HairStyle;
  hairColor: HairColor;
}

export interface Appearance {
  /** Color of the unit's base (the disc it stands on) and of an adventurer's clothes. */
  color: string;
  /** Body model drawn for enemies (src/art/unitArt.js), dressed in its armor. */
  model?: UnitModel;
  /** Custom look (adventurers). Used instead of `model` when present. */
  look?: Look;
}

export type MonsterKind = 'rat' | 'slime' | 'wolf' | 'spider' | 'bear' | 'troll' | 'wraith' | 'wyvern' | 'demon' | 'human';

/**
 * How an enemy type fights (see ai.ts):
 *  beast  – acts alone, goes for the nearest target, flees when hurt
 *  tribal – fights as a group in a loose formation; the whole group may flee
 *  human  – fights tactically, flees from danger, surrenders when it can't escape (can be taken prisoner)
 *  evil   – spirits and demons: no self-preservation, goes for kills
 */
export type EnemyAi = 'beast' | 'tribal' | 'human' | 'evil';
export const ENEMY_AIS: readonly EnemyAi[] = ['beast', 'tribal', 'human', 'evil'];

/** An enemy type from enemies.json. */
export interface EnemyDef {
  id: string;
  name: string;
  /** Lowest and highest level this type ever appears at. */
  levels: [number, number];
  /** Share of the encounter budget one unit uses. */
  threat: number;
  /** How it fights. */
  ai: EnemyAi;
  /** Name of quests where this type is the main foe ("Wolf Pack"). */
  questTitle: string;
  /** Monsters: public/art/monsters/<kind>.svg (color is used by tools/generate-art.mjs).
   *  Humans: body models to pick from (default: the adventurer models). */
  art: { kind: MonsterKind; color?: string; models?: UnitModel[] };
  /** Stats at the lowest level. */
  stats: Stats;
  growthPerLevel: Partial<Stats>;
  /** First skill = basic attack (for human types with a weapon, the weapon's basic attack comes first). */
  skills: string[];
  skillsByLevel: Record<number, string[]>;
  /** Humanoid types: the gear they can turn up with (one is picked per enemy). Empty = fights with its body. */
  loadouts: EnemyLoadout[];
  /** Quality of their gear: 'crude' (with a commonPerLevel chance of Common) or an enemy-only tier (Goblin-Made). */
  gearQuality: QualityId;
  /** 'basic' = only the weapon's basic attack; 'all' = every weapon skill. */
  weaponSkillUse: 'basic' | 'all';
  /** Unit tags ("evil"): see enemies.json "unitTags". Skills can do more against some (Smite vs Evil). */
  tags: string[];
  /** Non-human types: the trophy and junk item it drops ("{weapon}" in the junk name = its weapon's name). Humans drop their gear. */
  drops?: { trophy: string; junk: string };
}

/** One way a humanoid enemy type can be equipped. */
export interface EnemyLoadout {
  /** Display name ("Bandit Thug"). */
  name: string;
  weapon: string;
  /** Armor type; missing = no armor. */
  armor?: string;
  /** Extra skills this loadout fights with. */
  skills: string[];
}

/** Traits an adventurer can have (see traits.ts). */
export const TRAIT_IDS = ['protagonist'] as const;
export type TraitId = (typeof TRAIT_IDS)[number];

/** A party member (Adventurer) or an enemy. Adventurers' stats come from level + weapon. */
export interface Character {
  id: string;
  name: string;
  level: number;
  xp: number;
  /** Enemies only: the enemies.json type. Their stats and skills come from that type. */
  enemyType?: string;
  /** Equipped weapon (missing / null = Unarmed). Monsters fight with their bodies and never have one. */
  weapon?: Gear | null;
  /** Equipped armor (missing / null = No Armor). */
  armor?: Gear | null;
  /**
   * A companion's own gear they took off for a piece from the party's stash: it stays in their own pack (the party
   * can't take it), and they put it back on when they leave.
   */
  ownGear?: { weapon?: Gear; armor?: Gear };
  /** Skills picked from the skill trees (weapon skills are always available). */
  skillIds: string[];
  appearance: Appearance;
  /** Adventurers: talent grade per growing stat (rolled at creation). Missing = C (100% growth). */
  talents?: Talents;
  /** Adventurers: skill points invested per stat (Body tab). Each adds 2x the stat's base growth per level. */
  body?: BodyInvestment;
  /** Adventurers: the battle skill bar, slot by slot (10 per page, hotkeys 1-0; null = empty slot). */
  skillBar?: (string | null)[];
  /** Last selected mode of a weapon with modes (a mode skill id, e.g. "indirect_shot"). Kept between battles. */
  weaponMode?: string;
  /** Party members only: how they are bound to the party. */
  contract?: Contract;
  /** Strategic Layer: 0-100, separate from battle HP. Below 100 = injured (can't go on quests). Missing = 100. */
  health?: number;
  /** Strategic Layer: 0-100. Missing = the starting morale (guild.json condition.startingMorale). */
  morale?: number;
  /** Adventurers: lasting traits (the main character is the Protagonist). */
  traits?: TraitId[];
}

// ---- management: contracts, the guild, Arch City ----------------------------------------

/** Party and quest ranks, best first. */
export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';
export const RANKS: readonly Rank[] = ['S', 'A', 'B', 'C', 'D'];
/** An adventurer's own rank, from their level (the same letters as party ranks). */
export type AdventurerRank = 'S' | Rank;

/**
 * main      – the player's own character: permanent, can't be dismissed.
 * mercenary – hired for the next quest only: paid the larger of a fixed fee (up front) and a % of the reward (topped up after a win).
 * companion – permanent member under a negotiated contract (weekly pay, loot cut, food & lodging, term).
 * slave     – permanent member bought at the market or registered from a prisoner: no pay, but needs food & lodging.
 */
export type Contract =
  | { type: 'main' }
  | {
    type: 'mercenary';
    /** Gold paid up front when hired. */
    fee: number;
    /** % of the quest reward. After a win they take whatever their cut is worth beyond the fee. */
    cutPct: number;
  }
  | {
    type: 'companion';
    /** Gold paid every 7th day. */
    basePay: number;
    /** % of each quest reward. */
    lootPct: number;
    /** The party pays their food and lodging every day. */
    foodLodging: boolean;
    termWeeks: number;
    startDay: number;
    /** The contract runs out on this day; renew it within the grace period or they leave. */
    endDay: number;
    /** 0-100. Grows with every quest completed together; lowers demands on renewal. */
    relationship: number;
    /** How demanding they are (1 = average). */
    greed: number;
    /** Wages earned under earlier terms since the last payday (a renewal carries them over), paid on the next payday. */
    carriedWages?: number;
  }
  | {
    type: 'slave';
    price: number;
    origin: 'market' | 'prisoner';
    /** 0-100, like a companion's: moves with how they're treated, and drives Obedience. */
    relationship: number;
    /** 0-100. Below 100, battle stats drop (see combatPenalty). */
    obedience: number;
    /** Day they were last punished (once a day). */
    punishedDay?: number;
  };

/** Terms of a companion contract while negotiating. */
export interface CompanionTerms {
  basePay: number;
  lootPct: number;
  foodLodging: boolean;
  termWeeks: number;
}

/** An adventurer of a rival party (only what the simulation needs). */
export interface RivalMember {
  name: string;
  level: number;
  /** Weapon type (equipment.json id). */
  weaponId: string;
}

export interface RivalParty {
  id: string;
  name: string;
  renown: number;
  /** Rank at the last ranking update (ranks come from leaderboard position). */
  rank: Rank;
  members: RivalMember[];
  founded: number;
  wins: number;
  losses: number;
  /** Day of the last quest, and what happened. */
  lastDay: number;
  last: string;
  /** First day of the current stretch below its rank's renown threshold (0 = not below). */
  belowSince?: number;
}

/** An unaffiliated adventurer at the guild: can be hired as a mercenary or signed as a companion. */
export interface FreeAdventurer {
  character: Character;
  /** How demanding they are (1 = average). */
  greed: number;
  /** Offers they'll still hear before walking away from the table. */
  patience: number;
  /** They won't negotiate again before this day. */
  refusedUntil: number;
}

export interface Quest {
  id: string;
  title: string;
  rank: Rank;
  /** Enemy strength (the battle stage: enemy types and levels). */
  stage: number;
  reward: number;
  renown: number;
  /** Days the trip takes (time passes when it's done). */
  days: number;
  /** Last day it can be accepted. */
  expires: number;
  description: string;
  /** A promotion quest: completing it raises the party to the quest's rank. */
  promotion?: boolean;
  /** Enemy types it sends against the party (enemies.json ids, main foe first). Missing = picked when the battle starts. */
  foes?: string[];
  /** Size of the enemy group in threat points (enemies.json threat per unit), rolled from its rank's count range. */
  count: number;
}

export interface NewsItem {
  day: number;
  text: string;
}

export interface GuildState {
  rivals: RivalParty[];
  pool: FreeAdventurer[];
  board: Quest[];
  news: NewsItem[];
}

/** Someone for sale (slave market) or held for judgement (prisoners). */
export interface Offer {
  character: Character;
  price: number;
}

export interface MarketState {
  /** Slaves for sale. Their `price` is their value; the asking price is value x priceIndex. */
  slaves: Offer[];
  /** Supply and demand: multiplies every price at the market (1 = usual). */
  priceIndex: number;
}

export interface Progress {
  victories: number;
  defeats: number;
}

export interface QuestTab {
  upkeep: number;
  wages: Record<string, number>;
  taxes: Record<string, number>;
}

export interface GameState {
  progress: Progress;
  /** Day 1 is the first day in Arch City. */
  day: number;
  gold: number;
  partyName: string;
  renown: number;
  rank: Rank;
  /** The player's main character (permanent). */
  mainId: string;
  /** Everyone in the party: main character, companions, slaves and hired mercenaries. */
  party: Character[];
  /** Ids of the members who go on the next quest (at most MAX_PARTY_SIZE). */
  lineup: string[];
  guild: GuildState;
  market: MarketState;
  /**
   * Enemies taken prisoner on the last quest, waiting at the city gate: each must be registered (turned in for a bounty or
   * registered as the party's slave) before the party goes on. The party never keeps prisoners.
   */
  prisoners: Offer[];
  /** The party's stash: equipment nobody is using (equip it from Manage Party > Equipment). */
  inventory: Item[];
  /** Items put up for sale at the Marketplace, top first (sold by members on Marketplace duty). */
  marketplace: Item[];
  /** Gear ordered from the Smithy, in queue order (the first few are being worked on). */
  smithyOrders: SmithyOrder[];
  /** The quest the party has accepted and not yet fought. */
  quest: Quest | null;
  /** Day the party last came back from a quest (one quest a day), and who went. */
  lastQuestDay: number;
  questMembers: string[];
  /** What each member does on days they aren't on a quest (by character id; see activityOf for the default). */
  schedule: Record<string, 'recover' | 'training' | 'oddJobs' | 'dayOff' | 'marketplace'>;
  /** Food quality for each member the party feeds (by character id; missing = food.default in guild.json). */
  food: Record<string, 'poor' | 'common' | 'fine' | 'luxury'>;
  /** Where each housed member sleeps in the city (by character id; missing = their default, see defaultLodging): the stables ('outside'), an inn tier or an owned residence. */
  lodging: Record<string, 'outside' | 'standard' | 'highEnd' | 'luxury' | 'outer' | 'middle' | 'inner'>;
  /** Day the party last bought a round of drinks (once a day). */
  drinksDay: number;
  /** First day of the current stretch below the rank's renown threshold (0 = not below). A full week drops a rank. */
  belowRankSince: number;
  /** City rings where the party owns a residence. */
  residences: ('outer' | 'middle' | 'inner')[];
  /**
   * What the party ran up on the road during a multi-day quest, settled at the next End Day: food and lodging, and the
   * wages (companions) and property tax (slaves) of any payday that fell on the trip, by character id.
   */
  tab?: QuestTab;
  /** Messages for the player (newest last). */
  log: NewsItem[];
}
