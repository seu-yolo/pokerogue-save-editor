// Synthetic test fixture for the 2026-10-04 audit. Never shipped with the extension.
export const aAbilities = Array.from({ length: 101 }, (_, id) => ({ id, name: `特性${id}`, attrs: [] }));
export const zMoves = Array.from({ length: 101 }, (_, id) => ({ id, name: `招式${id}`, attrs: [], power: 40 }));
export const registry = {
  getAllStarters: () => [1],
  getSpecies: id => ({ speciesId: id, name: '模拟物种', ability1: 1, ability2: 0, abilityHidden: 0,
    getFullUnlocksData: () => 1n | 4n | 16n | 128n }),
};
