// @vitest-environment jsdom
/**
 * AnnotateAction rendering and gestures: the button opens the editor, seeds
 * the quoted text from the browser selection, adds only non-empty annotations
 * through the shared store's add action, and closes on save or cancel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import { AnnotateAction } from '../src/client/AnnotateAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const MSG = 'm-1' as MessageId
const t = makeTranslate(zh, commonZh)

function mount(add: ReturnType<typeof vi.fn> = vi.fn()) {
  const props = { messageId: MSG, actions: { add }, t } as unknown as Parameters<typeof AnnotateAction>[0]
  return render(<AnnotateAction {...props} />)
}

describe('AnnotateAction', () => {
  it('renders the annotate button', () => {
    const ui = mount()
    expect(ui.getByLabelText(zh['action.annotate'])).toBeTruthy()
  })

  it('opens the editor on click and seeds the quoted text from the selection', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '  selected text  ' } as never)

    const ui = mount()
    fireEvent.mouseDown(ui.getByLabelText(zh['action.annotate']))
    fireEvent.click(ui.getByLabelText(zh['action.annotate']))

    expect((ui.getByLabelText(zh['editor.quoted.placeholder']) as HTMLTextAreaElement).value).toBe('selected text')
    vi.restoreAllMocks()
  })

  it('adds a trimmed annotation and closes the editor', () => {
    const add = vi.fn()
    const ui = mount(add)

    fireEvent.click(ui.getByLabelText(zh['action.annotate']))
    fireEvent.change(ui.getByLabelText(zh['editor.quoted.placeholder']), { target: { value: '  q  ' } })
    fireEvent.change(ui.getByLabelText(zh['editor.comment.placeholder']), { target: { value: '  c  ' } })
    fireEvent.click(ui.getByText(zh['editor.add']))

    expect(add).toHaveBeenCalledWith({ messageId: MSG, quotedText: 'q', comment: 'c' })
    expect(ui.queryByLabelText(zh['editor.quoted.placeholder'])).toBeNull()
  })

  it('adds nothing and still closes when both fields are empty', () => {
    const add = vi.fn()
    const ui = mount(add)

    fireEvent.click(ui.getByLabelText(zh['action.annotate']))
    fireEvent.click(ui.getByText(zh['editor.add']))

    expect(add).not.toHaveBeenCalled()
    expect(ui.queryByLabelText(zh['editor.quoted.placeholder'])).toBeNull()
  })

  it('cancels without adding', () => {
    const add = vi.fn()
    const ui = mount(add)

    fireEvent.click(ui.getByLabelText(zh['action.annotate']))
    fireEvent.click(ui.getByText(zh['editor.cancel']))

    expect(add).not.toHaveBeenCalled()
    expect(ui.queryByLabelText(zh['editor.quoted.placeholder'])).toBeNull()
  })
})
