# RAM-GEAR Change Gear

Browser version of Ram-Gear's BASIC gear hobbing menu (FD-500 Overton, Fauter and FO-10 TOS differentials, hob RPM & cutting time), with per-machine gear inventories, ranked gear-combination matches, and custom machine definitions.

Version v1.5 (2026-10-13): **Add a machine** has an *Index ratio* section (Index constant, default 24: index = constant × hob starts ÷ z) and a *Differential ratio* section (Differential constant, Fauter/FD-500 style formula), each with its own gear list and search; either can be removed. Free-form formula editing is under *Advanced*. Each machine gets its own `<name> index gears` and `<name> differential gears` lists, with *Edit index gears* / *Edit differential gears* buttons on the machine screen.

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
