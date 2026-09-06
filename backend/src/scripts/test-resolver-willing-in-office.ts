#!/usr/bin/env node
/**
 * Focused resolver test for willing_in_office classification and behavior
 */

import { normalizeQuestion, classifyQuestion } from '../resolver/normalizer.js'
import { nonInferableFields } from '../resolver/policy.js'
import { classifyAnswerMode } from '../automation/answers/answerPolicy.js'

console.log('=== RESOLVER WILLING_IN_OFFICE CLASSIFICATION TEST ===\n')

// Test 1: Eudia exact question
const eudiaQuestion = "Are you okay with working from the office location stated in this job posting 5 days a week?"
const eudiaNormalized = normalizeQuestion(eudiaQuestion)
const eudiaCanonical = classifyQuestion(eudiaNormalized)
console.log('Test 1: Eudia exact question')
console.log(`  Question: "${eudiaQuestion}"`)
console.log(`  Normalized: "${eudiaNormalized}"`)
console.log(`  Canonical: ${eudiaCanonical}`)
console.log(`  Expected: willing_in_office`)
console.log(`  Result: ${eudiaCanonical === 'willing_in_office' ? 'PASS' : 'FAIL'}\n`)

// Test 2: Onsite wording
const onsiteQuestion = "Are you comfortable working onsite?"
const onsiteCanonical = classifyQuestion(normalizeQuestion(onsiteQuestion))
console.log('Test 2: Onsite wording')
console.log(`  Question: "${onsiteQuestion}"`)
console.log(`  Canonical: ${onsiteCanonical}`)
console.log(`  Expected: willing_in_office`)
console.log(`  Result: ${onsiteCanonical === 'willing_in_office' ? 'PASS' : 'FAIL'}\n`)

// Test 3: Office 5 days wording
const office5DaysQuestion = "Are you willing to work onsite 5 days a week?"
const office5DaysCanonical = classifyQuestion(normalizeQuestion(office5DaysQuestion))
console.log('Test 3: Office 5 days wording')
console.log(`  Question: "${office5DaysQuestion}"`)
console.log(`  Canonical: ${office5DaysCanonical}`)
console.log(`  Expected: willing_in_office`)
console.log(`  Result: ${office5DaysCanonical === 'willing_in_office' ? 'PASS' : 'FAIL'}\n`)

// Test 4: Location question (should NOT be willing_in_office)
const locationQuestion = "What city do you live in?"
const locationCanonical = classifyQuestion(normalizeQuestion(locationQuestion))
console.log('Test 4: Location question (negative test)')
console.log(`  Question: "${locationQuestion}"`)
console.log(`  Canonical: ${locationCanonical}`)
console.log(`  Expected: NOT willing_in_office`)
console.log(`  Result: ${locationCanonical !== 'willing_in_office' ? 'PASS' : 'FAIL'}\n`)

// Test 5: Relocation question (should NOT be willing_in_office)
const relocateQuestion = "Are you willing to relocate?"
const relocateCanonical = classifyQuestion(normalizeQuestion(relocateQuestion))
console.log('Test 5: Relocation question (negative test)')
console.log(`  Question: "${relocateQuestion}"`)
console.log(`  Canonical: ${relocateCanonical}`)
console.log(`  Expected: NOT willing_in_office`)
console.log(`  Result: ${relocateCanonical !== 'willing_in_office' ? 'PASS' : 'FAIL'}\n`)

// Test 6: Policy check - willing_in_office must remain non-inferable
console.log('Test 6: Policy preservation')
console.log(`  willing_in_office in nonInferableFields: ${nonInferableFields.has('willing_in_office')}`)
console.log(`  Expected: YES`)
console.log(`  Result: ${nonInferableFields.has('willing_in_office') ? 'PASS' : 'FAIL'}\n`)

// Test 7: Answer mode for Eudia question
const eudiaAnswerMode = classifyAnswerMode(eudiaQuestion)
console.log('Test 7: Answer mode for Eudia question')
console.log(`  Question: "${eudiaQuestion}"`)
console.log(`  Answer mode: ${eudiaAnswerMode}`)
console.log(`  Expected: USER_REQUIRED (because willing_in_office is non-inferable)`)
console.log(`  Result: ${eudiaAnswerMode === 'USER_REQUIRED' ? 'PASS' : 'FAIL'}\n`)

// Summary
const allTests = [
  eudiaCanonical === 'willing_in_office',
  onsiteCanonical === 'willing_in_office',
  office5DaysCanonical === 'willing_in_office',
  locationCanonical !== 'willing_in_office',
  relocateCanonical !== 'willing_in_office',
  nonInferableFields.has('willing_in_office'),
  eudiaAnswerMode === 'USER_REQUIRED'
]

console.log('=== SUMMARY ===')
console.log(`Tests passed: ${allTests.filter(t => t).length}/${allTests.length}`)
console.log(`Overall: ${allTests.every(t => t) ? 'PASS' : 'FAIL'}`)

process.exit(allTests.every(t => t) ? 0 : 1)
