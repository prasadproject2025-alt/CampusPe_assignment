import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { db } from '../../database.js'
import { getBrowserLaunchCount, resetBrowserLaunchCount, setBrowserLauncherForTests } from '../browserLauncher.js'
import { automationManager } from '../manager.js'
import { ASHBY_GRAPHQL_URL } from './ashbyForm.js'

const ashbyUrl = 'https://jobs.ashbyhq.com/notion/d177d052-ef57-4900-acf2-d58e9eded620/application'
const greenhouseUrl = 'https://job-boards.greenhouse.io/airtable/jobs/8403127002'
const leverUrl = 'https://jobs.lever.co/jumpcloud/4ebbdea9-39c2-465d-bbdf-bf379a8e4a06/apply'

const ashbyFixture = {
  data: {
    jobPosting: {
      id: 'd177d052-ef57-4900-acf2-d58e9eded620',
      title: 'Brand Designer, Creative Studio',
      locationName: 'Remote',
      applicationForm: {
        sections: [
          {
            fieldEntries: [
              { isRequired: true, field: { path: '_systemfield_name', title: 'Full Name', type: 'String' } },
              { isRequired: true, field: { path: '_systemfield_email', title: 'Email', type: 'Email' } },
              { isRequired: true, field: { path: '7a1e4d9a-2a48-40e5-8aa5-4a29b9909101', title: 'Portfolio Link', type: 'String' } },
              { isRequired: true, field: { path: '_systemfield_resume', title: 'Resume', type: 'File' } },
            ],
          },
          {
            fieldEntries: [
              { isRequired: false, field: { path: '0b3b7773-f6d9-4032-9ab1-368c4164e95a', title: 'How did you hear about this opportunity? (select all that apply)', type: 'MultiValueSelect', selectableValues: [{ label: 'LinkedIn' }, { label: 'Glassdoor' }, { label: 'Notion Blog' }] } },
            ],
          },
        ],
      },
      surveyForms: [
        {
          sections: [
            { fieldEntries: [{ isRequired: false, field: { path: '_systemfield_eeoc_gender', title: 'Gender', type: 'ValueSelect', selectableValues: [{ label: 'Male' }, { label: 'Female' }] } }] },
          ],
        },
      ],
    },
  },
}

const greenhouseFixture = {
  id: 8403127002,
  title: 'Software Engineer',
  company_name: 'Airtable',
  location: { name: 'Remote' },
  questions: [
    { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text', values: [] }] },
    { label: 'Email', required: true, fields: [{ name: 'email', type: 'input_text', values: [] }] },
    { label: 'Resume', required: true, fields: [{ name: 'resume', type: 'input_file', values: [] }] },
  ],
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function waitForSettled(userId: string, runId: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const run = automationManager.get(userId, runId)
    if (run && !['QUEUED', 'OPENING_JOB', 'EXTRACTING_JOB', 'FILLING_APPLICATION'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return automationManager.get(userId, runId)
}

function createUser() {
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)').run(id, `runtime-${id}@jobcopilot.test`, 'Ada Lovelace', 'x', 'x', now)
  db.prepare('INSERT INTO profiles (user_id, updated_at, phone, linkedin_url, portfolio_url) VALUES (?,?,?,?,?)').run(id, now, '555-0100', 'https://linkedin.com/in/ada', 'https://ada.dev')
  return id
}

test('CUSTOM_FORM Ashby start launches zero browsers and returns a React form schema', async (t) => {
  const originalFetch = globalThis.fetch
  const userId = createUser()
  resetBrowserLaunchCount()
  setBrowserLauncherForTests(async () => {
    throw new Error('Playwright launched during CUSTOM_FORM')
  })
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === ASHBY_GRAPHQL_URL) return jsonResponse(ashbyFixture)
    throw new Error(`Unexpected fetch during Ashby CUSTOM_FORM: ${url}`)
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = originalFetch
    setBrowserLauncherForTests(null)
    resetBrowserLaunchCount()
    db.prepare('DELETE FROM users WHERE id=?').run(userId)
  })

  const created = automationManager.create(userId, ashbyUrl, false, true)
  assert.equal(created?.strategy, 'CUSTOM_FORM')
  const run = await waitForSettled(userId, created!.id)
  assert.equal(getBrowserLaunchCount(), 0)
  assert.equal(run?.strategy, 'CUSTOM_FORM')
  assert.equal(run?.application?.displayMode, 'native_form')
  assert.ok((run?.application?.fields.length || 0) >= 6)
  assert.ok(run?.application?.fields.some((field) => /how did you hear/i.test(field.text)))
  assert.ok(run?.application?.fields.some((field) => field.path === '_systemfield_eeoc_gender'), 'survey fields after referral must be present')
  assert.equal(run?.application?.fields.find((field) => /how did you hear/i.test(field.text))?.inputType, 'checkbox-group')
  assert.equal(getBrowserLaunchCount(), 0)
  const filled = run?.application?.fields.find((field) => field.path === '_systemfield_name' || field.path === '_systemfield_email')
  assert.ok(filled?.value, 'AI/profile suggestion should populate a React field')
  assert.notEqual(run?.status, 'FAILED')
})

test('CUSTOM_FORM Greenhouse start launches zero browsers and returns a React form schema', async (t) => {
  const originalFetch = globalThis.fetch
  const userId = createUser()
  resetBrowserLaunchCount()
  setBrowserLauncherForTests(async () => {
    throw new Error('Playwright launched during CUSTOM_FORM')
  })
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('https://boards-api.greenhouse.io/v1/boards/airtable/jobs/8403127002')) return jsonResponse(greenhouseFixture)
    throw new Error(`Unexpected fetch during Greenhouse CUSTOM_FORM: ${url}`)
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = originalFetch
    setBrowserLauncherForTests(null)
    resetBrowserLaunchCount()
    db.prepare('DELETE FROM users WHERE id=?').run(userId)
  })

  const created = automationManager.create(userId, greenhouseUrl, false, true)
  assert.equal(created?.strategy, 'CUSTOM_FORM')
  const run = await waitForSettled(userId, created!.id)
  assert.equal(getBrowserLaunchCount(), 0)
  assert.equal(run?.strategy, 'CUSTOM_FORM')
  assert.ok(run?.application?.fields.some((field) => field.path === 'first_name'))
  assert.ok(run?.application?.fields.find((field) => field.path === 'first_name')?.value)
  assert.notEqual(run?.status, 'FAILED')
})

test('NATIVE_FORM Start never launches Playwright for Ashby or Greenhouse; Lever extract uses a permitted worker', async (t) => {
  const userId = createUser()
  resetBrowserLaunchCount()
  setBrowserLauncherForTests(async () => {
    throw new Error('stubbed browser launch')
  })
  t.after(() => {
    setBrowserLauncherForTests(null)
    resetBrowserLaunchCount()
    db.prepare('DELETE FROM users WHERE id=?').run(userId)
  })

  const created = automationManager.create(userId, leverUrl, false, true)
  assert.equal(created?.strategy, 'CUSTOM_FORM')
  const run = await waitForSettled(userId, created!.id)
  assert.equal(getBrowserLaunchCount(), 1)
  assert.notEqual(run?.application?.displayMode, 'browser_assisted')
  assert.equal(run?.status, 'FAILED')
})
