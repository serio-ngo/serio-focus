---
name: plan-session
description: "Use when writing or updating a repo plan or spec — the row contract both must follow."
license: Apache-2.0
compatibility: No external dependencies. Repo plans and repo specs only — not org ops, not tracker work.
---

## 1. A repo-local contract always wins — check first

| Target | Use |
|---|---|
| Org ops — tasks, filings, deadlines, anything in the tracker | that tracker's own flow, never this skill |
| Any repo with its own `AGENTS.md`/`CLAUDE.md` planning section | that file — a repo-local contract always wins |
| Repo plan or repo spec with no local contract | this skill |

- Never import another repo's format into this plan.

## 2. Pick the shape before the first line

| Document answers | Shape | Row |
|---|---|---|
| "what do we do, in what order" | **plan** | §3 |
| "what is true, what is binding" | **spec** — PRD, ADR, content model, architecture | §4 |

- A file may hold both, never blurred: spec sections state law, plan sections state work.

## 3. The plan task row

| Column | Rule |
|---|---|
| WHAT | one imperative line naming the actual edit. No "improve", no adjectives |
| WHERE | real path, this repo, line range if known. Never a placeholder |
| WHY | one clause on why it matters now. Not a restatement of WHAT |
| WHEN | a day, a week or a trigger. Never "soon" or "TBD" |
| DONE | the exact check that proves it — runnable or greppable. Never "looks good" |

- State net LOC intent per section (`+40/-10 net +30`); size veto before writing.

## 4. The spec row

| Column | Rule |
|---|---|
| ID | stable, `PREFIX-NN`. Other files cite the ID, never a section number |
| RULE | one declarative line. Present tense. No narrative, no first person |
| VALUE | the binding number, string, enum or path. Never a range unless the range is the rule |
| SOURCE | a repo path for internal law, a **URL + retrieval date** for anything external, or `UNVERIFIED` |
| CHECK | how a reader proves the product still obeys it — greppable, runnable, or a named manual test |

- A spec table stating an external fact with no SOURCE column is malformed: delete or source it.

## 5. Decide — do not defer

| Situation | What the document must contain |
|---|---|
| You have enough to decide | the decision, plus the condition that would reverse it |
| Genuinely the owner's call | decide with the default that ships, plus the condition that reverses it |
| Blocked on a fact you cannot get | the row above, plus what you tried |

- Banned: open questions with no defaults · `TBD`/`later` · first person · options surveys · thinking-process sections · closing summaries · hedge words · rhetorical questions · emoji.
