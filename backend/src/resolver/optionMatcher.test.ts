import assert from 'node:assert/strict'
import test from 'node:test'
import { matchNoticePeriodOption } from './optionMatcher.js'

const noticeOptions = [
  'No Notice Period (able to start new role as soon as possible)',
  '30 days (1 Month)',
  '45 days',
  '60 days (2 Months)',
  '90 days+ (3+ Months)',
]

test('maps saved notice periods to the employer exact option wording', () => {
  assert.equal(matchNoticePeriodOption('Immediately available', noticeOptions), noticeOptions[0])
  assert.equal(matchNoticePeriodOption('1 month', noticeOptions), noticeOptions[1])
  assert.equal(matchNoticePeriodOption('60 days', noticeOptions), noticeOptions[3])
})
