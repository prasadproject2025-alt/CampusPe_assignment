import test from 'node:test'
import assert from 'node:assert/strict'
import { automationBrowserKey } from './manager.js'

test('isolates browser sessions per user and run', () => {
  assert.notEqual(automationBrowserKey('user-1', 'lever', 'run-a'), automationBrowserKey('user-1', 'lever', 'run-b'))
  assert.notEqual(automationBrowserKey('user-1', 'ashby', 'run-a'), automationBrowserKey('user-2', 'ashby', 'run-a'))
  assert.equal(automationBrowserKey('user-1', 'lever', 'run-a'), automationBrowserKey('user-1', 'ashby', 'run-a'))
})
