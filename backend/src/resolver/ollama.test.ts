import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { matchVisibleOption } from './ollama.js'

test('returns the employer option exactly for a normalized AI choice', () => {
  assert.equal(
    matchVisibleOption('yes i consent to receiving text messages', [
      'Yes - I consent to receiving text messages',
      'No - I do not consent to receiving text messages',
    ]),
    'Yes - I consent to receiving text messages',
  )
})

test('prefers an exact pronoun option over a longer combined option', () => {
  assert.equal(matchVisibleOption('He/him/his', ['He/him/his', 'He/him/his, they/them/theirs']), 'He/him/his')
})

test('matches a short country code as a complete option token', () => {
  assert.equal(matchVisibleOption('IN', ['+91 IN - India', '+246 IO - British Indian Ocean Territory', '+98 IR - Iran']), '+91 IN - India')
})

test('rejects an AI choice that is not displayed by the employer', () => {
  assert.equal(matchVisibleOption('Maybe', ['Yes', 'No']), null)
})

test('Ollama prompt forbids invented personal and legal facts', () => {
  const source = readFileSync(new URL('./ollama.ts', import.meta.url), 'utf8')
  assert.match(source, /Never invent facts/)
  assert.match(source, /Analyze the resume first/)
  assert.match(source, /Resume: /)
  assert.match(source, /format: 'json'/)
  assert.match(source, /temperature: 0\.1/)
})

test('keeps written answers unchanged when there are no fixed options', () => {
  assert.equal(matchVisibleOption('I am excited about the role.', []), 'I am excited about the role.')
})

test('Ollama declines factual and choice answers before any network request', async () => {
  const { OllamaAnswerProvider } = await import('./ollama.js')
  const provider = new OllamaAnswerProvider()
  const fetchBefore = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('Unexpected model call') }
  try {
    for (const question of [
      { id: 'identity', text: 'Full name', fieldType: 'text' as const },
      { id: 'legal', text: 'Are you authorized to work in the United States?', fieldType: 'boolean' as const, options: ['Yes', 'No'] },
      { id: 'years', text: 'Years of experience', fieldType: 'text' as const },
    ]) {
      const answer = await provider.resolve({ question: { ...question, required: true }, normalizedQuestion: question.text.toLowerCase(), canonicalField: null, candidate: {} as never, job: {} })
      assert.equal(answer, null)
    }
    assert.equal(called, false)
  } finally { globalThis.fetch = fetchBefore }
})
