/**
 * Annotation store: the per-session handle seeds empty, add appends in order,
 * and clear empties. Subscribe hands back a working unsubscribe.
 */
import { describe, expect, it, vi } from 'vitest'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import { createAnnotationsStore } from '../src/client/stores.ts'

const MSG = 'm-1' as MessageId

describe('createAnnotationsStore', () => {
  it('seeds an empty item list', () => {
    expect(createAnnotationsStore().create().getSnapshot()).toEqual({ items: [] })
  })

  it('add appends annotations in call order', () => {
    const instance = createAnnotationsStore().create()

    instance.actions.add({ messageId: MSG, quotedText: 'q1', comment: 'c1' })
    instance.actions.add({ messageId: MSG, quotedText: 'q2', comment: '' })

    expect(instance.getSnapshot().items).toEqual([
      { messageId: MSG, quotedText: 'q1', comment: 'c1' },
      { messageId: MSG, quotedText: 'q2', comment: '' },
    ])
  })

  it('clear empties the list', () => {
    const instance = createAnnotationsStore().create()
    instance.actions.add({ messageId: MSG, quotedText: 'q', comment: 'c' })

    instance.actions.clear()

    expect(instance.getSnapshot().items).toEqual([])
  })

  it('notifies subscribers on write and unsubscribe stops them', () => {
    const instance = createAnnotationsStore().create()
    const listener = vi.fn()
    const unsubscribe = instance.subscribe(listener)

    instance.actions.add({ messageId: MSG, quotedText: 'q', comment: 'c' })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    instance.actions.clear()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
