// Moves deliberately follow abilities in namespace order: old discovery replaced
// the ability table with moves, because both have id/name/attrs fields.
export const abilities = Array.from({ length: 101 }, (_, id) => ({ id, name: `特性${id}`, attrs: [] }));
export const moves = Array.from({ length: 101 }, (_, id) => ({ id, name: `招式${id}`, attrs: [], power: 40 }));
export const numericIds = Array.from({ length: 101 }, (_, id) => id);
export const eggMoves = Object.fromEntries(Array.from({ length: 101 }, (_, id) => [id + 1, [10, 20, 30, 40]]));
export const registry = {
  getAllStarters: () => [1, 2],
  getSpecies: id => ({ speciesId: id, name: `模拟物种${id}`, ability1: 1, ability2: 0, abilityHidden: 3,
    getFullUnlocksData: () => 1n | 2n | 4n | 16n | 128n }),
};
