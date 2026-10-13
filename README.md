# RAM-GEAR Change Gear

Browser version of Ram-Gear's BASIC gear hobbing menu (FD-500 Overton, Fauter and FO-10 TOS differentials, hob RPM & cutting time), with per-machine gear inventories, ranked gear-combination matches, and custom machine definitions.

Version v1.6 (2026-10-13):

### Index gear presets
Every machine with an index train (FO-10 and machines made with *Add a machine*) has an **Index gear presets** table under the results: tooth count z, gears A, B, C, D (leave C and D empty for a 2-gear A/B set) and a note.
- When the part's z has a preset, the index results show it first, marked **Preset**, with its ratio and error, then the searched matches.
- Each searched match has a **Save as preset** button; **Save selected match as preset for z = …** saves the highlighted search match in one click. Rows can also be added, edited and deleted by hand, with gears that are not in the gear list (e.g. 24/101 for z = 101).
- When z is prime, has no preset, and the gear list has no gear that z divides, the app says: *z = 101 is prime – you need a 101-tooth gear (or a multiple); add a preset.*
- Presets for the FO-10 are kept as a built-in override. Presets go into the JSON backup, and the table has its own **Import CSV / Export CSV** with columns `z,A,B,C,D,note`.

### Machine manuals (PDF)
Each machine screen has **Attach manual (PDF)**, **Open manual** (opens in a new tab) and **Remove**. The PDF is stored in this browser's IndexedDB only. It is never uploaded and never in this repository. If the browser blocks IndexedDB (private window, blocked site data) the app says so and calculations keep working. **Export to file** has an optional *Include manuals (larger file)* box that embeds the PDFs in the JSON, and Import restores them. Deleting a machine asks whether to delete its manual too.

v1.5 (2026-10-13): **Add a machine** has an *Index ratio* section (Index constant, default 24: index = constant × hob starts ÷ z) and a *Differential ratio* section (Differential constant, Fauter/FD-500 style formula), each with its own gear list and search; either can be removed. Free-form formula editing is under *Advanced*. Each machine gets its own `<name> index gears` and `<name> differential gears` lists, with *Edit index gears* / *Edit differential gears* buttons on the machine screen.

### Gear lists and CSV
Each gear list is a table: tooth count, quantity, optional note. Quick add accepts `20, 24, 30, 36`, `40-48` or `30 x2`.
**Import CSV / Export CSV** use the columns `teeth,qty,note`:

```
teeth,qty,note
20,1,
24,2,one is chipped
30,1,
```

- qty defaults to 1, note is optional, the header row is optional (columns may be in any order when it is there)
- a single column of tooth counts works too
- comma or semicolon separators (Excel exports), quotes allowed
- before anything changes you get a preview with bad rows flagged and a choice: *Replace my list* or *Add to my list* (then Save)
- *Download sample CSV* next to the buttons gives a file to start from

Version v1.4 (2026-10-13): the TOS FO-10 also works out index change gears (Index ratio = 24 × hob starts ÷ z, new "Number of teeth in gear (z)" box), searched from the "FO-10 index gears" inventory.

v1.3 (2026-10-13): the Barber Colman index and feed, OFA-71A TOS and FD-320 Overton routines were removed at Gary's request. Custom machines (including any copies of them) are unaffected, and old JSON backups still import.

**Live:** https://ram-gear.github.io/change-gear/

**Offline:** download `ramgear-standalone.html` and open it in any browser — no install needed. Use Export to back up gear lists and machines (JSON/CSV).

See `notes.md` for details and verification against the original `source.bas`.
