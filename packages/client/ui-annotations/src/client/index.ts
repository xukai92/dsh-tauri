/**
 * Text-annotation plugin, browser half: the Annotate entry in the
 * conversation.chat.assistant-actions strip and the Submit-w/-Annotations
 * control after the composer's send button. One per-session store backs both
 * entries, so a single list read seeds the whole transcript. Annotations are
 * client-local (in-memory per session); submitting appends them to the draft
 * as a plain-text block, so they reach the model through the ordinary sink.
 * @module @deepseek-ai/dsh-client-ui-annotations/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (assistant-actions and input.right).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createAnnotationsStore } from './stores.ts'
import { AnnotateAction } from './AnnotateAction.tsx'
import { SubmitAnnotationsButton } from './SubmitAnnotationsButton.tsx'
import { en, zh } from './locales.ts'

export type { Annotation, AnnotationsState } from './stores.ts'
export type { AnnotateActionProps, SubmitAnnotationsButtonProps } from './slots.ts'
export type { AnnotationsKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'annotations'

/** Required services: the slot registry and the copy. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the per-message annotate entry, the after-send submit
 * entry, and the shared per-session store.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-annotations: dictionaries')

  // One shared handle so the annotate action and the submit control address the
  // same per-session instance.
  const store = createAnnotationsStore()

  ctx.slots.inject('conversation.chat.assistant-actions', () =>
    ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'annotate',
      order: 20,
      locale: NS,
      store,
    }, AnnotateAction))

  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register({
      name: 'conversation.input.right',
      id: 'submit-annotations',
      order: 0,
      locale: NS,
      store,
    }, SubmitAnnotationsButton))
}
