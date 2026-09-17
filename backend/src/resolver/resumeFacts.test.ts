import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeResumeFacts, type ResumeFacts } from './resumeFacts.js'
import type { CandidateContext } from './types.js'

function candidate(overrides: Partial<CandidateContext> = {}): CandidateContext {
  return {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '',
    phoneCountryCode: '',
    location: '',
    currentCity: '',
    currentState: '',
    currentCountry: '',
    linkedinUrl: '',
    githubUrl: '',
    portfolioUrl: '',
    experienceYears: '',
    noticePeriod: '',
    workAuthorized: '',
    sponsorship: '',
    currentSalary: '',
    expectedSalary: '',
    workArrangement: '',
    willingInOffice: '',
    willingRelocate: '',
    usWorkAuthorized: '',
    usSponsorship: '',
    usVisaType: '',
    activeImmigrationCase: '',
    referralSource: '',
    careerMotivation: '',
    coverLetterIntro: '',
    additionalInformation: '',
    experiences: [],
    education: [],
    demographics: { gender: 'prefer', orientation: 'prefer', ethnicity: 'prefer', disability: 'prefer', veteran: 'prefer' },
    allowDemographicSuggestions: false,
    ...overrides,
  }
}

function facts(overrides: Partial<ResumeFacts> = {}): ResumeFacts {
  return {
    phone: '',
    location: '',
    currentCity: '',
    currentState: '',
    currentCountry: '',
    linkedinUrl: '',
    githubUrl: '',
    portfolioUrl: '',
    experienceYears: '',
    currentCompany: '',
    summary: '',
    skills: [],
    workAuthorized: '',
    sponsorship: '',
    experiences: [],
    education: [],
    ...overrides,
  }
}

test('fills empty candidate fields from resume facts', () => {
  const merged = mergeResumeFacts(candidate(), facts({
    phone: '555-0100',
    currentCity: 'London',
    currentCountry: 'United Kingdom',
    linkedinUrl: 'https://linkedin.com/in/ada',
    experienceYears: '8',
    currentCompany: 'Analytical Engines',
    summary: 'Mathematician and computing pioneer.',
    skills: ['Mathematics', 'Programming'],
    education: [{ school: 'University of London', degree: "Bachelor's Degree" }],
  }), 'Ada Lovelace London')

  assert.equal(merged.phone, '555-0100')
  assert.equal(merged.currentCity, 'London')
  assert.equal(merged.location, 'London, United Kingdom')
  assert.equal(merged.linkedinUrl, 'https://linkedin.com/in/ada')
  assert.equal(merged.experienceYears, '8')
  assert.equal(merged.experiences[0]?.company, 'Analytical Engines')
  assert.equal(merged.education[0]?.school, 'University of London')
  assert.equal(merged.careerMotivation, 'Mathematician and computing pioneer.')
  assert.equal(merged.additionalInformation, 'Mathematics, Programming')
  assert.equal(merged.resumeText, 'Ada Lovelace London')
  assert.deepEqual(merged.skills, ['Mathematics', 'Programming'])
})

test('does not overwrite saved profile values', () => {
  const merged = mergeResumeFacts(candidate({
    phone: '111',
    location: 'Paris',
    currentCity: 'Paris',
    linkedinUrl: 'https://linkedin.com/in/saved',
    workAuthorized: 'Yes',
    experiences: [{ company: 'Saved Co', title: 'Engineer' }],
    education: [{ school: 'Saved University', degree: "Master's Degree" }],
  }), facts({
    phone: '999',
    location: 'Berlin',
    currentCity: 'Berlin',
    linkedinUrl: 'https://linkedin.com/in/resume',
    workAuthorized: 'No',
    currentCompany: 'Resume Co',
    experiences: [{ company: 'Resume Co' }],
    education: [{ school: 'Resume U' }],
  }))

  assert.equal(merged.phone, '111')
  assert.equal(merged.location, 'Paris')
  assert.equal(merged.currentCity, 'Paris')
  assert.equal(merged.linkedinUrl, 'https://linkedin.com/in/saved')
  assert.equal(merged.workAuthorized, 'Yes')
  assert.equal(merged.experiences[0]?.company, 'Saved Co')
  assert.equal(merged.education[0]?.school, 'Saved University')
})

test('does not invent legal or sponsorship answers when the resume omitted them', () => {
  const merged = mergeResumeFacts(candidate(), facts({ phone: '555-0100', currentCity: 'Austin' }))
  assert.equal(merged.workAuthorized, '')
  assert.equal(merged.sponsorship, '')
  assert.equal(merged.usWorkAuthorized, '')
  assert.equal(merged.usSponsorship, '')
  assert.equal(merged.currentSalary, '')
  assert.equal(merged.expectedSalary, '')
})
