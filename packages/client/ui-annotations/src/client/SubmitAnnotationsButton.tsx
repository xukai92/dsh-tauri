/**
 * Submit-with-annotations control: an icon button rendered in the composer's
 * right-side tool row before the primary send button. It appears only while annotations are pending and
 * submits the current draft with the annotations appended as plain text.
 * @module @deepseek-ai/dsh-client-ui-annotations/client/SubmitAnnotationsButton
 */

import { useCallback } from 'react'
import { IconNewChatOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SubmitAnnotationsButtonProps } from './slots.ts'
import css from './SubmitAnnotationsButton.module.css'

/**
 * The after-send submit control.
 * @param props - the live input and actions, the shared annotation store, and the copy.
 * @returns the button, or nothing while no annotations are pending.
 */
export function SubmitAnnotationsButton({ input, inputActions, useStore, actions, t }: SubmitAnnotationsButtonProps) {
  const items = useStore(s => s.items)

  const submit = useCallback(() => {
    const block = items.map((a, i) => `${i + 1}. “${a.quotedText}”: ${a.comment}`).join('\n')
    const draft = input.draft
    const tail = draft.trim() === '' ? `[Annotations]\n${block}` : `${draft}\n\n[Annotations]\n${block}`
    inputActions.setDraft(tail)
    inputActions.submit()
    actions.clear()
  }, [actions, input.draft, inputActions, items])

  if (items.length === 0) return null

  return (
    <Tooltip label={t('submit.label')} side="top">
      <button type="button" className={css.button} aria-label={t('submit.label')} onClick={submit}>
        <IconNewChatOutline16 />
        <span className={css.badge}>{items.length}</span>
      </button>
    </Tooltip>
  )
}
