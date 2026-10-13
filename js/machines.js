// machines.js - the 8 routines of the original RAM-GEAR BASIC menu, rebuilt as
// read-only machine definitions in the same format Gary uses for his own machines.
// Formulas are copied term-for-term from source.bas (same order of operations,
// same constants as typed, same single-precision variables), so the gwbasic
// engine reproduces the original results exactly.

const JOB = [
  { name: 'SO', type: 'text', label: 'Sales order number', basic: 'SALES ORDER NUMBER' },
  { name: 'PD', type: 'text', label: 'Part description', basic: 'PART DISCRIPTION' },
];
const UNITS = {
  name: 'Q', type: 'choice', label: 'Cutter pitch system', default: 0,
  options: [
    { value: 0, label: 'Inch - cutter normal diametral pitch (NDP)' },
    { value: 1, label: 'Metric - cutter normal module' },
  ],
  basic: 'ENTER AN (I) FOR INCH OR (M) FOR METRIC MODULE  (original: only a capital M means metric; anything else is inch)',
};
const DIFF_INPUTS = [
  { name: 'B', label: 'Helix angle of the part', unit: 'degrees', example: '30', basic: 'ENTER THE HELIX ANGLE' },
  { name: 'D', label: 'Cutter normal diametral pitch (inch) or normal module (metric)', unit: 'NDP or module', example: '8', basic: 'ENTER CUTTER NDP OR NORMAL MODULE' },
  { name: 'K', label: 'Number of leads (starts) on the hob', unit: 'starts', example: '1', basic: 'ENTER THE NUMBER OF LEADS ON CUTTER' },
  UNITS,
];
const DIFF_TRAIN = [{ kind: 'differential', label: 'Differential change gears (A/B x C/D)', ratio: 'R', strategy: 'legacy-ramgear', inventory: 'legacy-20-88' }];

function differential(id, menu, name, machineConst, constNote, metricExpr, inchExpr, extraNote) {
  return {
    id, menu, name, builtin: true, numeric: 'gwbasic',
    description: `Differential change-gear ratio for helical gears on the ${name}. Original menu option (${menu}).${extraNote ? ' ' + extraNote : ''}`,
    inputs: [...JOB, ...DIFF_INPUTS],
    constants: [
      { name: 'P', expr: '3.14159264#', label: 'Pi as typed in the original (3.14159264, last digit off - no effect in single precision)' },
      { name: 'O', expr: machineConst, label: constNote },
      { name: 'M', expr: '25.4000508#', label: 'Millimetres per inch as typed in the original (25.4000508)' },
    ],
    formulas: [
      { name: 'C', expr: 'B * P / 180', label: 'Helix angle in radians' },
      { name: 'R', expr: `IF(Q = 1, ${metricExpr}, ${inchExpr})`, label: 'Differential ratio' },
    ],
    outputs: [{ name: 'R', label: 'Differential change-gear ratio needed', format: 'basic' }],
    report: ['R'],
    trains: DIFF_TRAIN,
  };
}

export const BUILTIN_MACHINES = [
  {
    id: 'bc-index', menu: '1', name: 'Barber-Colman - index', builtin: true, numeric: 'gwbasic',
    description: 'Index change-gear ratio L/M for the Barber-Colman hobber, then optional "break the numbers down" tables. Original menu option (1).',
    inputs: [
      ...JOB,
      {
        name: 'HAND', type: 'choice', label: 'Hob and helix hand', default: 1,
        options: [
          { value: 1, label: 'Same hand (hob and helix both RH or both LH): M = N x C - 1' },
          { value: 2, label: 'Opposite hand: M = N x C + 1' },
        ],
        basic: 'DO THE HOB AND THE HELIX ANGLE HAVE THE SAME HAND (Y) / DOES THE HOB AND HELIX HAVE OPPOSITE ANGLES (Y)',
      },
      { name: 'C', label: 'Machine constant', unit: '', example: '4', basic: 'ENTER THE CONSTANT' },
      { name: 'N', label: 'Number of teeth in part', unit: 'teeth', example: '40', basic: 'ENTER THE NUMBER OF TEETH' },
    ],
    constants: [],
    formulas: [
      { name: 'L', expr: '15 * C', label: 'Ratio top number (L = 15 x constant)' },
      { name: 'M', expr: 'IF(HAND = 1, ((N * C) - 1), ((N * C) + 1))', label: 'Ratio bottom number' },
      { name: 'F', expr: 'L / M', label: 'Index ratio as a decimal' },
    ],
    outputs: [
      { name: 'L', label: 'Index ratio - top number (L)', format: 'basic' },
      { name: 'M', label: 'Index ratio - bottom number (M)', format: 'basic' },
      { name: 'F', label: 'Index ratio L / M as a decimal', format: 'basic' },
    ],
    report: ['L; "/"; M', 'F'],
    trains: [{ kind: 'index', label: 'Break the numbers down (X x W / J x H)', strategy: 'bc-breakdown', values: ['L', 'M'], from: 20, to: 120 }],
  },
  {
    id: 'bc-feed', menu: '2', name: 'Barber-Colman - feed', builtin: true, numeric: 'gwbasic',
    description: 'Feed change-gear ratio for the Barber-Colman hobber. Original menu option (2).',
    inputs: [
      ...JOB,
      { name: 'CC', label: 'Machine constant', unit: '', example: '1', basic: 'ENTER THE CONSTANT' },
      { name: 'CP', label: 'Circular pitch', unit: 'in', example: '.3927', basic: 'ENTER THE CIRCULAR PITCH' },
      { name: 'B', label: 'Helix angle', unit: 'degrees', example: '30', basic: 'ENTER THE HELIX ANGLE' },
    ],
    constants: [],
    formulas: [
      { name: 'BR', expr: 'B * (3.14159265# / 180)', label: 'Helix angle in radians (the original overwrites B with this and prints it as "ANGLE")' },
      { name: 'R', expr: 'CP / (SIN(BR) * CC * .0375)', label: 'Feed ratio' },
      { name: 'R1', expr: 'R + .0001', label: 'R + .0001 (computed by the original but never used)' },
      { name: 'R2', expr: 'R - .0001', label: 'R - .0001 (computed by the original but never used)' },
    ],
    outputs: [
      { name: 'R', label: 'Feed change-gear ratio needed', format: 'basic' },
      { name: 'BR', label: 'Helix angle in RADIANS (shown by the original as "ANGLE")', format: 'basic' },
    ],
    report: ['"R="; R, "C="; CC, "ANGLE="; BR, "CIR PITCH="; CP'],
    trains: [{ kind: 'feed', label: 'Feed change gears (A/B x C/D)', ratio: 'R', strategy: 'legacy-ramgear', inventory: 'legacy-20-88' }],
  },
  differential('fd500-diff', '3', 'FD-500 Overton', '6', 'Machine constant 6 (FD-500)', 'O * SIN(C) / D / K', '(O / M) * SIN(C) * D / K'),
  differential('fauter-diff', '4', 'Fauter', '11.9367', 'Machine constant 11.9367 (Fauter)', 'O * SIN(C) / D / K', '(O / M) * SIN(C) * D / K'),
  differential('tos-ofa71a-diff', '5', 'TOS OFA-71A', '24', 'Machine constant 24 (TOS OFA-71A)', '(O * SIN(C)) / (P * D * K)', '(O * D * SIN(C)) / (M * P * K)',
    'This is the only differential formula that also divides by pi.'),
  differential('fd320-diff', '6', 'FD-320 Overton', '6', 'Machine constant 6 (same as FD-500 in the original)', 'O * SIN(C) / D / K', '(O / M) * SIN(C) * D / K',
    'In the original this routine is an exact copy of the FD-500 one (same constant 6).'),
  differential('tos-fo10-diff', '7', 'TOS FO-10', '11.9367', 'Machine constant 11.9367 (the original jumps into the Fauter routine, so FO-10 uses the Fauter constant)', 'O * SIN(C) / D / K', '(O / M) * SIN(C) * D / K',
    'In the original the FO-10 routine jumps into the Fauter code (GOTO 4200/4220), so it gives exactly the Fauter result. Please confirm 11.9367 is right for the FO-10.'),
  {
    id: 'hob-rpm-time', menu: '9', name: 'Hob RPM & cutting time', builtin: true, numeric: 'gwbasic',
    description: 'Hob RPM from surface feet, and cutting time per cut, per part and for the whole job. Original menu option (9).',
    inputs: [
      { name: 'DA', label: 'Hob diameter', unit: 'in', example: '3', basic: 'WHAT IS THE HOBB DIAMETER' },
      { name: 'HELIX', label: 'Helix angle', unit: 'degrees', example: '0', basic: 'WHAT IS THE HELIX ANGLE' },
      { name: 'SF', label: 'Surface feet per minute', unit: 'SFM', example: '100', basic: 'WHAT SURFACE FEET ARE YOU WANTING TO RUN' },
      { name: 'NT', label: 'Number of teeth in part', unit: 'teeth', example: '40', basic: 'NUMBER OF TEETH IN PART' },
      { name: 'SN', label: 'Number of starts on hob', unit: 'starts', example: '1', basic: 'NUMBER OR STARTS IN HOBB' },
      { name: 'FEED', label: 'Feed per revolution of the part (enter in inches, e.g. .080 - the original prompt says "thousands" but the number is used as inches)', unit: 'in/rev', example: '.08', basic: 'FEED IN THOUSANDS PER REVALUTION OF PART' },
      { name: 'LC', label: 'Face width of gear (the original asks for "LENGTH OF CUT")', unit: 'in', example: '2', basic: 'LENGTH OF CUT' },
      { name: 'NC', label: 'Number of cuts', unit: 'cuts', example: '1', basic: 'HOW MANY CUTS WILL IT TAKE' },
      { name: 'NP', label: 'Number of parts in the job', unit: 'parts', example: '10', basic: 'HOW MANY PARTS WILL BE CUT' },
      { name: 'SETUP', label: 'Setup time', unit: 'minutes', example: '60', basic: 'SETUP TIME IN MINUTES' },
    ],
    constants: [{ name: 'PIE', expr: '3.141592654#', label: 'Pi as typed in the original' }],
    formulas: [
      { name: 'SC', expr: '((DA * PIE) / 12)', label: 'Hob circumference in feet' },
      { name: 'RPM', expr: 'SF / SC', label: 'Hob RPM' },
      { name: 'QQ', expr: 'RPM / NT * SN', label: 'Part (table) RPM' },
      { name: 'PP', expr: 'QQ * FEED', label: 'Feed in inches per minute' },
      { name: 'CH', expr: 'COS(HELIX * PIE / 180)', label: 'Cosine of helix angle' },
      { name: 'AL', expr: 'LC / CH', label: 'Length of cut along the helix' },
      { name: 'BZ', expr: 'AL / PP', label: 'Minutes for one cut' },
      { name: 'TPP', expr: 'BZ * NC', label: 'Cutting minutes per part' },
      { name: 'TRT', expr: 'SETUP / NP + TPP', label: 'Minutes per part incl. share of setup' },
      { name: 'TJT', expr: '(TRT * NP) / 60', label: 'Total hours for the job' },
      { name: 'TPC', expr: 'TPP / NC', label: 'Minutes per cut' },
    ],
    outputs: [
      { name: 'RPM', label: 'Hob RPM', format: 'basic' },
      { name: 'AL', label: 'Length of cut along the helix (in)', format: 'basic' },
      { name: 'TPC', label: 'Minutes per cut', format: 'basic' },
      { name: 'TRT', label: 'Minutes per part (includes setup share)', format: 'basic' },
      { name: 'TJT', label: 'Total time for the job (hours)', format: 'basic' },
    ],
    report: [
      '"  HOBB DIAMETER: "; DA',
      '"  HOBB RPM: "; RPM',
      '"  HELIX ANGLE; "; HELIX',
      '"  SURFACE FEET PER MIN.: "; SF',
      '"  NUMBER OF TEETH IN PART: "; NT',
      '"  NUMBER OF STARTS IN HOBB: "; SN',
      '"  FEED IN THOUSANDS PER REVALUTION OF PART: "; FEED',
      '"  FACE WIDTH OF GEAR: "; LC',
      '"  LENGTH OF CUT: "; AL',
      '"  NUMBER OF CUTS: "; NC',
      '"  NUMBER OF PARTS IN THE JOB: "; NP',
      '"  SETUP TIME IN MINUTES: "; SETUP',
      '',
      '"                                                MIN. PER CUT .....: "; TPC',
      '"                                                MIN. PER PART ....: "; TRT',
      '"                              TOTAL TIME IN HOURS FOR THE JOB ....: "; TJT',
    ],
    trains: [],
  },
];

function range(a, b, qty) { const g = []; for (let t = a; t <= b; t++) g.push({ teeth: t, qty }); return g; }

export const BUILTIN_INVENTORIES = [
  {
    id: 'legacy-20-88', builtin: true,
    name: 'Original program: every tooth count 20-88 (any gear may repeat)',
    note: 'What the old BASIC search assumes. The legacy search ignores inventories unless you turn on "only use gears from the inventory".',
    gears: range(20, 88, 4),
  },
];

export function deepFreeze(o) {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
}
BUILTIN_MACHINES.forEach(deepFreeze);
BUILTIN_INVENTORIES.forEach(deepFreeze);
