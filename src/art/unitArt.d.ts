// Types for unitArt.js (plain JS so tools/generate-art.mjs can import it without a build step).
export interface FaceSpec {
  eyes: 'dot' | 'round' | 'narrow' | 'sleepy';
  brows: 'soft' | 'heavy' | 'angled' | 'arched';
  mouth: 'smile' | 'flat' | 'grin' | 'small';
  lashes?: boolean;
  freckles?: boolean;
  mole?: boolean;
  blush?: number;
  beard?: boolean;
  stubble?: boolean;
}
export type ArtModel = Record<string, unknown>;
export const MODELS: Record<string, ArtModel>;
export const BANDITS: Record<string, ArtModel>;
export const HUMANOIDS: Record<string, ArtModel>;
export const ART_WEAPONS: string[];
export function figureSvg(id: string, model: ArtModel, weapon: string, scale?: number): string;
export function monsterSvg(kind: string, color: string): string;
export const SKIN_TONES: Record<string, string>;
export const HAIR_COLORS: Record<string, string>;
export const FACES: { male: FaceSpec[]; female: FaceSpec[] };
export const HAIR_ART: Record<string, string>;
export function lookModel(
  look: { sex: string; skin: string; face: number; hair: string; hairColor: string },
  clothColor: string,
  weapon: string,
  armorOutfit?: string,
): ArtModel;
export function outfitFor(model: ArtModel | null, armorOutfit: string, weapon: string): string;
export function dressedModel(id: string, armorOutfit: string, weapon: string): ArtModel;
