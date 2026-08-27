/**
 * Component props for the two annotation entries. The target slots
 * ('conversation.chat.assistant-actions' and 'conversation.input.right')
 * are declared and typed by ui-conversation; this package only contributes
 * entries, so no SlotMap merge lives here beyond the locale namespace.
 * @module @deepseek-ai/dsh-client-ui-annotations/client/slots
 */

import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from './locales.ts'
import type { createAnnotationsStore } from './stores.ts'

/** Full props of one assistant-message annotate entry. */
export type AnnotateActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & PropsStore<ReturnType<typeof createAnnotationsStore>>
  & PropsLocale<'annotations'>

/** Full props of the after-send submit-with-annotations entry. */
export type SubmitAnnotationsButtonProps =
  PropsRuntime<'conversation.input.right'>
  & PropsStore<ReturnType<typeof createAnnotationsStore>>
  & PropsLocale<'annotations'>
