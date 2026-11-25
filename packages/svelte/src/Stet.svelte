<!--
  Root editing surface. Placeholder: it renders an editable region and its children
  until the document rendering and DOM input layer exist.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type * as Y from 'yjs'

  interface Props {
    /** The Yjs document to edit. */
    doc: Y.Doc
    /** Whether the content can be edited. */
    editable?: boolean
    children?: Snippet
  }

  let { doc, editable = true, children }: Props = $props()
</script>

<div class="stet" contenteditable={editable} data-stet-client={doc.clientID}>
  {@render children?.()}
</div>
