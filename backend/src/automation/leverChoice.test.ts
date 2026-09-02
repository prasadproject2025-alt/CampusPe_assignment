import test from 'node:test'
import assert from 'node:assert/strict'
import { leverOptionMatches } from './adapters/lever/LeverApplicationPage.js'
import { leverSelectors } from './adapters/lever/selectors.js'

test('does not confuse overlapping Lever option names', () => {
  assert.equal(leverOptionMatches('male', 'female'), false)
  assert.equal(leverOptionMatches('female', 'female'), true)
})

test('recognizes Lever submit buttons without a type attribute', () => {
  assert.match(leverSelectors.submit, /#btn-submit/)
  assert.match(leverSelectors.submit, /template-btn-submit/)
  assert.match(leverSelectors.submit, /data-qa=/)
})

test('recognizes Lever hCaptcha challenge variants', () => {
  assert.match(leverSelectors.captchaChallenge, /title\*="challenge"/)
  assert.match(leverSelectors.captchaChallenge, /data-hcaptcha-widget-id/)
})
