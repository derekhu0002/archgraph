# Validation Extension Protocol (one page)

The framework core is **engine-agnostic**: it runs *external validators* at its
existing validation timings. Adding a new validation method = **adding an entry**
to the config; **no core code change** (open-closed). The point lives in
`argo/scripts/validation-extensions.js`; the ontology engine in this directory is
one such entry.

## Where it is configured
`ARGO_VALIDATION_EXTENSIONS` — a `.env` key (in `~/.argo/.env`), a JSON **array**:

```json
[
  { "name": "ontology",
    "timings": ["write", "init"],
    "command": ["node", "<argo>/scripts/ontology-projection/cli.js",
                "--workspace", "{workspaceRoot}", "--graph", "{graphPath}", "--mode", "{mode}"] }
]
```
- `name` — a label shown in the merged findings.
- `timings` — where to run: `"write"` (per write mutation) and/or `"init"`
  (workspace init / full validation). One entry may list both.
- `command` — argv array, run with `shell:false`. Empty/absent config ⇒ no-op
  (default behaviour unchanged).

## Tokens (argv)
| Token | Substituted with |
|---|---|
| `{workspaceRoot}` | the resolved workspace root |
| `{graphPath}` | workspace-relative graph path (`design/KG/SystemArchitecture.json`) |
| `{mode}` | `write` or `init` |

## Context passed via environment
| Env var | Meaning |
|---|---|
| `ARGO_VALIDATION_GRAPH_FILE` | path to the **post-mutation** document (write mode); empty in `init` mode — read the file, not the on-disk graph |
| `ARGO_VALIDATION_TOUCHED_ELEMENTS` | JSON array of element ids touched by this write |
| `ARGO_VALIDATION_TOUCHED_RELATIONSHIPS` | JSON array of relationship ids touched by this write |
| *(inherited)* | the validator also inherits the process env (incl. the rest of `~/.argo/.env`) |

The validator MUST be **read-only** w.r.t. canonical: findings are a derived
read-model; never write the graph back.

## Output protocol
Print **one JSON object** to stdout (the **last** parseable JSON line wins):

```json
{ "errors": ["<blocking finding>", "..."], "warnings": ["<advisory>", "..."] }
```
- `errors` → merged into the framework's validation errors (**blocking** at that timing).
- `warnings` → surfaced but never block.
- **Fail-open**: if the command is missing / exits non-zero / prints nothing, the
  framework records a *warning* and continues — it never falsely blocks a write.

## Timings
- **`write`**: runs on every preview/apply mutation, on the **post-mutation
  document**. Scope yourself to the delta using the touched ids (bounded cost).
- **`init`**: runs on workspace init / `validateSystemArchitecture`, on the whole graph (offline policy).

## Adding a new validator (open-closed)
1. Write a command that: reads the post-mutation doc (env), optionally the
   touched ids, computes findings, prints `{errors,warnings}`.
2. Add **one object** to `ARGO_VALIDATION_EXTENSIONS`.
3. Restart the host so the argo MCP reloads `~/.argo/.env`.

**Boundary (this needs a core change, not config):** a *new timing*, *new context
data*, or a *different output shape* widens the contract — that is a deliberate,
reviewed change to `validation-extensions.js` (and its call sites), not an entry.

## Minimal example (Node)
```js
// my-validator.js — argv: --workspace <ws> --graph <g> --mode <write|init>
const fs = require('node:fs');
const doc = JSON.parse(fs.readFileSync(process.env.ARGO_VALIDATION_GRAPH_FILE || '', 'utf8'));
const errors = (doc.elements || []).filter(e => !e.name).map(e => `element ${e.id} has no name`);
process.stdout.write(JSON.stringify({ errors, warnings: [] }));
```
Entry: `{"name":"names","timings":["write","init"],"command":["node","/path/my-validator.js","--mode","{mode}"]}`

## Verify
```
Get-Content "$env:USERPROFILE\.argo\.env" | Select-String ARGO_VALIDATION_EXTENSIONS
```
Then restart the host; the merged findings appear in write results (`errors` /
`validationWarnings`) and in `validateSystemArchitecture` output.
