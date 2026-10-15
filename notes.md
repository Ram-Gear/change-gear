# RAM-GEAR change-gear program — rebuild notes

Source: `source.bas` (RAM-GEAR "GEAR HOBBING MACHINE PROGRAMS", by Aaron Tagle & friends).
New app: `app/` (static HTML/CSS/JS, no build step, no CDN, works offline).

## 00. v1.7 (2026-10-13): real logins and shared data (Supabase, QC Form project)

**Not pushed** (dev copy only). Live site is still v1.6.

### Sign-in and roles
- Login screen (username + PIN). Same rule as the QC Form: email = `u` + hex(UTF-8(lower(trim(username)))) + `@users.invalid`,
  password = `rg1:` + PIN. `signInWithPassword`; if it fails, Edge Function `rg-admin` `{action:'activate', username, password}` once, then
  one retry. Session kept by supabase-js in localStorage key `ramgear-changegear-auth`.
- After sign-in the app calls `cg_role()`, `cg_can_view()`, `cg_can_edit()`, `cg_can_delete()`.
  - not signed in, or role `none` / `cg_can_view() = false`: login screen only (role none gets "no access" + Sign out).
  - viewer: calculate and view. Hidden: Add a machine, Edit, Duplicate, Copy to edit, Edit index/differential gears, gear-list
    New/Edit/Duplicate/Delete, Save as preset (row + selected), preset add/save/delete/CSV import, Attach/Remove manual, JSON import,
    Upload local data. Edit/copy/new URLs show a read-only view or a notice. Viewer gear-search choices (dropdowns) apply on that page only.
  - admin (`cg_can_edit()`): everything; Delete machine / gear list / manual also needs `cg_can_delete()`.
- Top bar shows the user, role badge and **Sign out**. The UI hiding is convenience; RLS on the server is the real lock.
- supabase-js 2.117.3 is vendored as `app/js/supabase-vendor.js` (UMD build + one `export`), so `ramgear-standalone.html` needs no CDN.
  Publishable key only (`sb_publishable_…`), never a secret key.

### Shared database mapping (store.js -> cgmap.js)
| App data | Table / column |
|---|---|
| custom machine (whole definition: inputs, constants, formulas, outputs, report, trains, numeric…) | `cg_machines` row, `name` = machine name, `notes` = description, `formulas` = `{app:'ramgear-changegear', schema:1, def:{…}}` |
| built-in routine (FD-500, Fauter, FO-10, hob) | maths stays in code. One `cg_machines` row per built-in, keyed by its **name**, `formulas` = `{app, schema, builtin:<id>, override:{trains:{<i>:{strategy, useInventory, gears, tolerance, maxResults, inventory}}}}`. Created (upsert on `name`) by the first admin who saves a gear list / setting / preset for it |
| machine's index gear list | `cg_gear_sets` kind `indexing` |
| machine's differential gear list | `cg_gear_sets` kind `differential` |
| gear quantities | `teeth int[]` repeats each tooth count qty times, sorted (`30 x2` -> `{30,30}`) |
| per-gear notes, list name, qty-0 rows | `cg_gear_sets.notes` = JSON `{"format":"rg-gears-1","name":"…","note":"…","gears":[{"teeth":30,"qty":2,"note":"worn"}]}`; `teeth[]` stays the source of truth for quantities; plain-text notes are tolerated |
| train using its own list | `inventory: "@own:index"` / `"@own:differential"` inside formulas; on load it becomes inventory id `cg-<machine uuid>-<kind>` |
| index preset | `cg_presets` `name` = `z=<n>` (2nd, 3rd set for the same z: `z=<n>#2`, `#3`), `inputs` = `{z}`, `result` = `{A,B,C,D,note}` (C/D null for 2 gears) |
| delete custom machine | soft delete: `deleted_at` set and name changed to `<name> [deleted <iso time>]` so the unique name is free again; its gear sets and presets are hard-deleted |
| built-in "reset" | row kept, override emptied |

Stays on this PC: last inputs, arithmetic setting, gear lists not used by any machine (localStorage `ramgear.changegear.v17.local`),
manual PDFs (IndexedDB). A gear list shared by two machines is stored once per machine (they are separate after reload).
The old v1.6 key `ramgear.changegear.v1` is left untouched as the source for the upload.

**Saving**: every change runs `toRemote()` and diffs against the last synced state; only changed rows are written, in order
(soft-delete removed machines, insert/update machines, delete removed gear sets/presets, upsert changed ones). Writes are serialised.
A failed write shows a red banner ("NOT saved to the shared database …"). Viewers never write. Data is loaded at sign-in; other
users' changes show after a page reload (no live updates).

**Upload my local data to the shared database** (Import / export page, admin only, shown when this PC has v1.6 data): merges the
v1.6 browser data in (same machine id or name replaced), saves, and remembers the upload (`ramgear.changegear.v17.migrated`).

### Tests
- `test/store_cloud.test.mjs` (in `npm test`, 65 checks): gear/preset encoding round trips, whole-data round trip stable, same ratio
  after round trip, QC email rule, sign-in/activate/retry paths, roles none/viewer/admin, admin writes + no-op save + rename + soft
  delete + name reuse, viewer sends no writes, fake RLS denies viewer, local-data upload. Uses `test/mock_supabase.js` (in-memory fake with the cg RLS rules).
- `test/ui_auth.py` (browser, fake): login only when signed out, wrong PIN, admin creates machine/gear sets/preset in DB, sign out,
  viewer read-only checks (22), role none, upload. `--live`: real project, login screen + wrong PIN; rg-admin intercepted in the browser.
- `test/live_readonly.mjs`: real project, anon denied on all 3 tables and 4 RPCs, wrong login refused. Writes nothing.
- Existing browser tests sign in as a fake admin via `test/cgmock.py`.

### Open items
- Live authenticated tests need two accounts in QC admin: a **test viewer** (changegear_role viewer) and a **test admin** (admin),
  with their usernames/PINs, and OK to write test rows (named e.g. `ZZ test …`) that the test deletes afterwards.
- Live gear lists/presets for built-ins only appear once an admin saves something for that routine.
- No live refresh / conflict handling: last save wins per row.

## 0. v1.5 (2026-10-13): simple Add a machine, own gear lists, gear-list CSV

**Add a machine** now opens with two labelled sections instead of free-form formula tables:
- *Index ratio formula*: one box, **Index constant** (default 24); formula pre-built `RIDX = KIDX * K / Z`.
- *Differential ratio formula*: one box, **Differential constant** (default 11.9367, the Fauter value);
  formula pre-built in the Fauter / FD-500 form `RDIFF = IF(Q = 1, KDIFF * SIND(B) / D / K, (KDIFF / MM) * SIND(B) * D / K)`, MM = 25.4.
- Default inputs: Number of teeth in gear (Z), Hob starts (K), Helix angle (B), Normal module or DP (D), Inch/metric (Q).
- Each section has its own gear list dropdown and search type, and a *Remove* button (and *+ Add index/differential ratio* to bring it back).
  Removing a section also drops its formula, constant, result and any default inputs nothing else uses.
- The full inputs/constants/formulas/results/gear-trains tables are still there, folded under **Advanced**. Formula check and preview cover both ratios.
- *Copy to edit* on Fauter / FD-500 shows the same sections (their constant `O` is the differential box); *+ Add index ratio* adds Z, KIDX, RIDX
  and an index train without touching the differential maths (unit-tested: same digits, same printout). FO-10 copies get their literal `24 * K / Z`
  turned into `KIDX * K / Z` with KIDX = 24 (identical result).
- Code: `js/simple.js` (pure helpers: `simpleTemplate`, `addIndex`, `addDifferential`, `removeSection`, `normalizeIndex`, `sectionInfo`).

**Own gear lists per machine.** On save, a new machine (or copy) gets two inventories, `<name> index gears` and `<name> differential gears`
(placeholder one each of 20-88), linked to its trains and recorded in `machine.ownInventories`. Renaming the machine renames them; deleting it
asks whether to delete them too. The machine screen has **Edit index gears / Edit differential gears** buttons (if a train still points at a
built-in list, a copy is made first).

**Gear-list editor** is now a table per gear (tooth count, quantity, optional note) with + Add gear / remove / Clear, and a quick-add box
(`20, 24, 30, 36`, `40-48`, `30 x2`; same tooth count adds quantity). Notes are stored as `{teeth, qty, note}` (old lists without notes still load).

**CSV import / export** (`js/gearcsv.js`): columns `teeth,qty,note`; qty defaults to 1; note optional; header row optional (columns found by name,
any order); a single column of tooth counts works; comma, semicolon or tab separators (Excel); quotes and UTF-8 BOM handled. Import shows a preview
with skipped bad rows (line number and reason) and *Replace my list* / *Add to my list*; nothing is kept until Save. *Export CSV* writes the same
format, and *Download sample CSV* gives an example.

Tests added: `test/simple_csv.test.mjs` (in `npm test`) and browser test `test/ui_new_machine.py` (new machine with index 24*K/Z and a
Fauter-like differential, saves, z=40 K=1 gives index 0.6, both gear match lists appear; own lists, quick add, CSV preview/add/replace with bad rows,
rename, Fauter copy + index, delete with lists).

## 0b. v1.4 (2026-10-13): FO-10 index change gears

Gary: the FO-10 base index formula is **24/z**. The built-in TOS FO-10 machine now has:
* a new input box **"Number of teeth in gear (z)"** (`Z`), used only by the index calculation.
  It reuses the existing hob starts input `K` ("Number of leads (starts) on the hob").
* formula `RIDX = 24 * K / Z`, labelled **"Index ratio = 24 × hob starts ÷ z"** (1 start gives exactly 24/z),
  shown as a second result line.
* a second gear train, kind `index`, strategy "best from inventory" (ranked by error, 4 gears with a
  2-gear option, ratio and error per match), using the new built-in inventory **"FO-10 index gears"**
  (`fo10-index-20-88`, one each of 20-88, placeholder: copy it and edit to the real gears).
* The differential train, formula and printout are unchanged; all BASIC comparison tests still
  pass (the comparison feeds Z = 40, which the differential does not use).
* New tests: engine (z=40, 1 start -> .6; z=48, 2 starts -> 1; ranked 4- and 2-gear searches) and
  browser (index ratio + gear matches on the FO-10 page).
* This index formula is not in the original BASIC program, so there is no BASIC result to compare to.

## 0a. v1.3 (2026-10-13): four original programs removed at Gary's request

Gary asked to get rid of **(1) Barber-Colman index, (2) Barber-Colman feed, (5) TOS OFA-71A
differential and (6) FD-320 Overton differential**. They are gone from the menu, the table of
contents, the built-in machine definitions and the routine screens. Kept: (3) FD-500 Overton,
(4) Fauter, (7) TOS FO-10 (still runs the Fauter math, constant 11.9367), (9) hob RPM & cutting
time, plus custom machines and the machine editor. The "Barber-Colman breakdown" gear-search
strategy is still available for custom machines (and for copies Gary made of the BC index).

* Saved browser data: settings ("built-in overrides") for the removed ids are dropped when the
  app loads; custom machines, including copies of the removed programs, are untouched. Opening an
  old link such as `#/m/bc-index` shows a short "removed" message.
* Importing an old JSON backup still works: overrides for the removed ids are silently ignored.
* The original program description below (sections 2-3) is kept for reference; it still
  describes all 8 routines of `source.bas`.
* Tests: the removed modules are no longer compared. `test/fixtures/machines_v1.2.mjs` is a
  frozen copy of the v1.2 definitions used only so the BASIC-comparison case generator keeps the
  same random sequence (cached PC-BASIC transcripts stay valid).

## 1. How to run

* **Normal way:** in `app/`, double-click `start-app.bat` (Windows) or run `./start-app.sh`
  (or `python3 -m http.server 8000`), then open <http://localhost:8000/>.
  The browser has to load the page from a web server because the app uses JavaScript modules.
* **No-server way:** open `app/ramgear-standalone.html` directly (double-click). It is the same app
  with everything embedded in one file. Re-create it after code changes with
  `node tools/make-standalone.mjs`.
* Machines, inventories and settings are saved in the browser (localStorage). Use
  **Import / export** to back them up or move them to another PC.
* Tests (Node 18+): `cd app && node test/run_all.mjs`. They use cached interpreter results, so no BASIC
  interpreter is needed. `node test/basic_compare.mjs --live` re-runs the original program in PC-BASIC.

## 2. The original program

Main menu (line 35): `1` BC index, `2` BC feed, `3` FD-500, `4` Fauter, `5` TOS OFA-71A,
`6` FD-320, `7` FO-10, `9` hob RPM & cutting time, `E` exit. There is no option 8. Anything
else asks again. All variables are untyped, which in BASIC means **single precision**
(about 7 significant digits). There are no `DEF`, `DIM`, `DATA`, `PRINT USING`, `INT`, `FIX` or `%`/`#`
variables. The only typed items are the double-precision constants (`#` suffix), and they are stored
into single-precision variables straight away.

### (1) Barber-Colman index (lines 1000-1950)
Prompts, in order: sales order number, part description, "DO THE HOB AND THE HELIX ANGLE HAVE
THE SAME HAND" (Y), else "DOES THE HOB AND HELIX HAVE OPPOSITE ANGLES" (Y), constant `C`,
number of teeth `N`.
* `L = 15 × C`
* `M = N × C − 1` (same hand) or `N × C + 1` (opposite hand)
* prints `L / M` and `F = L / M`.
* "Break the numbers down": for W = 20…120 it prints `X = L / W` and `X * W`, one line at a time,
  until you answer Y. Then the same for `J = M / H`, H = 20…120. It then prints `X * W / J * H` and F.
  The program does not check whether X or J are whole numbers. You pick by eye. (The app shades the
  whole-number rows green.)
* No change-gear search in this module.

### (2) Barber-Colman feed (2000-2390)
Prompts: sales order, part description, constant `CC`, circular pitch `CP`, helix angle `B` (degrees).
* `B = B × (3.14159265 / 180)` (radians, overwrites B)
* `R = CP / (sin B × CC × .0375)`
* prints `R= … C= … ANGLE= … CIR PITCH= …` with comma (14-column) spacing. Then `C` runs the
  change-gear search for R.

### (3) FD-500 Overton, (4) Fauter, (5) TOS OFA-71A, (6) FD-320 Overton, (7) TOS FO-10: differential
Prompts: sales order, part description, helix angle `B` (degrees), cutter NDP or normal module `D`,
number of leads (hob starts) `K`, `I`/`M` for inch or metric. Constants: `P = 3.14159264`,
`M = 25.4000508`, machine constant `O`. `C = B × P / 180`.

| Machine | O | Inch (NDP) | Metric (module) |
|---|---|---|---|
| FD-500, FD-320 | 6 | `R = (O / M) × sin C × D / K` | `R = O × sin C / D / K` |
| Fauter, FO-10 | 11.9367 | same | same |
| TOS OFA-71A | 24 | `R = (O × D × sin C) / (M × P × K)` | `R = (O × sin C) / (P × D × K)` |

So, roughly: inch R = O × sin(helix) × NDP / (25.4 × starts), and metric R = O × sin(helix) / (module × starts).
TOS also divides by π. (11.9367 ≈ 37.5/π.) `C` then runs the change-gear search for R.

### (9) Hob RPM & cutting time (9000-9780)
Prompts: hob diameter `DA`, helix angle, surface feet `SF`, teeth `NT`, hob starts `SN`, feed per
part revolution `FEED`, "length of cut" `LC` (really face width), number of cuts `NC`, number of
parts `NP`, setup minutes. `PIE = 3.141592654`.
* hob RPM = SF / (DA × π / 12)
* part RPM = RPM / NT × SN; inches per minute = part RPM × FEED
* length of cut along helix AL = LC / cos(helix)
* minutes per cut = AL / IPM; minutes per part TPP = that × NC
* minutes per part with setup TRT = SETUP / NP + TPP; job hours TJT = TRT × NP / 60
* "MIN. PER CUT" printed is TPP / NC.

### Change-gear search (10010-10384), shared by modules 2-7
Train ratio `RN = (A / B) × (C / D)`, with drivers A and C and driven gears B and D. Start
A=B=C=D=20. A counts fastest, then B, C, D. A gear set is accepted when
`.9999 ≤ RN / R ≤ 1.0001` (±0.01 %, single precision). The program shows the **first** set
found, not the best one. (C) CONTINUE goes on from the next combination. The exact order
(because of the `IF A=89 / IF B=89 / IF C=89` tests):

```
for D = 20, 21, 22, ...            (no upper limit!)
  for C = 20..88
    for B = 20..88: for A = 20..88: test
    test A=20, B=89                 (one extra combination with a 89-tooth B)
  test A=20, B=20, C=89             (one extra combination with a 89-tooth C)
```

## 3. BASIC behaviour reproduced in the app

* **Single precision arithmetic, rounded the GW-BASIC way.** `app/js/mbf.js` ports PC-BASIC's
  emulation of Microsoft Binary Format (MBF) numbers line by line: single/double precision,
  the guard byte and rounding quirks of add/subtract/multiply/divide, how decimal input is turned
  into binary ("4.32" is not the nearest single!), how SIN/COS/SQR results are truncated, and the
  PRINT number format: leading space, no leading zero (`.94488`), 7 significant digits,
  `E+07` notation, and a trailing space.
* Number literal typing: integers ≤ 32767 are integers, `#` or 8+ digits make a double,
  otherwise single. Mixed operations are done in the wider type and then stored into a single
  variable (e.g. `B * (3.14159265# / 180)` is done in double, then rounded to single).
* Every intermediate variable is rounded to single when it is stored, exactly where the original assigns it.
* INPUT parsing (e.g. `12.3456789` becomes a double first, then is rounded into a single).
* PRINT layout: `;` adds no gap, `,` moves to the next 14-column zone, and a word that would run past column 80
  starts a new line.
* Division by zero: GW-BASIC prints "Division by zero" and carries on with its largest number
  (1.701412E+38). The app does the same and shows a warning.
* The change-gear search uses the same order, the same single-precision ratio and the same comparisons,
  including the two extra 89-tooth combinations. To keep it fast, the app first skips combinations whose
  plain ratio is more than 0.03 % off (three times the window, so it never skips a real match). It also
  skips D values or C values that cannot possibly reach the ratio. Then it does the exact BASIC test.

## 4. Bugs and oddities in the original (kept in the calculations, flagged here)

1. The file contains non-BASIC lines at the top: a GUID comment and `IMPLEMENT_OLECREATE(...)`,
   which looks like a Visual Studio "Create GUID" paste. No BASIC would load the file as it is. I removed
   them only in the test copy (`app/test/basic/ramgear_clean.bas`).
2. Line `10001` has a number and nothing else. QBasic/QuickBASIC accept this as a label. GW-BASIC stops
   loading the file there with "Undefined line number", so the whole gear search would be missing. My guess
   is that the shop ran the program in **QBasic/QuickBASIC**, not GW-BASIC (see §7). The test copy drops that line.
3. **FO-10 = Fauter.** Option 7 jumps into the Fauter code (`GOTO 4200` / `GOTO 4220`), so it uses
   the Fauter constant 11.9367. After the calculation it also uses the Fauter menu, so a printout says
   "(4) FAUTER DIFFERENTIAL". Its screen title says "TOS FO-01", but the menu and the printout say FO-10.
4. **FD-320 = FD-500.** Same code, same constant 6.
5. Inch/metric: only a capital `M` means metric. `m`, `I` or anything else silently gives inch.
6. Feed: the "ANGLE=" on screen and "HELIX ANGLE:" on the printout show the angle in **radians**
   (the variable was overwritten). `R1 = R + .0001` and `R2 = R − .0001` are worked out but never used.
7. Gear search: if the ratio is 0 (helix 0°), negative (left-hand angle typed as negative), or above
   ≈19.8 (out of reach of 20-88 tooth gears), the original **loops forever**. A zero ratio also prints
   "Division by zero" over and over. For very small ratios D runs past 88, so it can suggest a gear that
   doesn't exist. It also allows 89-tooth gears in the two odd combinations above. It takes the first set
   inside ±0.01 %, not the best one. Nothing stops the same tooth count being used more than once,
   and there is no check on mesh or centre distance. The app stops at D = 5000 and explains impossible
   ratios instead of hanging.
8. Hob time: the prompt says feed "IN THOUSANDS", but the number is used in inches. Enter `.080`, not `80`.
   The "LENGTH OF CUT" you type is printed back as "FACE WIDTH OF GEAR", and the computed
   helix length is printed as "LENGTH OF CUT". No approach or over-travel is included. Parts = 0 or
   cuts = 0 → Division by zero. The prompt and output texts are misspelled (HOBB, REVALUTION, DISCRIPTION).
9. The index "break down" has some odd answers. Answering `N` sends you back to the **main menu**, and any
   other answer skips the L table so X and W print as 0. If you answer N to all 101 lines, it prints W = 121
   with X = L/120 as if you had chosen it.
10. Menus: lowercase answers are not recognised. In modules 1, 2, 4, 5, 7 an unrecognised answer at the
    P/M/C/R prompt falls through into **printing**. In modules 3 and 6 it asks "WOULD YOU LIKE TO GO BACK
    TO TH TABLE OF CONTENTS", and anything but M ends the program.
11. The sales order number is a numeric variable. Letters give "?Redo from start", and 8+ digits print
    as E-notation (12345678 → 1.234568E+07). The app treats it as text.
12. Constants as typed: π as 3.14159264 (last digit wrong, no effect in single precision) and
    25.4000508 mm per inch (the old US survey inch, 2 ppm off). Both are kept as-is.

Intentional differences in the app (calculations are unchanged): the job fields are text; blank inputs are
refused instead of counting as 0; Y/N and I/M questions are drop-downs; the menu-flow quirks in items 9-10 are
not copied (the results of every path are available); the gear search can't hang.

## 5. The web app

* One screen per original module, with the same inputs in the same order. Each field shows the original prompt text.
  Results are shown in shop language and also as the **original program screen** (identical text).
* Gear trains: **Find change gears** gives the original first answer, and **Continue** gives the next one, like (C).
  Each answer shows the error % and the loop position. Built-ins can be switched to **best matches from an
  inventory**, which ranks every combination from your gear list by error and respects quantities.
  The legacy search can optionally be limited to an inventory, but that changes which gears it finds.
* The Barber-Colman index has two clickable breakdown tables (whole numbers shaded) and the `X * W / J * H` line.
* **Print sheet** prints a RAM-GEAR style page (job details, inputs, results, chosen gears).
* Setting on the start page: arithmetic for the original programs, GW-BASIC (default, verified) or QBasic-style.

### Files
| File | What |
|---|---|
| `app/index.html`, `app/styles.css`, `app/js/app.js` | UI |
| `app/js/calc.js` | Public calculation API (no DOM, importable from Node) |
| `app/js/mbf.js` | GW-BASIC number engine (MBF single/double) |
| `app/js/numeric.js` | Numeric back-ends: `gwbasic`, `ieee-single`, `float64` |
| `app/js/formula.js` | Formula parser/evaluator (no `eval`), validation, machine compiler, PRINT formatter |
| `app/js/search.js` | Gear searches: `legacy-ramgear`, `ranked`, `bc-breakdown` |
| `app/js/presets.js` | Index gear presets (v1.6): prime check, preset ratio/error, prime hint, CSV `z,A,B,C,D,note` |
| `app/js/store.js` | The single storage module (v1.6): async `load()`/`save()` for machines, inventories, overrides, presets, last inputs, plus manual get/put/delete/export/import. app.js never touches localStorage/IndexedDB directly, so a Supabase backend (logins, admin role) can replace this file later. No login code yet. |
| `app/js/manuals.js` | Manual PDFs in IndexedDB (v1.6), base64 for JSON export/import |
| `app/js/machines.js` | The 8 built-in machine definitions + built-in inventory |
| `app/ramgear-standalone.html` | Single-file copy (generated by `tools/make-standalone.mjs`) |
| `app/test/*` | Tests, PC-BASIC harness, cached transcripts/fixtures |

## 6. User-defined machines

**Add a machine** (or **Copy to edit** on a built-in) opens the editor. There you set inputs (name,
label, unit, example value, type number/choice/text), constants, formulas, the results to show, optional
printout lines, and the gear trains to search. Every change is checked right away (syntax, unknown names,
text fields used in maths, duplicate or reserved names, circular references). A live preview runs the
example values, including the first gear result. Save stays disabled until there are no errors.
Built-ins are read-only. **View formulas** shows them in the same editor.

### Machine definition schema (JSON)
```jsonc
{
  "id": "custom-ab12cd3",            // unique
  "name": "Pfauter P400",
  "description": "",
  "numeric": "float64",               // "float64" (normal) | "gwbasic" (exactly like the old program) | "ieee-single"
  "inputs": [
    { "name": "HELIX", "label": "Helix angle", "unit": "degrees", "type": "number", "example": "20" },
    { "name": "Q", "label": "Pitch system", "type": "choice", "default": 0,
      "options": [ { "value": 0, "label": "Inch (NDP)" }, { "value": 1, "label": "Metric (module)" } ] },
    { "name": "SO", "label": "Sales order", "type": "text" }          // not usable in formulas
  ],
  "constants": [ { "name": "K", "expr": "7.95775", "label": "machine constant" } ],
  "formulas":  [ { "name": "RDIFF", "expr": "K * SIND(HELIX) / (MN * STARTS)", "label": "Differential ratio" } ],
  "outputs":   [ { "name": "RDIFF", "label": "Differential ratio needed", "format": "fixed:6" } ],  // "basic" | "fixed:N"
  "report":    [ "\"RATIO: \"; RDIFF" ],                              // optional BASIC PRINT-style lines
  "trains": [
    { "kind": "differential",          // "index" | "differential" | "feed" | "other"
      "label": "Differential change gears",
      "ratio": "RDIFF",                 // name of the ratio to match
      "strategy": "ranked",             // "ranked" | "legacy-ramgear" | "bc-breakdown"
      "inventory": "legacy-20-88",      // inventory id
      "gears": 4, "maxResults": 20, "tolerance": 0.0001,   // ranked only (tolerance = relative, optional)
      "useInventory": false             // legacy only: skip gears not in the inventory
    }
    // bc-breakdown: { "strategy": "bc-breakdown", "values": ["L","M"], "from": 20, "to": 120 }
  ]
}
```
Names are case-insensitive. A trailing `#` makes a name double precision and `%` makes it a 16-bit integer.
Otherwise names are single precision in `gwbasic` mode, just like untyped BASIC variables.

### Formula language
`+ - * /`, `^` (power, left-associative like BASIC: `2^3^2 = 64`, `-2^2 = -4`), brackets,
unary minus. Comparisons `= <> < > <= >=` give −1/0 like BASIC, and `AND OR NOT` are also available.
Functions: `SIN COS TAN ATN` (radians, as in BASIC), `SIND COSD TAND ASIND ACOSD ATND` (degrees), `ASIN ACOS`,
`SQR`/`SQRT`, `ABS SGN EXP LOG`, `INT` (rounds down: INT(−2.5) = −3), `FIX` (truncates: FIX(−2.5) = −2), `CINT`
(rounds half away from zero, error beyond ±32767), `ROUND` (same without the limit), `CSNG CDBL`, `MIN(..) MAX(..)`,
`IF(cond, a, b)` (only the chosen branch is evaluated), and `PI`. Literals may carry `#`/`!` like BASIC.
Formulas can refer to each other in any order. They are evaluated in dependency order.
It is a hand-written recursive-descent parser. Nothing is ever passed to `eval` or `Function`.

**Additions needed for exactness:** the original's loops and branches could not be written as plain
formulas, so the format has three additions. `IF()` covers the hand and inch/metric branches. Named search
strategies cover the loops: `legacy-ramgear` is the original search, and `bc-breakdown` is the index
breakdown tables. `report` lines reproduce the original screen text.

### Inventories and import/export
Inventory: `{ "id", "name", "gears": [ { "teeth": 20, "qty": 2 }, ... ] }`. The editor accepts shorthand like
`20-60 x2, 64, 72, 100`. The built-in "every tooth count 20-88" inventory matches what the original assumes.
Export file:
```json
{ "format": "ramgear-change-gear", "version": 1, "exportedAt": "...",
  "machines": [ ...custom machines... ],
  "builtinOverrides": { "fd500-diff": { "trains": { "0": { "strategy": "ranked", "inventory": "inv-x" } } } },
  "inventories": [ ...custom inventories... ] }
```
Every machine is validated on import (same checks as the editor). Bad entries are listed and not imported.

v1.6 additions (the file stays `version: 1`, so older backups still import, and the new keys are optional):
* `indexPresets: [ { "z": 101, "A": 24, "B": 101, "note": "..." }, { "z": 40, "A": 30, "B": 50, "C": 40, "D": 40 } ]`
  on custom machines, and as `builtinOverrides["tos-fo10-diff"].indexPresets` for the FO-10. Bad presets are skipped
  on import, and the skipped ones are listed.
* `manuals: { "<machine id>": { "name", "type", "size", "data": "<base64 PDF>" } }`, only when *Include manuals* is
  ticked. Manuals live in IndexedDB (`ramgear-change-gear` / `manuals`, key = machine id), never in localStorage
  or the repo.
* Preset display: when z matches, the preset rows (ratio = A/B×C/D in double precision, error vs the needed ratio)
  are shown above the ranked matches and used for the print sheet. Presets never change the calculated ratios,
  so the BASIC comparison is unaffected.

## 7. Verification

Interpreter: **PC-BASIC 2.0.8** (pip, in `.venv`). It is a GW-BASIC-compatible interpreter that emulates
GW-BASIC's MBF arithmetic bit for bit. The original program ran unchanged except for removing the non-BASIC
lines and the bare `10001` line. It was fed scripted keystrokes, and every result line it printed was compared
with the JS output, character for character.

| Check | Cases | Compared | Mismatches |
|---|---|---|---|
| (1) BC index, incl. breakdown tables & quirk paths (N, other answer, running off the end) | 36 | 974 printed lines | 0 |
| (2) BC feed, incl. helix 0 (Division by zero) | 43 | 71 lines, 9 gear sets | 0 |
| (3) FD-500 | 43 | 88 lines, 15 gear sets | 0 |
| (4) Fauter | 43 | 82 lines, 13 gear sets | 0 |
| (5) TOS OFA-71A | 43 | 73 lines, 10 gear sets | 0 |
| (6) FD-320 | 43 | 82 lines, 13 gear sets | 0 |
| (7) FO-10 | 43 | 85 lines, 14 gear sets | 0 |
| (9) Hob RPM/time, incl. parts = 0 and huge values (line wrap) | 38 | 571 lines | 0 |
| Gear search vs. a literal transliteration of lines 10010-10384 on PC-BASIC's number code | 150 ratios | 450 gear sets (A,B,C,D, loop position, ratio bits) | 0 |
| Number engine vs. PC-BASIC number classes (parse, INPUT, + − × ÷ ^, SIN COS TAN ATN SQR EXP LOG INT FIX CINT ABS, PRINT format) | 6000 random pairs | 146,934 results, bit-exact | 0 |

Cases cover inch and metric, and the inputs `m`/`X` that the original silently treats as inch. They include
1-3 starts, angles with 0-4 decimals, and 8-digit inputs. The gear runs include several CONTINUE steps. PC-BASIC
needs about 3 ms per gear-loop pass, so end-to-end gear cases were chosen where the original finds its answers
within 100,000 passes. Deep searches (up to D = 40) are covered by the transliteration check. The built-in
machines are evaluated through the same formula engine the app uses for custom machines.

Re-run: `node test/run_all.mjs` (cached), `node test/basic_compare.mjs --live` (PC-BASIC, about 40 min with gear
cases; `--nogear` takes about 20 s), `node test/legacy_search.test.mjs --regen`, and the browser tests `python3 test/ui_smoke.py`,
`test/ui_new_machine.py`, `test/ui_presets_manual.py` (v1.6: presets, prime hint, CSV, manual attach/reload/open,
export/import with manuals, delete asks about the manual) and `test/ui_standalone_calc.py` (all no JS errors).

## 8. Open questions for Gary

1. **Which BASIC ran this, GW-BASIC or QBasic/QuickBASIC?** The bare line `10001` points to QBasic.
   The app matches GW-BASIC exactly (that is what could be verified). QBasic rounds slightly differently: with
   the QBasic-style setting the **7th digit** of a printed result differs in roughly 20-80 % of cases, depending on
   the module. The first change-gear answer differed in only 3 of ~980 test ratios.
   Quick test on an old printout or the old PC: BC index, constant **4.32**, **20** teeth, same hand.
   GW-BASIC prints `64.80001 / 85.4`, QBasic should print `64.8 / 85.4`. (The QBasic-style mode has not been
   checked against a real QBasic.)
2. Is **FO-10** really meant to use the Fauter constant 11.9367 (the original jumps into the Fauter code)? Is
   **FD-320** really the same as FD-500 (constant 6)?
3. Which machine constants are normally typed for the Barber-Colman index (`C`) and feed (`CC`)? No example
   values exist in the source. The app's examples (4 and 1) are placeholders.
4. Is the feed for hob time entered in inches (.080) in practice? The prompt says "thousands".
5. What change gears does each machine actually have? Entering them as inventories lets the app rank
   real, available gear sets.

## v1.8 (2026-10-14) Verify & lock, admin delete
* Lock stored as cg_machines.formulas.{locked, lockedAt, lockedBy} (cgmap.js); def stays clean. fromRemote -> machine.lock.
* store.js sync: a row already locked keeps its definition; only train.inventory links can change (client-side guard).
* RLS does NOT enforce the lock; proposed trigger (not applied) in app/LOCKING.md.
* app.js: Draft/Locked badges, Verify & lock confirm summary, deleteMachine (canDelete, drafts + locked, never built-ins),
  gearTrainAdmin box (remove train on drafts; clear/delete gear lists, locked too), Delete/Clear on gear inventories page.
* Known: strategy changes on a locked machine's results page are kept in this browser only (definition frozen).
* Tests: store_cloud.test.mjs lock section; test/ui_lock_delete.py (28 checks).
* v1.8 dev fix: global error handler ignores benign "ResizeObserver loop ..." window errors (Chrome/Edge notice, no real error); real errors still show the banner.

## v1.8.1 (2026-10-14)
* Non-admins see a greyed "🔒 Sign in as admin to add machines" menu line instead of nothing; #/admin-hint explains the user/role and offers Sign out / switch account. The sign-in card notes that adding machines needs admin.
* Global error banner ignores benign "ResizeObserver loop" errors (3818864).
* Sign-in screen restyled to match the QC Form login (Ram-Gear/ramgear-app index.html #login + app.css "login screen"): background photo with charcoal overlay, white card with #4396AC top border, logo, company name, address, app line, Username then Password or PIN, full-width #2E7386 Sign in button, footer + version. img/login-bg.jpg and img/ramgear-logo.jpg copied from the QC repo. Logic and element ids unchanged.

## v1.8.2 (2026-10-15)
* "? Help" link (index.html header, fixed top-right, visible on the sign-in screen too): plain link to https://grok.com/?q=<fixed question>, target=_blank rel=noopener. No user data in the URL.
* Page background (outside cards/inputs/outputs, not the sign-in photo) is #EAF7EA, the shared Ram-Gear colour. Contrast on it: body text 14.3:1, muted 5.1:1, links 7.4-8.5:1 (all WCAG AA).

## v1.8.3 (2026-10-15)
* App Hub tile icon (Ram-Gear/app-hub icons/change-gear.svg, copied read-only to app/img/ with change-gear-192.png) shown 32px left of the header title and used as favicon (SVG) + apple-touch-icon (192 PNG). Standalone embeds the SVG as a data URI.
* app/help.html: public help page (what it does, screens, step-by-step tasks, troubleshooting, formula guide from changegear-formula-guide.md checked against formula.js), "Try it" practice boxes (js/help-practice.js: formula vs reference on sample inputs, ratio ±0.01 %, gears 20-88 max 4 each ±0.01 % with rankedSearch answer), an "Ask Grok about this" link per section/step. Linked from the menu ("📖 Help & how-to") and the sign-in card; the standalone links to the published help page. Help button question now ends "Please read https://ram-gear.github.io/change-gear/help.html first, then give me pointers." Test: test/ui_help.py.
* Formula guide corrections: full function list (ATN, ASIND/ACOSD/ATND, SGN, FIX, CINT, EXP, LOG, ASIN, ACOS were missing); ROUND takes one value (whole number); -2 ^ 2 = -4 like BASIC; Q = 1 metric / Q = 0 inch spelled out; character position only for typing errors; names used by + Add a machine (KIDX, KDIFF, MM); feed 0.25 marked as placeholder; worked numbers added and verified.
