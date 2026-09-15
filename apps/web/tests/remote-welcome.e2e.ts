// Insecure non-loopback Web access shares the Host settings document: the
// welcome acknowledgement persists without secure-context crypto APIs.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_COPY, WELCOME_NOTICE_VERSION,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: remote welcome notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      remoteAuthority: 'remote.test',
      welcomeNoticePending: true,
    })
    browser = await chromium.launch({
      ...(process.env.DSH_BROWSER_EXECUTABLE === undefined
        ? {}
        : { executablePath: process.env.DSH_BROWSER_EXECUTABLE }),
      args: ['--host-resolver-rules=MAP remote.test 127.0.0.1'],
    })
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('persists the welcome acknowledgement and loads Models after reload', async () => {
    expect(await page.evaluate(() => ({
      secure: globalThis.isSecureContext,
      randomUUID: typeof globalThis.crypto.randomUUID,
    }))).toEqual({ secure: false, randomUUID: 'undefined' })
    const hostRpc = await page.evaluate(async () => {
      const method = 'host.describe'
      const response = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'remote-http-host', method, payload: {} }),
      })
      return { status: response.status, body: JSON.parse(await response.text()) as unknown }
    })
    expect(hostRpc.status).toBe(200)
    expect(hostRpc.body).toMatchObject({ result: { ok: true } })

    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)
    const settingsRpc = await page.evaluate(async () => {
      const method = 'settings.describe'
      const response = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'remote-http-settings', method, payload: {} }),
      })
      return JSON.parse(await response.text()) as unknown
    })
    expect(JSON.stringify(settingsRpc)).toContain(WELCOME_NOTICE_VERSION)

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await expect.poll(() => welcome.count(), { timeout: 15_000 }).toBe(0)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.getByRole('button', { name: '模型' }).click()
    await settings.getByText('填入各提供方的 API 密钥即可使用其模型。').waitFor({ timeout: 15_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
