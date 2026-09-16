import type { Context } from '@deepseek-ai/cordis'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'parent-sandbox-override'

/**
 * Snapshot-only overlay: switch each ROOT session to `read-only` at creation —
 * the UI "Access" switch equivalent (one runtime `sandbox/mode` event on the
 * session log) — so the scenario proves a continuable background child
 * inherits the parent's explicit override as a `source: 'delegation'` event
 * instead of falling back to the deployment default. The child waits for the
 * root to return to `idle` after its spawn turn, making settlement a later
 * queued turn rather than a timing-dependent steer into the spawn turn.
 */
export function apply(ctx: Context): void {
  const parentIdle = Promise.withResolvers<undefined>()
  let parentStarted = false
  ctx.effect(() => () => { parentIdle.resolve(undefined) }, 'subagent inheritance snapshot ordering')
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession !== undefined) return
    setSandboxMode(agent.session, 'read-only')
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (agent.session.header.parentSession !== undefined) return
    if (status === 'running') parentStarted = true
    if (status !== 'idle' || !parentStarted) return
    parentIdle.resolve(undefined)
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent.session.header.parentSession !== undefined) await parentIdle.promise
    return next()
  })
}
