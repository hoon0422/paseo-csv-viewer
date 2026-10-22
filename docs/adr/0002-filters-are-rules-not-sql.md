---
status: accepted
---

# Filters are built from rules, not typed SQL

The viewer runs on DuckDB, so letting users type a SQL `WHERE` clause (as in database clients) would be cheap to build. We chose Sequel Ace-style filter rules (column, operator, value) that the server turns into parameterised SQL instead. DuckDB runs inside the daemon with the user's file and network access, so typed SQL could read other files (`read_csv`), write files (`COPY … TO`) or install extensions, breaking the promise that the viewer only reads its source. Locking DuckDB down enough to accept arbitrary SQL safely would need its own security review.

## Considered Options

- Typed `WHERE` clause with external access disabled and configuration locked: rejected until someone verifies that the lockdown actually holds.
