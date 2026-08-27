// @vitest-environment jsdom
/**
 * ui-annotations browser half on a real cordis Context with fake slots/locale
 * faces: the plugin registers the annotate entry at
 * conversation.chat.assistant-actions and the submit entry at
 * conversation.input.right, and both registrations ride the plugin fiber
 * (HMR safety). The node half applies without host-side behavior.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

/** Boot the plugin over fake faces with the two target slots declared. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return { ctx, fiber }
}

describe('ui-annotations browser plugin', () => {
  it('registers both entries with their documented ids and order', async () => {
    const b = await bench()
    await b.fiber.await()

    const annotate = b.ctx.slots.entries('conversation.chat.assistant-actions')[0]
    const submit = b.ctx.slots.entries('conversation.input.right')[0]

    expect(annotate?.options).toMatchObject({ id: 'annotate', order: 20 })
    expect(submit?.options).toMatchObject({ id: 'submit-annotations', order: 0 })
  })

  it('withdraws both registrations when the plugin fiber disposes', async () => {
    const b = await bench()
    await b.fiber.await()

    await b.fiber.dispose()

    expect(b.ctx.slots.entries('conversation.chat.assistant-actions')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.input.right')).toHaveLength(0)
  })

  it('the node half applies without host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
