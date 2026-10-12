# tooling

<sub><b>Not the plugin.</b> Nothing in this tree ships or loads in a host session. The plugin is <a href="../plugins/serio-focus">plugins/serio-focus</a>.</sub>

| Folder | Contents | Entry point |
|---|---|---|
| `cli/` | Maintainer CLI and the generators behind every generated block | `npm run setup` · `upkeep` · `doctor` · `release` · `prove` |
| `corpus/` | `guard-corpus.jsonl` labelled cases | hand-edited; one line per case; `npm run eval` |
| `results/` | `scores.json`, read by the README badges | written by `npm run upkeep`; never hand-edit |
| `test/` | `guard.test.mjs`, the only suite | `npm test` |
| `settings/` | `policy.json`, the permission `deny` list a plugin cannot ship | `npm run sync` |

| Rule | Value |
|---|---|
| Imports | `tooling/` may import from `plugins/serio-focus/`; never the reverse |
| Dependencies | none; Node standard library only |
