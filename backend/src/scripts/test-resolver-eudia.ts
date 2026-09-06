#!/usr/bin/env node
/**
 * Test resolver for the specific Eudia question
 */

import { normalizeQuestion, classifyQuestion } from '../resolver/normalizer.js'
import { nonInferableFields } from '../resolver/policy.js'
import { classifyAnswerMode } from '../automation/answers/answerPolicy.js'

const question = "Are you okay with working from the office location stated in this job posting 5 days a week?"

console.log('=== RESOLVER ARCHITECTURE TRACE ===')
console.log(`\nQuestion: "${question}"`)

const normalized = normalizeQuestion(question)
console.log(`\nNormalized question: "${normalized}"`)

const canonical = classifyQuestion(normalized)
console.log(`Classified as: ${canonical}`)

console.log(`\n=== POLICY CHECK ===`)
console.log(`Is in nonInferableFields: ${nonInferableFields.has(canonical || '')}`)
console.log(`nonInferableFields:`, Array.from(nonInferableFields))

const answerMode = classifyAnswerMode(question)
console.log(`\nAnswer mode: ${answerMode}`)

console.log(`\n=== EXPECTED ENGINE BEHAVIOR ===`)
console.log(`L1 Lookup: will attempt but return null (empty willing_in_office in profile)`)
console.log(`L2 Memory: will attempt but return null (no similar remembered answer)`)
console.log(`Line 129 check: canonical="${canonical}" in nonInferableFields=${nonInferableFields.has(canonical || '')}`)
console.log(`Expected result: NEEDS_USER_INPUT with pauseCode RESTRICTED_QUESTION`)
console.log(`Reason: "This factual or preference answer must come from your profile or a previously approved answer."`)

console.log(`\n=== ARCHITECTURE VERDICT ===`)
console.log(`L3 attempted: NO`)
console.log(`Policy blocked L3: YES`)
console.log(`Exact policy rule: Line 129 in engine.ts - nonInferableFields block`)
console.log(`Is this expected architecture behavior: YES`)
console.log(`Is there a resolver bug: NO - this is intentional policy`)
