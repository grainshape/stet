/**
 * @grainshape/stet: framework-agnostic core.
 *
 * Scaffold only. The document-to-Yjs mapping is still being specified in docs/; the names
 * below are provisional.
 */
import * as Y from 'yjs'

/** Node IDs are stable strings, unique within a document. */
export type NodeId = string

/** Name of the top-level `Y.Map` that holds every node, keyed by node ID. */
export const NODES_KEY = 'nodes'

/** Creates an empty Stet document. */
export function createDoc(): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap(NODES_KEY)
  return doc
}

/** The map of all nodes in a document. */
export function getNodes(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(NODES_KEY)
}
