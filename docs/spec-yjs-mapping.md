# Spec: the Stet document on Yjs

Status: draft, for review. Nothing here is implemented yet.

This spec defines how a Stet document is stored in a `Y.Doc`, how selections and annotations stay
anchored while other people edit, how undo works, and how Svelte components learn about changes.
It is the foundation for milestone 1 (`@grainshape/stet`, no DOM).

Fixed decisions this spec builds on:

- Yjs is the source of truth for the document. There is no second in-memory model that has to be
  kept in sync with it; everything else (Svelte state, the DOM) is derived from the `Y.Doc`.
- Text offsets are UTF-16 code units, the same unit as the DOM and `Y.Text`.

## 1. Goals and non-goals

Goals:

- Content is a graph of nodes with stable IDs, close to svedit's model, so a page layout can place
  each property of a node anywhere.
- Concurrent edits by several people (or tabs, or offline clients) always converge, and the result
  is still a document Stet can render.
- Moving a node (reordering cards, dragging a section) never loses or duplicates its content.
- Undo only reverts your own changes.
- Every rule here can be tested in Node, without a browser.

Non-goals for now:

- Transport and persistence (y-websocket, Hocuspocus, IndexedDB). Any Yjs provider should work.
- Access control per node.
- Schema migrations for documents that are already shared (see open questions).

## 2. Schema

A schema is a plain, JSON-compatible object, so it can be stored, sent and validated. It describes
node types and their properties.

```ts
type Schema = {
  version: number
  nodes: Record<string, NodeType>
  marks: Record<string, MarkType>
}

type NodeType = {
  kind: 'block' | 'annotation'
  properties: Record<string, PropertyType>
}

type PropertyType =
  | { type: 'string' | 'number' | 'boolean'; default?: string | number | boolean }
  | { type: 'json'; default?: Json } // any JSON value, replaced as a whole
  | { type: 'text'; marks?: string[] } // rich text; allowed mark types, default: all
  | { type: 'node'; node_types: string[]; required?: boolean } // one owned child
  | { type: 'node_array'; node_types: string[] } // ordered owned children

type MarkType = {
  /** Does text typed at the mark's end edge get the mark? Bold: true. Link: false. */
  inclusive: boolean
  /** Attribute names a mark of this type carries, e.g. href for a link. */
  attrs?: string[]
}
```

Example: a page with a hero and a grid of cards.

```ts
const schema: Schema = {
  version: 1,
  nodes: {
    page: {
      kind: 'block',
      properties: { body: { type: 'node_array', node_types: ['hero', 'card_grid'] } },
    },
    hero: { kind: 'block', properties: { title: { type: 'text' }, image: { type: 'string' } } },
    card_grid: {
      kind: 'block',
      properties: { cards: { type: 'node_array', node_types: ['card'] } },
    },
    card: {
      kind: 'block',
      properties: {
        title: { type: 'text', marks: [] },
        body: { type: 'text' },
        image: { type: 'string' },
      },
    },
    comment: {
      kind: 'annotation',
      properties: { body: { type: 'text' }, author: { type: 'string' } },
    },
  },
  marks: {
    strong: { inclusive: true },
    emphasis: { inclusive: true },
    link: { inclusive: false, attrs: ['href'] },
  },
}
```

Differences from svedit, on purpose:

- No `text` node kind. In svedit a `text` node has exactly one splittable `content` property. Here
  any node can have any number of `text` properties; splitting and joining paragraphs is a command
  over node arrays, not a node kind.
- Marks of different types may overlap (bold inside a link is normal). Marks of the same type can't
  overlap, which `Y.Text` gives for free.
- Annotations are nodes, so they can have their own properties (a comment has a body and an
  author) and can be undone and synced like anything else.

## 3. Layout in the `Y.Doc`

```
Y.Doc
├─ "meta"   Y.Map
│    ├─ root            string   ID of the root node
│    └─ schema_version  number
└─ "nodes"  Y.Map<NodeId, Y.Map>
     └─ <node id>  Y.Map
          ├─ id      string        same as the key, so a node map is self-describing
          ├─ type    string        node type name from the schema
          ├─ <string | number | boolean | json property>   plain value
          ├─ <text property>        Y.Text
          ├─ <node property>        string (child node ID)
          └─ <node_array property>  Y.Array<string> (child node IDs)
```

The key rule: **every node lives in the flat `nodes` map, and parents refer to children by ID.**
Node arrays hold ID strings, never nested `Y.Map`s.

Why: Yjs has no move operation. Moving an item in a `Y.Array` is a delete plus an insert, and if the
item were a nested `Y.Map` the insert would have to be a copy, which loses concurrent edits made to
the original and breaks undo. With IDs, moving a card only moves a short string; the card's content
stays where it is in the `nodes` map, untouched.

Property values by type:

| Schema type                   | Stored as                   | Concurrent edits                                   |
| ----------------------------- | --------------------------- | -------------------------------------------------- |
| `string`, `number`, `boolean` | plain value in the node map | last writer wins, per property                     |
| `json`                        | plain value in the node map | last writer wins for the whole value               |
| `text`                        | `Y.Text`                    | merged character by character; marks merged by Yjs |
| `node`                        | child ID string             | last writer wins                                   |
| `node_array`                  | `Y.Array<string>`           | merged; see moves and duplicates in §6             |

A property that is missing from a node map is read as the schema's `default` (or the type's
natural empty value: `''`, `0`, `false`, `null`, empty text, empty array). Commands only write
properties that differ from the default when they create a node. This keeps documents small and
makes adding a property to the schema free.

### Node IDs

- Random, 12 characters from `[0-9A-Za-z]` (about 71 bits), generated with `crypto.getRandomValues`.
  Collisions are not a practical concern at document sizes, and IDs don't leak the Yjs client ID.
- IDs never change and are never reused, not even after a node is deleted.
- Apps may pass their own IDs when importing content (for stable URLs, anchors, tests). They must
  match `^[0-9A-Za-z_-]{1,64}$`.

### Node type changes

`type` is an ordinary last-writer-wins property, so "turn this paragraph into a heading" keeps the
node's ID and its text. Properties the new type doesn't define stay stored but are ignored, so
changing the type back restores them. This avoids creating a new node, which would break
references, annotations and remote cursors pointing at the old one.

## 4. Text and marks

A `text` property is a `Y.Text`. Marks are `Y.Text` formatting attributes:

- Attribute key: the mark type name (`strong`, `link`).
- Attribute value: `true` for a mark without attributes, or an object with its attributes
  (`{ href: 'https://…' }`).

Offsets are UTF-16 code units everywhere: in commands, selections, the JSON format and the DOM layer.
Commands must never split a surrogate pair; a helper rounds offsets to code-point boundaries and is
used by every command that takes an offset from outside (the DOM layer, the app).

**Inserting text always passes explicit attributes.** When `Y.Text.insert` gets no attributes, the
new text inherits the formatting of the character before it, which would make every mark inclusive.
Stet's insert command computes the attributes itself:

- At a position inside a mark: the text gets the mark.
- At a mark's end edge: the text gets the mark only if its type is `inclusive`. Otherwise the
  attribute is passed as `null`.
- At a mark's start edge: the text doesn't get the mark (same as ProseMirror's default).
- The session can override this with "stored marks" (toggling bold with a collapsed selection,
  then typing), like ProseMirror's `storedMarks`.

Inline nodes (a mention, an inline image) are reserved for later. They would be `Y.Text` embeds
holding a node ID, `{ node: '<id>' }`, which count as one offset unit.

## 5. Annotations

Annotations are data that point at a range of text and may overlap each other: comments,
suggestions, highlights from search. They are nodes of `kind: 'annotation'`, stored in the `nodes`
map like any other node, with three reserved properties:

| Property | Stored as                     | Meaning                           |
| -------- | ----------------------------- | --------------------------------- |
| `target` | `[node_id, property]` as JSON | the text property the range is in |
| `start`  | encoded `Y.RelativePosition`  | start of the range                |
| `end`    | encoded `Y.RelativePosition`  | end of the range                  |

Relative positions are created with `Y.createRelativePositionFromTypeIndex(ytext, index, assoc)` and
stored with `Y.relativePositionToJSON`. A relative position points at a character, not a number, so
the range follows the text through any concurrent insertions or deletions.

Edge behaviour, chosen so that typing just before or after an annotation doesn't grow it:

- `start` uses `assoc = 0` (it sticks to the character on its right).
- `end` uses `assoc = -1` (it sticks to the character on its left).

If all the annotated text is deleted, both positions collapse to the same point. The annotation is
kept (a comment on deleted text is still a comment) and reported as `collapsed`, so the app can show
it as detached.

Annotations aren't referenced from a node array. The session keeps an in-memory index from target to
annotations, rebuilt from the `nodes` map on load and updated from change events.

## 6. Ownership, moves and normalization

### Ownership

The document is a tree of ownership: every node except the root is owned by exactly one `node` or
`node_array` property of one other node. Annotations are owned by nothing; they belong to their
target.

### Deleting nodes

Deleting a node removes its ID from its parent. **Its entry in the `nodes` map is not deleted.**

- A concurrent edit to the deleted node (someone else was typing in that card) still lands in its
  map, so undoing the delete brings back their edits too.
- Undo of a delete only has to re-insert one ID string.

Nodes that nothing reaches from the root are orphans. They are invisible but cost storage. A later
compaction step can remove orphans older than some age; that's out of scope here.

### Moves

A move is delete-ID-plus-insert-ID inside one transaction. Two concurrent moves of the same node to
different places produce both inserts, so the ID ends up in two places. Normalization fixes that.

### Normalization

After every transaction that didn't come from this session (a remote update, or a local update from
another origin), the session runs a normalization pass. Each rule is **deterministic and
idempotent**: every peer sees the same converged state, so every peer computes the same fix, and
applying the same deletions twice is harmless in Yjs.

1. **Duplicate IDs.** Walk the tree from the root in document order (depth first, arrays in index
   order). The first occurrence of an ID wins; every later occurrence is deleted from its array, or
   its `node` property is cleared.
2. **Cycles** (possible with concurrent moves: A moved into B while B moved into A). The same walk
   detects them; the reference that closes the cycle is removed, which makes the subtree an orphan
   that undo can restore.

Normalization runs with origin `'stet:normalize'`, which the undo manager doesn't track.

Everything else is **tolerated at render time, not repaired**, so no peer ever deletes data because
its schema is a little older or newer:

- An ID in an array whose node doesn't exist (yet): skipped when rendering.
- A child whose type isn't allowed in that array: rendered with the app's fallback component.
- An unknown node type: rendered with the fallback component, and its data is left alone.

## 7. Selection

```ts
type Selection =
  | { type: 'text'; path: [NodeId, string]; anchor: number; focus: number }
  | { type: 'node'; path: [NodeId, string]; anchor: number; focus: number } // range of array items
  | { type: 'property'; path: [NodeId, string] } // a whole non-text property, e.g. an image
```

- `text`: offsets in UTF-16 units into the `Y.Text`. Collapsed when `anchor === focus`.
- `node`: indexes between items of a node array (0 is before the first item), so a collapsed node
  selection is a caret between blocks, the place where svedit shows its gap tools.
- `property`: for `string`, `number`, `boolean`, `json` and `node` properties.

Selections never span two different properties. Selecting across blocks is a `node` selection in
their common parent's array. This keeps every selection anchored to one Yjs type.

**The session stores the selection as relative positions**, created on the `Y.Text` or the
`Y.Array`, and converts them to numbers when read. A remote edit before the cursor therefore moves
the cursor with the text instead of shifting it. The anchor uses `assoc = 0` and the focus
`assoc = -1` when the selection isn't collapsed, so remote typing at either edge stays outside it.

If the selection's node is deleted or orphaned remotely, the session moves the selection to the
nearest surviving position in the parent array (a collapsed `node` selection where the node was).

Remote cursors use the y-protocols awareness API: each client publishes its selection as encoded
relative positions plus a user name and color.

## 8. Transactions and commands

All writes go through one entry point:

```ts
session.transact((tr) => {
  tr.insert_text([card_id, 'title'], 0, 'Hello')
  tr.set_selection({ type: 'text', path: [card_id, 'title'], anchor: 5, focus: 5 })
})
```

- `session.transact` wraps `doc.transact(fn, session.origin)`, where `session.origin` is an object
  unique to the session. The undo manager and the change listeners use it to tell local edits from
  remote ones.
- `tr` offers typed operations: `create_node`, `set`, `insert_text`, `delete_text`, `format_text`,
  `insert_nodes`, `remove_nodes`, `move_nodes`, `set_selection`. They validate against the schema
  and throw on invalid input, before writing anything.
- A command is a function `(session, tr) => boolean`, returning `false` when it doesn't apply
  (like ProseMirror commands), so keymaps can try several in order. Commands can be run in dry mode
  to ask "would this apply?" for toolbar state.

## 9. Undo

One `Y.UndoManager` per session:

```ts
new Y.UndoManager(doc.getMap('nodes'), {
  trackedOrigins: new Set([session.origin]),
  captureTimeout: 500,
})
```

- The scope is the whole `nodes` map, which covers every nested `Y.Text` and `Y.Array`.
- `trackedOrigins` means only this session's changes are undone. Remote changes and normalization
  are never reverted by your undo, and Yjs keeps your undo correct around them.
- Typing is grouped by the 500 ms capture window. In addition, the session calls `stopCapturing()`
  when the selection jumps (a click, arrow keys out of the current word), when a command that isn't
  plain typing runs, and on blur, so undo steps match what the user sees as one action.
- Selections are restored with undo: on `stack-item-added` the session stores the selection before
  the change (as relative positions) in `stackItem.meta`; on `stack-item-popped` it restores it.

## 10. Svelte reactivity bridge

Svelte components must update when the `Y.Doc` changes, and only the components whose data changed.

- `@grainshape/stet-svelte` exposes readers such as `node(id)`, `text(id, prop)` and
  `array(id, prop)`, built with Svelte's `createSubscriber` from `svelte/reactivity`. A reader
  attaches a Yjs observer (`ymap.observe`, `ytext.observe`, `yarray.observe`) only while some
  effect is reading it, and detaches when the last one is torn down.
- Node maps observe shallowly, so typing in a card's title updates the title's text reader, not
  the card component.
- A text reader exposes the `Y.Text` delta (runs of text with their marks), which the text property
  component renders as spans. How DOM edits flow back into `Y.Text` is the DOM input layer's job
  (milestone 3), not this spec.
- `core` has no Svelte dependency. It exposes the same readers as plain subscribe functions;
  `stet-svelte` only wraps them.

## 11. JSON format

For import, export, tests, server-side rendering and fixtures, a document can be converted to and
from plain JSON:

```json
{
  "root": "page_1",
  "schema_version": 1,
  "nodes": {
    "page_1": { "id": "page_1", "type": "page", "body": ["hero_1"] },
    "hero_1": {
      "id": "hero_1",
      "type": "hero",
      "title": [{ "insert": "Hello " }, { "insert": "world", "attributes": { "strong": true } }],
      "image": "/hero.jpg"
    }
  }
}
```

- Text properties are Yjs deltas (`Y.Text.toDelta()`), so offsets are UTF-16 units by construction.
- Annotations export `start` and `end` as plain offsets (resolved at export time) and are re-anchored
  as relative positions on import.
- Export only includes nodes reachable from the root, plus annotations on them. Orphans aren't exported.
- Importing creates a fresh `Y.Doc` in one transaction with origin `'stet:import'`, not tracked by undo.

## 12. Testing

Milestone 1 is only done when these pass in Node:

- **Unit tests** for every `tr` operation and command, including surrogate pairs (emoji) at every
  offset rule.
- **Convergence fuzz tests.** Two or three `Y.Doc`s each apply random commands, exchange updates in
  random order (and sometimes not at all for a while, to simulate offline clients), then sync.
  After sync and normalization: all docs have identical JSON exports, every node is reachable at
  most once, there are no cycles, and every selection and annotation resolves to valid offsets.
- **Undo fuzz tests.** Random local and remote edits, then undo everything local: the result
  contains exactly the remote edits.
- **Round-trip tests.** JSON → `Y.Doc` → JSON is identity for documents without orphans.

## 13. Open questions

1. **Schema migrations on shared documents.** Two clients migrating the same document at the same
   time can conflict. Options: migrations must be deterministic and idempotent (same rule as
   normalization), or migrations only run on the server before clients load. Leaning towards the
   server, with render-time tolerance (§6) covering the gap.
2. **Orphan compaction.** When is it safe to remove orphans, given undo stacks and offline clients
   that may still restore them? Probably only on the server, after a long grace period.
3. **Splitting text across nodes.** Splitting a paragraph moves the text after the cursor into a new
   node. A concurrent edit in that moved part lands in the old node, after the split point. Yjs can't
   prevent that; we need to measure how often it happens in practice and whether a "late edit"
   repair rule is worth it.
4. **Cross-property selection.** Selecting from the middle of one card's title into the next card's
   body is not possible with this model; the selection becomes a node selection over both cards.
   This matches svedit, but confirm it's acceptable UX.
5. **Size of the `nodes` map.** Every node map entry stays in the Yjs history forever. For large
   sites, check memory and load time with 10,000+ nodes early (svedit has a perf test page to borrow
   ideas from).
