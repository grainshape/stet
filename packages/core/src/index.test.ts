import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createDoc, getNodes, NODES_KEY } from './index.js'

describe('createDoc', () => {
  it('creates a document with an empty node map', () => {
    const doc = createDoc()
    expect(getNodes(doc).size).toBe(0)
    expect(doc.share.has(NODES_KEY)).toBe(true)
  })
})

// Stet counts text offsets in UTF-16 code units, the same unit as the DOM and Y.Text.
// These tests pin that assumption so a Yjs upgrade that changed it would fail loudly.
describe('text offsets are UTF-16 code units', () => {
  it('counts an emoji outside the BMP as two units', () => {
    const text = new Y.Doc().getText('t')
    text.insert(0, 'a😀b')
    expect(text.length).toBe(4)
    expect(text.length).toBe('a😀b'.length)
  })

  it('inserts at a UTF-16 offset after a surrogate pair', () => {
    const text = new Y.Doc().getText('t')
    text.insert(0, 'a😀b')
    text.insert(3, 'X')
    expect(text.toString()).toBe('a😀Xb')
  })
})
