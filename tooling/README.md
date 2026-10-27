# tooling

<sub><b>Not the plugin.</b> Nothing in this tree ships or loads in a host session. The plugin is <a href="../plugins/serio-focus">plugins/serio-focus</a>.</sub>

| Folder | Contents | Entry point |
|---|---|---|
| `cli/` | Maintainer CLI and the generators behind every generated block | `npm run setup` · `upkeep` · `doctor` · `release` · `prove` |
| `corpus/` | `guard-corpus.jsonl` labelled cases | hand-edited; one line per case; `npm run eval` |
| `test/` | `guard.test.mjs`, the only suite | `npm test` |

| Rule | Value |
|---|---|
| Imports | `tooling/` may import from `plugins/serio-focus/`; never the reverse |
| Dependencies | none; Node standard library only |
