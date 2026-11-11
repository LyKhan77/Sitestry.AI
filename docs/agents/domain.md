# Domain Documentation Layout

This repository uses a **single-context** domain documentation layout:

- **Canonical Glossary**: [`GLOSSARY.md`](../../GLOSSARY.md) at the repository root.
- **Architecture Decision Records (ADRs)**: Stored under `docs/adr/NNNN-<slug>.md`.

## Consumer Rules for Agents

1. Read `GLOSSARY.md` before introducing new schema fields, UI labels, or module interfaces.
2. Challenge any ambiguous terminology against `GLOSSARY.md` during planning or `grill-me` sessions.
3. Update `GLOSSARY.md` inline whenever a new canonical domain concept is agreed upon.
