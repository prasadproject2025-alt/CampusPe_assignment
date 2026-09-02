import assert from 'node:assert/strict'
import test from 'node:test'
import { leverSelectors } from './adapters/lever/selectors.js'
import { workableSelectors } from './adapters/workable/selectors.js'
import { canonicalJobUrl, detectAdapter, supportedBoards } from './registry.js'

test('detects all supported job links', () => {
  assert.equal(detectAdapter('https://jobs.ashbyhq.com/example/abc')?.id, 'ashby')
  assert.equal(detectAdapter('https://job-boards.greenhouse.io/eudia/jobs/4020070009')?.id, 'greenhouse')
  assert.equal(detectAdapter('https://boards.greenhouse.io/eudia/jobs/4020070009')?.id, 'greenhouse')
  assert.equal(detectAdapter('https://ats.rippling.com/rippling/jobs/eafc8f76-04f8-4a93-a35b-103e1337577d')?.id, 'rippling')
  assert.equal(detectAdapter('https://ats.rippling.com/en-GB/rippling/jobs/6c7773e1-2f16-452a-b1df-abc06467d9a3')?.id, 'rippling')
  assert.equal(detectAdapter('https://shopritex.breezy.hr/p/0cd2475842bb-software-engineer-i/apply')?.id, 'breezy')
  assert.equal(detectAdapter('https://example.breezy.hr/p/0cd2475842bb-software-engineer-i')?.id, 'breezy')
  assert.equal(detectAdapter('https://jobs.lever.co/jumpcloud/4ebbdea9-39c2-465d-bbdf-bf379a8e4a06/apply')?.id, 'lever')
  assert.equal(detectAdapter('https://jobs.eu.lever.co/example/4ebbdea9-39c2-465d-bbdf-bf379a8e4a06')?.id, 'lever')
  assert.equal(detectAdapter('https://apply.workable.com/domain-tools/j/40A8A850B2/apply/')?.id, 'workable')
  assert.equal(detectAdapter('https://apply.workable.com/domain-tools/j/40A8A850B2')?.id, 'workable')
  assert.equal(detectAdapter('https://aras.bamboohr.com/careers/382')?.id, 'bamboohr')
  assert.equal(detectAdapter('https://www.bamboohr.com/careers/application?gh_jid=6115974004')?.id, 'greenhouse')
  assert.equal(canonicalJobUrl('https://www.bamboohr.com/careers/application?gh_jid=6115974004'), 'https://job-boards.greenhouse.io/bamboohr17/jobs/6115974004')
  assert.equal(detectAdapter('https://metyisag.recruitee.com/o/ai-solutions-engineer/c/new')?.id, 'recruitee')
  assert.deepEqual(supportedBoards(), ['ashby', 'greenhouse', 'rippling', 'breezy', 'lever', 'workable', 'bamboohr', 'recruitee'])
})

test('detects supported Lever CAPTCHA challenge frames', () => {
  assert.match(leverSelectors.captchaChallenge, /hcaptcha\.com/)
  assert.match(leverSelectors.captchaChallenge, /recaptcha\/api2\/bframe/)
  assert.match(leverSelectors.captchaChallenge, /recaptcha\/enterprise\/bframe/)
})

test('uses Lever résumé parser completion signals', () => {
  assert.equal(leverSelectors.resumeParsing, '.resume-upload-working')
  assert.equal(leverSelectors.resumeSuccess, '.resume-upload-success')
  assert.equal(leverSelectors.resumeStorageId, 'input[name="resumeStorageId"]')
  assert.match(leverSelectors.resumeFilename, /filename/)
})

test('detects Workable Cloudflare Turnstile challenges', () => {
  assert.match(workableSelectors.captchaChallenge, /challenges\.cloudflare\.com/)
  assert.match(workableSelectors.captchaChallenge, /cf-turnstile/)
})
