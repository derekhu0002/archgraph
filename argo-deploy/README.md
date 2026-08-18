# archgraph-argo-deploy

Deploy the ArchGraph **ARGO toolchain**, **skills**, and **rules** with one command.

## Install

```sh
npm install -g archgraph-argo-deploy
```

## Usage

```sh
# Deploy to user-level global locations (default)
argo-deploy --global

# Deploy into a specific workspace (project)
argo-deploy --workspace /path/to/project

# Preview what would be copied without writing
argo-deploy --global --dry-run
```

## Deploy targets

| Mode | Toolchain | Skills | Rules |
| --- | --- | --- | --- |
| `--global` | `~/.argo/` | `~/.copilot/skills/<name>/` | `%APPDATA%\Code\User\prompts/` |
| `--workspace <dir>` | `<dir>/.argo/` | `<dir>/.github/skills/<name>/` | `<dir>/.github/` |

The bundled toolchain contains `argo/scripts`, `argo/schema`, the `wechat-public-cli`
skill, and `.env.example` (secrets and runtime state are never bundled).

## Development

```sh
# Regenerate the bundled assets from the repository sources
npm run sync-assets
```
