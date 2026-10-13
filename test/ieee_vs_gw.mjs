// Informational: how often would an IEEE single-precision BASIC (QBasic-style, rounding
// after every operation) print something different from GW-BASIC's MBF arithmetic?
import * as calc from '../js/calc.js';
let seed = 777;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const dec = (a, b, d) => (a + rnd() * (b - a)).toFixed(d);
const gen = {
  'hob-rpm-time': () => ({ DA: dec(1, 6, 3), HELIX: dec(0, 45, 2), SF: dec(50, 400, 0), NT: String(Math.floor(10 + rnd() * 190)), SN: '1', FEED: dec(.01, .2, 3), LC: dec(.5, 10, 3), NC: '2', NP: String(Math.floor(1 + rnd() * 300)), SETUP: dec(0, 300, 0) }),
};
for (const id of ['fd500-diff', 'fauter-diff', 'tos-fo10-diff']) gen[id] = () => { const m = rnd() < .5; return { B: dec(1, 45, 3), D: m ? dec(1, 10, 2) : String(Math.floor(2 + rnd() * 30)), K: '1', Q: m ? 1 : 0 }; };
const N = 2000;
for (const [id, g] of Object.entries(gen)) {
  let diffPrint = 0, diffGear = 0, gearCases = 0;
  const examples = [];
  for (let i = 0; i < N; i++) {
    const inp = g();
    const a = calc.runMachine(id, inp, { numeric: 'gwbasic' });
    const b = calc.runMachine(id, inp, { numeric: 'ieee-single' });
    if (a.reportText.join('\n') !== b.reportText.join('\n')) { diffPrint++; if (examples.length < 2) examples.push(`${JSON.stringify(inp)}: GW ${JSON.stringify(a.reportText.join(' | '))} vs IEEE ${JSON.stringify(b.reportText.join(' | '))}`); }
    const def = calc.getBuiltin(id);
    if (i < 300 && def.trains[0] && def.trains[0].strategy === 'legacy-ramgear') {
      const ma = calc.legacyFirstN(a.env.get('R'), a.num, 1, { maxD: 40 })[0];
      const mb = calc.legacyFirstN(b.env.get('R'), b.num, 1, { maxD: 40 })[0];
      if (ma || mb) { gearCases++; if (!ma || !mb || ma.pos !== mb.pos) diffGear++; }
    }
  }
  console.log(`${id.padEnd(16)} printed results differ in ${diffPrint}/${N} cases (${(100 * diffPrint / N).toFixed(1)} %)` + (gearCases ? `; first change-gear answer differs in ${diffGear}/${gearCases}` : ''));
  if (process.argv.includes('--examples')) examples.forEach((e) => console.log('   e.g. ' + e.slice(0, 400)));
}
