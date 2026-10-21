# Domain docs

## Layout

This project uses a single-context layout: `GLOSSARY.md` at the repository root and architectural decision records under `docs/adr/`.

## Before exploring code or writing a spec

- Read `GLOSSARY.md` when present.
- Read ADRs under `docs/adr/` that touch the task.
- If a domain document is missing, proceed silently. Create domain documents lazily when actual terms or architectural decisions are resolved.

## Vocabulary

Use glossary terms in issue titles, specs, hypotheses, and tests. If a needed concept is absent, first check whether an existing term already covers it; record a genuine gap for domain modeling.

## ADR conflicts

Surface conflicts with existing ADRs explicitly, name the affected ADR, and explain why reopening the decision may be warranted.
