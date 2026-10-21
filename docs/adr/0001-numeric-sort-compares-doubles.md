---
status: accepted
---

# Numeric sort compares cells as doubles

Numeric sort used to compare cells exactly, splitting each number into sign, digit position and significant digits with per-row regular expressions, so values such as `12345678901234567890` and `12345678901234567891` kept their order. Measured on 5 million rows, that comparison was about 6× slower than casting to DOUBLE, and the viewer must sort a 5 GB file within 15 seconds. We now compare as DOUBLE and accept that values agreeing in their first ~15 significant digits may tie and fall back to file order. Which cells count as numbers is unchanged (plain decimals with an optional exponent; `inf`, `NaN`, `1,234` and `$5` are text).

## Consequences

This reverses the exact numeric sorting criterion of SPEC #1. Long identifiers stored as digits (card numbers, 64-bit IDs) can sort out of order in Numeric mode; Text mode orders them correctly when they have the same length.
