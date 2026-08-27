/**
 * Per-message annotate action: an icon button in the assistant message's
 * action strip that captures the current text selection and opens an inline
 * editor for the quoted text plus a comment.
 * @module @deepseek-ai/dsh-client-ui-annotations/client/AnnotateAction
 */

import { useCallback, useState } from 'react'
import { IconEditOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnnotateActionProps } from './slots.ts'
import css from './AnnotateAction.module.css'

/**
 * One message's annotate control.
 * @param props - the owner's message identity, the shared annotation store, and the copy.
 * @returns the annotate button, plus the inline editor while it is open.
 */
export function AnnotateAction({ messageId, actions, t }: AnnotateActionProps) {
  const [open, setOpen] = useState(false)
  const [quoted, setQuoted] = useState('')
  const [comment, setComment] = useState('')

  // Capture on mousedown: the click that follows moves focus and clears the
  // selection, so the selection is read before the button steals it.
  const captureSelection = useCallback(() => {
    setQuoted(window.getSelection()?.toString().trim() ?? '')
  }, [])

  const openEditor = useCallback(() => {
    setComment('')
    setOpen(true)
  }, [])

  const save = useCallback(() => {
    const q = quoted.trim()
    const c = comment.trim()
    if (q !== '' || c !== '') actions.add({ messageId, quotedText: q, comment: c })
    setOpen(false)
  }, [actions, comment, messageId, quoted])

  return (
    <>
      <Tooltip label={t('action.annotate')} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={t('action.annotate')}
          aria-expanded={open}
          data-active={open || undefined}
          onMouseDown={captureSelection}
          onClick={openEditor}
        >
          <IconEditOutline16 />
        </button>
      </Tooltip>
      {open && (
        <span className={css.editor}>
          <textarea
            className={css.quoted}
            aria-label={t('editor.quoted.placeholder')}
            placeholder={t('editor.quoted.placeholder')}
            value={quoted}
            rows={1}
            onChange={(event) => { setQuoted(event.target.value) }}
          />
          <textarea
            className={css.comment}
            aria-label={t('editor.comment.placeholder')}
            placeholder={t('editor.comment.placeholder')}
            value={comment}
            rows={2}
            onChange={(event) => { setComment(event.target.value) }}
          />
          <button type="button" className={css.save} onClick={save}>{t('editor.add')}</button>
          <button type="button" className={css.cancel} onClick={() => { setOpen(false) }}>{t('editor.cancel')}</button>
        </span>
      )}
    </>
  )
}
