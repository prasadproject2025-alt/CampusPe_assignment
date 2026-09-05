import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyAnswerMode } from './answerPolicy.js'

test('sensitive and legal questions require explicit user input', () => {
  assert.equal(classifyAnswerMode('Will you require visa sponsorship?'), 'USER_REQUIRED')
  assert.equal(classifyAnswerMode('Are you authorized to work in the United States?'), 'USER_REQUIRED')
  assert.equal(classifyAnswerMode('Portfolio password'), 'USER_REQUIRED')
  assert.equal(classifyAnswerMode('Social Security Number'), 'USER_REQUIRED')
  assert.equal(classifyAnswerMode('Date of birth'), 'USER_REQUIRED')
})

test('identity and narrative questions are classified for the answer pipeline', () => {
  assert.equal(classifyAnswerMode('Full name'), 'PROFILE_FACT')
  assert.equal(classifyAnswerMode('Email'), 'PROFILE_FACT')
  assert.equal(classifyAnswerMode('Why do you want to work here?'), 'LLM_GENERATED')
  assert.equal(classifyAnswerMode('Tell us about a project you are proud of'), 'LLM_GENERATED')
})
