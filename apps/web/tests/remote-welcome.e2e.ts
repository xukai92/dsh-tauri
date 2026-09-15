import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_COPY, WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
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
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch({
      ...executablePath === undefined ? {} : { executablePath },
      args: ['--host-resolver-rules=MAP remote.test 127.0.0.1'],
    })
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('persists acknowledgement through authenticated RPC on insecure HTTP', async () => {
    expect(await page.evaluate(() => ({
      isSecureContext: globalThis.isSecureContext,
      randomUUID: typeof globalThis.crypto.randomUUID,
    }))).toEqual({ isSecureContext: false, randomUUID: 'undefined' })

    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)
    await expect.poll(
      () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8').catch(() => ''),
      { timeout: 15_000 },
    ).toContain(`${WELCOME_NOTICE_ACK_FIELD}: ${WELCOME_NOTICE_VERSION}`)

    const rpcBody = JSON.stringify({
      type: 'client-request',
      rpcId: 'remote-welcome-settings',
      method: 'settings/describe',
      payload: { args: {} },
    })
    const described = await scaffold.hostFetch('/api/settings/describe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rpcBody,
    })
    expect(described.status).toBe(200)
    const describedText = await described.text()
    expect(describedText).toContain('"type":"server-response"')
    expect(describedText).toContain(`"ns":"${WELCOME_NOTICE_SETTINGS_NAMESPACE}"`)
    expect(describedText).toContain(`"${WELCOME_NOTICE_ACK_FIELD}":"${WELCOME_NOTICE_VERSION}"`)

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 15_000 })
    await settings.getByRole('button', { name: '模型' }).waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)
    expect(await welcome.count()).toBe(0)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
