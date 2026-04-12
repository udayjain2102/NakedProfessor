/** @typedef {{
 * brief:string,
 * material:string,
 * load:number,
 * length:number,
 * width:number,
 * thickness:number,
 * hole:number,
 * cycles:number,
 * temperature:number,
 * maxDeflection:number,
 * fosTarget:number
 * }} AnalysisInputs
 */

/** @type {Record<string, AnalysisInputs>} */
export const presets = {
  hotArm: {
    brief:
      "Design a cantilevered aluminum support arm carrying 1200 N cyclic load at 5 Hz. Keep the plate geometry within 140 mm reach, 36 mm width, and 8 mm thickness with a 10 mm bolt hole. It should survive 2000000 cycles in a 95 C environment and keep tip deflection under 2.0 mm.",
    material: "6061-T6 Aluminum",
    load: 1200,
    length: 140,
    width: 36,
    thickness: 8,
    hole: 10,
    cycles: 2000000,
    temperature: 95,
    maxDeflection: 2,
    fosTarget: 1.8
  },
  lightBracket: {
    brief:
      "Design a lightweight bracket that carries 500 N, stays under 200 g, fits inside a 100 mm by 50 mm envelope, uses a 6 mm hole, and sees occasional loading. Tip deflection must remain under 1.5 mm.",
    material: "7075-T6 Aluminum",
    load: 500,
    length: 100,
    width: 50,
    thickness: 6,
    hole: 6,
    cycles: 150000,
    temperature: 30,
    maxDeflection: 1.5,
    fosTarget: 1.7
  },
  factoryMount: {
    brief:
      "Analyze a steel motor mount plate carrying 1800 N with repeated start-stop loading. Current geometry is 120 mm span, 45 mm width, 10 mm thickness, 12 mm hole, and target life is 1000000 cycles at 60 C. Keep service deflection below 1.0 mm.",
    material: "A36 Steel",
    load: 1800,
    length: 120,
    width: 45,
    thickness: 10,
    hole: 12,
    cycles: 1000000,
    temperature: 60,
    maxDeflection: 1,
    fosTarget: 2
  }
};
