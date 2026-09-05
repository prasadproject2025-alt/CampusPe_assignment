import assert from 'node:assert/strict'
import test from 'node:test'
import { detectAdapter } from '../registry.js'
import { canProgrammaticallySubmit, capabilitiesForBoard, resolveApplicationStrategy, shouldLaunchBrowserForStrategy } from './strategyResolver.js'
import { boardCapabilities } from './capabilities.js'

test('selects Greenhouse custom form and Ashby custom form first', () => {
  assert.equal(resolveApplicationStrategy('greenhouse').strategy, 'CUSTOM_FORM')
  assert.equal(capabilitiesForBoard('greenhouse').supportsEmbed, true)
  assert.equal(capabilitiesForBoard('greenhouse').supportsCustomForm, true)
  assert.equal(resolveApplicationStrategy('ashby').strategy, 'CUSTOM_FORM')
  assert.equal(capabilitiesForBoard('ashby').supportsEmbed, false)
  assert.equal(capabilitiesForBoard('ashby').schemaSource, 'public_api')
  assert.equal(boardCapabilities('ashby').extractMode, 'http')
  assert.equal(boardCapabilities('ashby').submitMode, 'server_browser')
})

test('keeps Playwright as backend extract/submit for boards without a public form API', () => {
  for (const board of ['lever', 'breezy', 'bamboohr', 'rippling', 'workable', 'recruitee']) {
    const resolved = resolveApplicationStrategy(board)
    assert.equal(resolved.strategy, 'CUSTOM_FORM')
    assert.equal(resolved.capabilities.supportsCustomForm, true)
    assert.equal(boardCapabilities(board).extractMode, 'server_browser')
    assert.equal(boardCapabilities(board).submitMode, 'server_browser')
    assert.equal(shouldLaunchBrowserForStrategy(resolved.strategy), false)
  }
})

test('detects ATS hosts used by strategy selection', () => {
  assert.equal(detectAdapter('https://jobs.ashbyhq.com/notion/59abc')?.id, 'ashby')
  assert.equal(detectAdapter('https://job-boards.greenhouse.io/airtable/jobs/8403127002')?.id, 'greenhouse')
  assert.equal(detectAdapter('https://jobs.lever.co/jumpcloud/4ebbdea9-39c2-465d-bbdf-bf379a8e4a06')?.id, 'lever')
  assert.equal(detectAdapter('https://linkedin.com/jobs/view/123'), null)
})

test('auto-submit is blocked for official embeds and allowed for custom form', () => {
  assert.equal(canProgrammaticallySubmit('EMBED'), false)
  assert.equal(canProgrammaticallySubmit('MANUAL_REQUIRED'), false)
  assert.equal(canProgrammaticallySubmit('CUSTOM_FORM'), true)
  assert.equal(canProgrammaticallySubmit('BROWSER_AUTOMATION'), true)
  assert.equal(shouldLaunchBrowserForStrategy('CUSTOM_FORM'), false)
  assert.equal(shouldLaunchBrowserForStrategy('EMBED'), false)
  assert.equal(shouldLaunchBrowserForStrategy('BROWSER_AUTOMATION'), false)
})
