# RAM-GEAR Change Gear

Browser version of Ram-Gear's BASIC gear hobbing menu (FD-500 Overton, Fauter and FO-10 TOS differentials, hob RPM & cutting time), with per-machine gear inventories, ranked gear-combination matches, and custom machine definitions.

Version v1.4 (2026-10-13): the TOS FO-10 also works out index change gears (Index ratio = 24 × hob starts ÷ z, new "Number of teeth in gear (z)" box), searched from the "FO-10 index gears" inventory.

v1.3 (2026-10-13): the Barber Colman index and feed, OFA-71A TOS and FD-320 Overton routines were removed at Gary's request. Custom machines (including any copies of them) are unaffected, and old JSON backups still import.

**Live:** https://ram-gear.github.io/change-gear/

**Offline:** download `ramgear-standalone.html` and open it in any browser — no install needed. Use Export to back up gear lists and machines (JSON/CSV).

See `notes.md` for details and verification against the original `source.bas`.
