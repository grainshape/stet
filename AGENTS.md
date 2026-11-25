# AGENTS.md

Conventions for agents working in this repository.

## What Stet is

Structured, in-place content editing for Svelte 5 on Yjs. Content is a graph of nodes with stable
IDs, rendered by the app's own Svelte components and edited directly in the page layout.

Decisions already made (don't revisit without asking):

- Own direction. Stet borrows ideas from svedit and ProseMirror but is not a fork of either.
- Yjs is the source of truth for the document from day one.
- Text offsets count UTF-16 code units, the same as the DOM and `Y.Text`. Convert only where a
  different unit is unavoidable, and never store code-point offsets.

Code copied from another project (svedit is MIT, ProseMirror is MIT) must be listed in `NOTICE`
with its origin and what was changed.

## Setup

- Use `pnpm`, never npm or yarn. The repo pins pnpm 12.23.0 through `packageManager` in the root `package.json`.
- Node `^22.17.0 || ^24.0.0 || >=26.0.0` (SvelteKit 3 needs at least 22.17).
- Packages allowed to run install scripts are listed under `allowBuilds` in `pnpm-workspace.yaml`.
- TypeScript is pinned to 6.0.x: SvelteKit 3 and `@sveltejs/package` need TypeScript 6, and
  typescript-eslint supports up to 6.0.

## Structure

pnpm workspaces with Turborepo.

```
packages/
  core/     → @grainshape/stet         framework-agnostic: model, schema, Yjs mapping, selection, commands
  svelte/   → @grainshape/stet-svelte  Svelte 5 rendering and DOM input layer
apps/
  demo/     → @grainshape/stet-demo    private SvelteKit 3 demo and manual test page (not published)
docs/       design notes and specs
```

`core` must not import Svelte or touch the DOM, so it stays testable in Node. `stet-svelte` depends
on `core` through `workspace:*` and imports its built `dist/`, so Turbo builds `core` first.

SvelteKit 3 configures the app in `vite.config.ts` (`sveltekit({ ... })`); there is no
`svelte.config.js` in the demo.

## Commands

Run these from the repo root.

```bash
pnpm build          # build all packages
pnpm test           # run tests (core type-checks its tests too)
pnpm typecheck      # tsc / svelte-check
pnpm lint           # ESLint
pnpm format         # format with Prettier
pnpm format:check   # check formatting without writing
pnpm dev            # watch builds and the demo dev server
pnpm clean          # remove build output
```

Add `--filter @grainshape/stet` (or `@grainshape/stet-svelte`, `@grainshape/stet-demo`) to run a task
for one package. Put extra Vitest flags straight after the script name, without `--`.

Before committing, run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check`.

## Code style

- TypeScript in strict mode with ES modules. In `core`, `"module": "NodeNext"`: relative imports
  need a `.js` extension, in tests too.
- Svelte 5 runes only.
- No `any`; use `unknown` and narrow it.
- Prettier formats everything (single quotes, no semicolons, trailing commas, 100 characters).
  Add formatting-only commits to `.git-blame-ignore-revs`.

## Commits and releases

- Conventional commits, enforced by commitlint in a Husky `commit-msg` hook. Scopes are usually
  `core`, `svelte` or `demo`.
- Both packages are `"private": true` until the first release, so pushes to `main` don't try to
  publish them. Before the first release: remove `private`, set up npm trusted publishing for both
  names, and add a changeset.
- A change to a published package needs a changeset in `.changeset/`. The demo is ignored by changesets.
- Releases run in GitHub Actions (`.github/workflows/release.yml`) with npm trusted publishing, so
  there's no npm token anywhere. Don't add one.
