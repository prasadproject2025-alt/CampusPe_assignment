import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyQuestion, normalizeQuestion, questionSimilarity } from './normalizer.js'

test('normalizes common email variants', () => {
  assert.equal(normalizeQuestion('Please provide your E-mail address:'), 'your email')
  assert.equal(classifyQuestion(normalizeQuestion('Please provide your E-mail address:')), 'email')
})

test('classifies protected and explicit profile fields', () => {
  assert.equal(classifyQuestion(normalizeQuestion('What is your current CTC?')), 'current_salary')
  assert.equal(classifyQuestion(normalizeQuestion('What is your expected annual salary?')), 'expected_salary')
  assert.equal(classifyQuestion(normalizeQuestion('Will you require visa sponsorship?')), 'sponsorship')
  assert.equal(classifyQuestion(normalizeQuestion('Are you legally authorized to work in India?')), 'work_authorized')
  assert.equal(classifyQuestion(normalizeQuestion('What is your disability status?')), 'disability')
  assert.equal(classifyQuestion(normalizeQuestion('What pronouns would you like us to use?')), 'pronouns')
})

test('classifies visa-status wording inside a sponsorship question as sponsorship', () => {
  assert.equal(classifyQuestion(normalizeQuestion('Will you now or in the future require sponsorship for employment visa status to work in this location?')), 'sponsorship')
  assert.equal(classifyQuestion(normalizeQuestion('What is your current visa status?')), 'us_visa_type')
})

test('classifies Lever disability declaration name and date fields', () => {
  assert.equal(classifyQuestion(normalizeQuestion('Name')), 'full_name')
  assert.equal(classifyQuestion(normalizeQuestion('Date')), 'declaration_date')
})

test('scores equivalent questions above unrelated questions', () => {
  const first = normalizeQuestion('Are you authorized to work in India?')
  assert.ok(questionSimilarity(first, normalizeQuestion('Are you legally authorized to work in India?')) > questionSimilarity(first, normalizeQuestion('What is your expected salary?')))
})

test('normalizes equivalent willingness phrasing', () => {
  const first = normalizeQuestion('Are you willing to relocate for this role?')
  const second = normalizeQuestion('Would you be willing to relocate for the position?')
  assert.equal(first, second)
  assert.equal(questionSimilarity(first, second), 1)
})

test('classifies Ashby profile defaults', () => {
  assert.equal(classifyQuestion(normalizeQuestion('GitHub')), 'github_url')
  assert.equal(classifyQuestion(normalizeQuestion('Are you open to being in-office 5 days a week in Sunnyvale?')), 'willing_in_office')
  assert.equal(classifyQuestion(normalizeQuestion('How did you hear about us?')), 'referral_source')
  assert.equal(classifyQuestion(normalizeQuestion('How did you hear about this opportunity? (select all that apply)')), 'referral_source')
  assert.equal(classifyQuestion(normalizeQuestion('Degree Type')), 'degree_type')
  assert.equal(classifyQuestion(normalizeQuestion('Will you need sponsorship to work in the U.S. now or anytime in the future?')), 'us_sponsorship')
  assert.equal(classifyQuestion(normalizeQuestion('Do you currently have an active immigration case (ex H-1B extension, green card)?')), 'active_immigration_case')
  assert.equal(classifyQuestion(normalizeQuestion('Will you require sponsorship for employment visa status (e.g. H1B, OPT)?')), 'us_visa_type')
})

test('classifies split Greenhouse name fields', () => {
  assert.equal(classifyQuestion(normalizeQuestion('First Name')), 'first_name')
  assert.equal(classifyQuestion(normalizeQuestion('Last Name')), 'last_name')
})

test('classifies a Greenhouse phone-country control', () => {
  assert.equal(classifyQuestion(normalizeQuestion('Phone country code')), 'phone_country_code')
})

test('classifies the plain Greenhouse degree label', () => {
  assert.equal(classifyQuestion(normalizeQuestion('Degree')), 'degree_type')
})

test('classifies Greenhouse discipline as field of study', () => {
  assert.equal(classifyQuestion(normalizeQuestion('Discipline')), 'education_discipline')
  assert.equal(classifyQuestion(normalizeQuestion('Field of study')), 'education_discipline')
})

test('classifies Greenhouse website and experience range fields', () => {
  assert.equal(classifyQuestion(normalizeQuestion('Website')), 'portfolio_url')
  assert.equal(classifyQuestion(normalizeQuestion('How many years of professional backend software engineering experience do you have?')), 'total_experience_years')
})

test('classifies specialized skill experience for LLM estimation', () => {
  assert.equal(classifyQuestion(normalizeQuestion('How many years have you worked on distributed systems or data platforms?')), 'skill_experience_years')
})

test('classifies Greenhouse education identity and year fields', () => {
  assert.equal(classifyQuestion(normalizeQuestion('School')), 'education_school')
  assert.equal(classifyQuestion(normalizeQuestion('Start date year')), 'education_start_year')
  assert.equal(classifyQuestion(normalizeQuestion('End date year')), 'education_end_year')
})

test('classifies Breezy address as the saved profile location', () => {
  assert.equal(classifyQuestion(normalizeQuestion('Address')), 'location')
})

test('classifies BambooHR location controls and country confirmation', () => {
  assert.equal(classifyQuestion(normalizeQuestion('City')), 'current_city')
  assert.equal(classifyQuestion(normalizeQuestion('State')), 'current_state')
  assert.equal(classifyQuestion(normalizeQuestion('Country')), 'current_country')
  assert.equal(classifyQuestion(normalizeQuestion('ZIP')), 'postal_code')
  assert.equal(classifyQuestion(normalizeQuestion('Are you located in Poland?')), 'location_confirmation')
})
