<script lang="ts">
  import { createDoc } from '@grainshape/stet'
  import { Stet } from '@grainshape/stet-svelte'

  const doc = createDoc()
</script>

<svelte:head>
  <title>Stet demo</title>
</svelte:head>

<main>
  <h1>Stet</h1>
  <p>Scaffold only. This page becomes the test page: a hero, a grid of cards and a list.</p>
  <Stet {doc}>
    <p>Editable placeholder.</p>
  </Stet>
</main>
