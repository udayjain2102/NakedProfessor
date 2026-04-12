/** @typedef {{E:number, yield:number, uts:number, density:number, fatigueCoeff:number}} Material */

/** @type {Record<string, Material>} */
export const materials = {
  "6061-T6 Aluminum": { E: 69000, yield: 276, uts: 310, density: 2.7, fatigueCoeff: 0.35 },
  "7075-T6 Aluminum": { E: 71700, yield: 503, uts: 572, density: 2.81, fatigueCoeff: 0.42 },
  "A36 Steel": { E: 200000, yield: 250, uts: 400, density: 7.85, fatigueCoeff: 0.5 },
  "304 Stainless": { E: 193000, yield: 215, uts: 505, density: 8, fatigueCoeff: 0.38 },
  "Ti-6Al-4V": { E: 114000, yield: 880, uts: 950, density: 4.43, fatigueCoeff: 0.5 }
};
