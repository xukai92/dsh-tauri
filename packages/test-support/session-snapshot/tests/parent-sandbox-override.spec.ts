import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { apply } from './fixtures/parent-sandbox-override.ts'

describe('parent sandbox override snapshot fixture', () => {
  it('holds a child step through turn end until the root becomes idle', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin({ apply }).await()
      const child = { session: { header: { parentSession: 'parent' } } } as Agent
      const parent = { session: { header: {} } } as Agent
      agentEvents(ctx, parent).emit('agent/status', { status: 'running' })
      const next = vi.fn(() => Promise.resolve({ kind: 'enter' as const, messages: [] }))
      const pending = agentEvents(ctx, child).waterfall(
        'agent/pre-step',
        { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
        next,
      )

      await Promise.resolve()
      expect(next).not.toHaveBeenCalled()
      ctx.emit(
        'session/event',
        { header: { id: 'parent' } } as never,
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as never,
      )
      await Promise.resolve()
      expect(next).not.toHaveBeenCalled()
      agentEvents(ctx, parent).emit('agent/status', { status: 'idle' })
      await expect(pending).resolves.toEqual({ kind: 'enter', messages: [] })
      expect(next).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
