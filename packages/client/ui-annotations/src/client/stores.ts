/**
 * Per-session annotation store shared by the annotate action and the
 * submit-with-annotations control. The plugin creates its handle at apply time
 * so identity follows the fiber; both registrations share one handle, so both
 * entries read and write the same per-session instance.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'

/** One recorded annotation: the selected text, the human comment, and the addressed message. */
export interface Annotation {
  /** The finalized assistant message the annotation addresses. */
  messageId: MessageId
  /** The text the user selected, verbatim. */
  quotedText: string
  /** The human's comment. */
  comment: string
}

/** Store state: the ordered list of pending annotations. */
export interface AnnotationsState {
  items: Annotation[]
}

/** Declared action shape (the complete write set; components write only through these). */
type AnnotationsActions = {
  add: (draft: AnnotationsState, item: Annotation) => void
  clear: (draft: AnnotationsState) => void
}

/**
 * Declares the per-session annotation state and write surface.
 * @returns the store handle.
 */
export function createAnnotationsStore(): EngineStoreHandle<AnnotationsState, AnnotationsActions> {
  return defineStore({
    init: (): AnnotationsState => ({ items: [] }),
    actions: {
      add: (d, item: Annotation) => { d.items.push(item) },
      clear: (d) => { d.items = [] },
    },
  })
}
