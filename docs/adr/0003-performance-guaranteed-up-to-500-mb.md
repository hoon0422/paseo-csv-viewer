---
status: accepted
---

# Performance is guaranteed up to 500 MB; larger sources open after a warning

SPEC #1 promised full-file sorting and filtering for sources up to 5 GB. Meeting the v2 targets at 5 GB (sorted first screen within 15 s, each scrolled page within 0.2 s) needed a per-row index and a packed copy of every cell at preparation, which added about 50% to preparation time and 3.2 GB of temporary disk on a 5.37 GB source. Most sources users open are far smaller, so we guarantee performance only up to 500 MB (500,000,000 bytes): first sorted screen within 2 s and each scrolled page within 0.2 s, judged on real hardware rather than the emulated Cua VM. A larger source still opens fully, but only after the user confirms a warning that it may take long; no timing is promised for it, and the index and packed copy were removed.

## Consequences

On multi-gigabyte sources, each scrolled page under a sort or filter can take about 0.5 s, and preparation stays around a minute per 5 GB.
