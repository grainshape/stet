# Stet

Structured, in-place content editing for Svelte 5, built on Yjs.

You model content as a graph of nodes with stable IDs, render it with your own Svelte components,
and edit it directly in the page layout. Yjs is the source of truth from day one, so undo,
position tracking and real-time collaboration come from the same model.

Inspired by [svedit](https://github.com/michael/svedit) (the in-place, layout-first editing model)
and [ProseMirror](https://prosemirror.net) (robust DOM input handling).

> Status: early scaffold. Nothing is usable yet.

## Packages

| Package                                      | Description                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@grainshape/stet`](packages/core)          | Framework-agnostic core: document model, schema, Yjs mapping, selection, commands |
| [`@grainshape/stet-svelte`](packages/svelte) | Svelte 5 rendering and DOM input layer                                            |
| [`apps/demo`](apps/demo)                     | Private demo and manual test page                                                 |

## Decisions so far

- Yjs is the source of truth for the document.
- Text offsets count UTF-16 code units, the same as the DOM and `Y.Text`.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

See [AGENTS.md](AGENTS.md) for conventions.

## License

MIT
