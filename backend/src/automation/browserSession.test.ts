import test from 'node:test'
import assert from 'node:assert/strict'
import { automationBrowserKey } from './manager.js'

test('isolates Lever CDP sessions from standard job-board browsers', () => {
  assert.equal(automationBrowserKey('user-1', 'lever'), 'lever-cdp:user-1')
  assert.equal(automationBrowserKey('user-1', 'ashby'), 'standard:user-1')
})
