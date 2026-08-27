// @vitest-environment jsdom
/**
 * SubmitAnnotationsButton rendering and submission: hidden with no
 * annotations, shows a count with some, appends the plain-text block to the
 * draft, submits through inputActions, and clears the shared store.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import { SubmitAnnotationsButton } from '../src/client/SubmitAnnotationsButton.tsx'
import { createAnnotationsStore, type Annotation, type AnnotationsState } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const MSG = 'm-1' as MessageId
const t = makeTranslate(zh, commonZh)

function mount(items: readonly Annotation[], draft = 'hello') {
  const instance = createAnnotationsStore().create()
  for (const item of items) instance.actions.add(item)
  const useStore = (<T,>(select: (s: AnnotationsState) => T): T =>
    useSyncExternalStore(instance.subscribe, () => select(instance.getSnapshot()))) as never
  const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
  const props = {
    input: { draft },
    inputActions,
    useStore,
    actions: instance.actions,
    t,
  } as unknown as Parameters<typeof SubmitAnnotationsButton>[0]
  const ui = render(<SubmitAnnotationsButton {...props} />)
  return { ui, instance, inputActions }
}

describe('SubmitAnnotationsButton', () => {
  it('renders nothing while no annotations are pending', () => {
    const { ui } = mount([])
    expect(ui.container.firstChild).toBeNull()
  })

  it('shows the submit button with a count once annotations exist', () => {
    const { ui } = mount([{ messageId: MSG, quotedText: 'q', comment: 'c' }])
    expect(ui.getByLabelText(zh['submit.label'])).toBeTruthy()
    expect(ui.getByText('1')).toBeTruthy()
  })

  it('appends the annotation block, submits, and clears', () => {
    const { ui, instance, inputActions } = mount([
      { messageId: MSG, quotedText: 'q1', comment: 'c1' },
      { messageId: MSG, quotedText: 'q2', comment: 'c2' },
    ])

    fireEvent.click(ui.getByLabelText(zh['submit.label']))

    expect(inputActions.setDraft).toHaveBeenCalledWith('hello\n\n[Annotations]\n1. “q1”: c1\n2. “q2”: c2')
    expect(inputActions.submit).toHaveBeenCalledTimes(1)
    expect(instance.getSnapshot().items).toEqual([])
  })

  it('submits the block alone when the draft is blank', () => {
    const { ui, inputActions } = mount(
      [{ messageId: MSG, quotedText: 'q', comment: 'c' }],
      '   ',
    )

    fireEvent.click(ui.getByLabelText(zh['submit.label']))

    expect(inputActions.setDraft).toHaveBeenCalledWith('[Annotations]\n1. “q”: c')
  })
})
