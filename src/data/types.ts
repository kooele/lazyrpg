// Shared type definitions for game data. Everything here is plain data so it
// can be written to and read from human-readable JSON save files.

export const STAT_KEYS = ['health', 'mana', 'pAtk', 'mAtk', 'defense', 'resist', 'movement', 'vision'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_INFO: Record<StatKey, { name: string; short: string; description: string }> = {
  health: { name: 'Health', short: 'HP', description: 'Maximum health. The unit falls at 0.' },
  mana: { name: 'Mana', short: 'MP', description: 'Maximum mana. (No skill costs mana yet.)' },
  pAtk: { name: 'Physical Attack', short: 'P.Atk', description: 'Power of physical skills. A skill deals a % of this as damage.' },
  mAtk: { name: 'Magic Attack', short: 'M.Atk', description: 'Power of magic skills and healing.' },
  defense: { name: 'Defense', short: 'Def', description: 'Reduces damage taken: every 100 Defense = +100% effective health.' },
  resist: { name: 'Resist', short: 'Res', description: 'Chance to shrug off debuffs (Burn, Slow...): Resist / (100 + Resist), so 50 = 33%, 100 = 50%.' },
  movement: { name: 'Movement', short: 'Move', description: 'Movement points per turn (forest costs 2).' },
  vision: { name: 'Vision', short: 'Vis', description: 'How far the unit can see (when fog of war is enabled).' },
};

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

export interface WeaponDef {
  id: string;
  name: string;
  /** Short tag drawn on battle tokens. */
  tag: string;
  description: string;
  /** Sprite name: public/art/weapons/<art>.svg */
  art: string;
  /** Multipliers on the Adventurer's base stats (1.5 = 150%). Missing stats = 100%. */
  statMultipliers: Partial<Stats>;
  /** Skills granted by the weapon. The first one is the basic attack. */
  skills: string[];
}

export interface TagDef {
  id: string;
  name: string;
  description: string;
}

/** A status effect definition (Burn, Slow...). Shields are handled separately. */
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
  /** Enemies can't target the unit directly or trigger overwatch on it (area attacks still hit). Ends when it attacks. */
  stealth?: boolean;
}

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
 */
export type SkillTarget = 'unit' | 'self' | 'line' | 'cone' | 'emptyTile' | 'move';

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
  heal?: { mAtk: number };
  shield?: { maxHpPct: number; turns: number };
  applyStatus?: { status: string; turns: number; stacks?: number }[];
  knockback?: number;
  cleanse?: boolean;
  /** For target 'self': affect units within this distance of the caster. */
  aoeRadius?: number;
  cone?: ConeDef;
  teleport?: boolean;
  /** Dash next to the target (path of at most `range` steps, diagonals allowed) before hitting it. With `teleport`: appear next to it instead. */
  charge?: boolean;
  /** Skill-tree skills: the character level needed to learn it (1 = from the start). */
  level: number;
  /** Hit with the user's weapon basic attack this many times (in place of `hits`). */
  basicAttack?: number;
  /** Statuses put on the user before the skill resolves (never resisted). */
  selfStatus?: { status: string; turns: number }[];
  /** Damage the user takes (after its own Defense) when the target survives the hits. */
  recoilIfSurvives?: DamagePart;
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
export const ENEMY_MODELS = ['b1', 'b2', 'b3', 'b4'] as const;
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
  /** Static body art: public/art/units/<model>_<weapon>.svg (enemies). */
  model?: UnitModel;
  /** Custom look (adventurers). Used instead of `model` when present. */
  look?: Look;
}

export type MonsterKind = 'rat' | 'slime' | 'wolf' | 'human';

/** An enemy type from enemies.json. */
export interface EnemyDef {
  id: string;
  name: string;
  /** Lowest and highest level this type ever appears at. */
  levels: [number, number];
  /** Share of the encounter budget one unit uses. */
  threat: number;
  /** Monsters: public/art/monsters/<kind>.svg (color is used by tools/generate-art.mjs).
   *  Humans: body models to pick from (default: the adventurer models). */
  art: { kind: MonsterKind; color?: string; models?: UnitModel[] };
  /** Stats at the lowest level. */
  stats: Stats;
  growthPerLevel: Partial<Stats>;
  /** First skill = basic attack (for human types with a weapon, the weapon's basic attack comes first). */
  skills: string[];
  skillsByLevel: Record<number, string[]>;
  /** Human types: possible weapons, their display names, and extra skills per weapon. */
  weapons: string[];
  weaponNames: Record<string, string>;
  weaponSkills: Record<string, string[]>;
  /** 'basic' = only the weapon's basic attack; 'all' = every weapon skill. */
  weaponSkillUse: 'basic' | 'all';
}

/** A party member (Adventurer) or an enemy. Adventurers' stats come from level + weapon. */
export interface Character {
  id: string;
  name: string;
  level: number;
  xp: number;
  /** Enemies only: the enemies.json type. Their stats and skills come from that type. */
  enemyType?: string;
  /** Weapon id; empty for monsters that fight with their bodies. */
  weaponId: string;
  /** Skills picked from the skill trees (weapon skills are always available). */
  skillIds: string[];
  appearance: Appearance;
  /** Adventurers: talent grade per growing stat (rolled at creation). Missing = C (100% growth). */
  talents?: Talents;
  /** Adventurers: skill points invested per stat (Body tab). Each adds 2x the stat's base growth per level. */
  body?: BodyInvestment;
  /** Adventurers: the battle skill bar, slot by slot (10 per page, hotkeys 1-0; null = empty slot). */
  skillBar?: (string | null)[];
  /** Party members only: how they are bound to the party. */
  contract?: Contract;
}

// ---- management: contracts, the guild, Arch City ----------------------------------------

export type Rank = 'A' | 'B' | 'C' | 'D';
export const RANKS: readonly Rank[] = ['A', 'B', 'C', 'D'];

/**
 * main      – the player's own character: permanent, can't be dismissed.
 * mercenary – hired for the next quest only, for a fixed fee (paid up front) or a % of the reward.
 * companion – permanent member under a negotiated contract (weekly pay, loot cut, food & lodging, term).
 * slave     – permanent member bought at the market or registered from a prisoner: no pay, but needs food & lodging.
 */
export type Contract =
  | { type: 'main' }
  | { type: 'mercenary'; pay: 'fixed' | 'cut'; amount: number }
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
  }
  | { type: 'slave'; price: number; origin: 'market' | 'prisoner' };

export type MemberType = Contract['type'];

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
  slaves: Offer[];
  /** Next day the market gets new stock. */
  restockDay: number;
}

export interface Progress {
  victories: number;
  defeats: number;
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
  /** Captured bandits waiting for judgement: turn them in for a bounty or register them as slaves. */
  prisoners: Offer[];
  /** The quest the party has accepted and not yet fought. */
  quest: Quest | null;
  /** Messages for the player (newest last). */
  log: NewsItem[];
}
