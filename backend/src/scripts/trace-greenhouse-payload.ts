#!/usr/bin/env node
/**
 * GREENHOUSE PAYLOAD TRACE - NO SUBMISSION
 * 
 * Traces the READY_FOR_REVIEW data through the submission pipeline
 * to show how canonical answers map to Greenhouse question IDs.
 * Does NOT submit the application.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, copyFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../database.js'
import { automationManager } from '../automation/manager.js'
import { detectAdapter } from '../automation/registry.js'
import type { ApplicationField, ApplicationModel } from '../automation/application/types.js'

function parseApplicationFromRow(row: { application_json?: string | null }): ApplicationModel | null {
  if (!row.application_json) return null
  try { return JSON.parse(row.application_json) as ApplicationModel } catch { return null }
}

const config = {
  jobUrl: process.env.TEST_GREENHOUSE_JOB_URL,
  candidateName: process.env.TEST_CANDIDATE_NAME,
  candidateEmail: process.env.TEST_CANDIDATE_EMAIL,
  resumePath: process.env.TEST_CANDIDATE_RESUME_PATH,
  phone: process.env.TEST_CANDIDATE_PHONE,
  linkedinUrl: process.env.TEST_CANDIDATE_LINKEDIN_URL,
  location: process.env.TEST_CANDIDATE_LOCATION,
}

if (!config.jobUrl || !config.candidateName || !config.candidateEmail || !config.resumePath) {
  console.error('TEST_GREENHOUSE_JOB_URL, TEST_CANDIDATE_NAME, TEST_CANDIDATE_EMAIL, and TEST_CANDIDATE_RESUME_PATH environment variables are required')
  process.exit(1)
}

if (!existsSync(config.resumePath)) {
  console.error(`Resume file does not exist: ${config.resumePath}`)
  process.exit(1)
}

let tempUserId: string | null = null
let runId: string | null = null

function createTestUser(): string {
  const userId = randomUUID()
  const now = new Date().toISOString()
  const uniqueEmail = `greenhouse-payload-${userId}@campuspe.local`

  db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, uniqueEmail, config.candidateName!, 'test_hash', 'test_salt', now)

  const insertSQL = `INSERT INTO profiles (user_id,updated_at,phone,phone_country_code,location,current_city,current_state,current_country,linkedin_url,github_url,portfolio_url,experience_years,notice_period,work_authorized,sponsorship,current_salary,expected_salary,work_arrangement,willing_in_office,willing_relocate,us_work_authorized,us_sponsorship,us_visa_type,active_immigration_case,referral_source,career_motivation,cover_letter_intro,additional_information,experiences_json,education_json,demographics_encrypted,allow_demographic_suggestions,resume_filename,resume_storage_name,resume_mime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  
  const values = [
    userId, now,
    config.phone || '555-123-4567',
    '',
    config.location || 'San Francisco, CA',
    (config.location || 'San Francisco, CA').split(',')[0]?.trim() || 'San Francisco',
    'CA',
    'United States',
    config.linkedinUrl || 'https://linkedin.com/in/test',
    '',
    '',
    '2-3',
    '2 weeks',
    'Yes',
    'No',
    '',
    '',
    '',
    '',
    '',  // work_arrangement
    '',  // willing_in_office (empty to force L3)
    '',
    '',
    '',
    'LinkedIn',
    'I am interested in this role because it aligns with my career goals in software engineering.',
    '',
    '',
    JSON.stringify([{
      id: 1,
      title: 'Software Engineer',
      company: 'Test Company',
      employmentType: 'Full-time',
      location: 'San Francisco, CA',
      startDate: '2022-01-01',
      endDate: '2024-01-01',
      current: false,
      description: 'Built web applications using modern technologies including React and Node.js.'
    }]),
    JSON.stringify([{
      id: 1,
      school: 'Test University',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
      startDate: '2018-09-01',
      endDate: '2022-05-01',
      current: false,
      description: 'Focused on software engineering, algorithms, and data structures.'
    }]),
    '',  // demographics_encrypted
    0,   // allow_demographic_suggestions
    '',  // resume_filename
    '',  // resume_storage_name
    ''   // resume_mime
  ]
  
  db.prepare(insertSQL).run(...values)

  const uploadDir = resolve(process.cwd(), 'uploads')
  const resumeExt = config.resumePath!.toLowerCase().endsWith('.pdf') ? '.pdf' :
                    config.resumePath!.toLowerCase().endsWith('.docx') ? '.docx' : '.doc'
  const storageName = `${userId}${resumeExt}`
  const destPath = resolve(uploadDir, storageName)
  copyFileSync(config.resumePath!, destPath)

  const resumeMime = resumeExt === '.pdf' ? 'application/pdf' :
                     resumeExt === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword'
  db.prepare('UPDATE profiles SET resume_filename=?, resume_storage_name=?, resume_mime=?, updated_at=? WHERE user_id=?')
    .run('test-resume.pdf', storageName, resumeMime, now, userId)

  tempUserId = userId

  console.log(`Created test user: ${userId}`)
  console.log(`Resume copied to: ${destPath}`)

  return userId
}

function cleanup() {
  console.log('Starting cleanup...')

  if (runId && tempUserId) {
    db.prepare('DELETE FROM automation_events WHERE run_id IN (SELECT id FROM automation_runs WHERE user_id=?)').run(tempUserId)
    db.prepare('DELETE FROM automation_runs WHERE user_id=?').run(tempUserId)
    console.log('Deleted automation runs')

    db.prepare('DELETE FROM sessions WHERE user_id=?').run(tempUserId)
    console.log('Deleted sessions')

    db.prepare('DELETE FROM profiles WHERE user_id=?').run(tempUserId)
    console.log('Deleted profile')

    db.prepare('DELETE FROM users WHERE id=?').run(tempUserId)
    console.log('Deleted user')
  }

  console.log('Cleanup complete')
}

async function main() {
  console.log('GREENHOUSE PAYLOAD TRACE - NO SUBMISSION')
  console.log('=====================================\n')

  const userId = createTestUser()
  console.log('Creating automation run...')

  const created = automationManager.create(userId, config.jobUrl!, false, true) // autoSubmit=false, testMode=true
  if (!created) {
    console.error('Failed to create automation run')
    process.exit(1)
  }

  runId = created.id
  console.log(`Automation run created: ${runId}`)
  console.log(`Strategy: ${created.strategy}`)
  console.log(`Test mode: ${created.testMode}`)
  console.log(`Auto submit: ${created.autoSubmit}`)

  // Wait for READY_FOR_REVIEW
  console.log('\nWaiting for READY_FOR_REVIEW state...')
  const startTime = Date.now()
  const timeoutMs = 180000
  
  while (Date.now() - startTime < timeoutMs) {
    const run = automationManager.get(userId, runId)
    if (!run) {
      console.error(`Run not found: ${runId}`)
      cleanup()
      process.exit(1)
    }
    if (run.status === 'READY_FOR_REVIEW' || run.status === 'PAUSED_NEEDS_INPUT' || run.status === 'FAILED') {
      break
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  const finalRun = automationManager.get(userId, runId)
  if (!finalRun) {
    console.error('Final run not found')
    cleanup()
    process.exit(1)
  }
  console.log(`\nFinal status: ${finalRun.status}`)

  if (finalRun.status !== 'READY_FOR_REVIEW') {
    console.error(`Failed to reach READY_FOR_REVIEW. Status: ${finalRun.status}`)
    cleanup()
    process.exit(1)
  }

  // Parse the application from the database
  console.log('\n' + '='.repeat(80))
  console.log('APPLICATION PAYLOAD TRACE')
  console.log('='.repeat(80))

  const row = db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId) as { application_json?: string | null } | null
  if (!row) {
    console.error('Run not found in database')
    cleanup()
    process.exit(1)
  }
  const application = parseApplicationFromRow(row)
  if (!application) {
    console.error('Failed to parse application from database')
    cleanup()
    process.exit(1)
  }

  console.log(`\nTotal fields: ${application.fields.length}`)
  console.log(`Filled fields: ${application.fields.filter(f => f.value.trim()).length}`)
  console.log(`Required fields: ${application.fields.filter(f => f.required).length}`)

  // Find the office and relocation questions
  console.log('\n' + '-'.repeat(80))
  console.log('OFFICE AND RELOCATION QUESTIONS')
  console.log('-'.repeat(80))

  const officeQuestion = application.fields.find(f => 
    f.id.includes('willing_in_office') || 
    f.text.toLowerCase().includes('office') ||
    f.text.toLowerCase().includes('working from')
  )

  const relocateQuestion = application.fields.find(f => 
    f.id.includes('willing_relocate') || 
    f.text.toLowerCase().includes('relocate')
  )

  if (officeQuestion) {
    console.log('\nOFFICE QUESTION:')
    console.log(`  ID: ${officeQuestion.id}`)
    console.log(`  Text: ${officeQuestion.text}`)
    console.log(`  Value: "${officeQuestion.value}"`)
    console.log(`  FieldType: ${officeQuestion.fieldType}`)
    console.log(`  Options: ${JSON.stringify(officeQuestion.options)}`)
    console.log(`  Required: ${officeQuestion.required}`)
    console.log(`  Locator: ${JSON.stringify(officeQuestion.locator)}`)
  }

  if (relocateQuestion) {
    console.log('\nRELOCATION QUESTION:')
    console.log(`  ID: ${relocateQuestion.id}`)
    console.log(`  Text: ${relocateQuestion.text}`)
    console.log(`  Value: "${relocateQuestion.value}"`)
    console.log(`  FieldType: ${relocateQuestion.fieldType}`)
    console.log(`  Options: ${JSON.stringify(relocateQuestion.options)}`)
    console.log(`  Required: ${relocateQuestion.required}`)
    console.log(`  Locator: ${JSON.stringify(relocateQuestion.locator)}`)
  }

  // Show all field IDs for mapping trace
  console.log('\n' + '-'.repeat(80))
  console.log('ALL FIELD IDs (for ATS mapping trace)')
  console.log('-'.repeat(80))
  
  application.fields.forEach(field => {
    const hasValue = field.value.trim() ? '✓' : '✗'
    const isRequired = field.required ? 'REQ' : 'OPT'
    console.log(`  [${hasValue}] [${isRequired}] ${field.id}`)
  })

  // Show submission architecture trace
  console.log('\n' + '='.repeat(80))
  console.log('SUBMISSION ARCHITECTURE TRACE')
  console.log('='.repeat(80))

  const adapter = detectAdapter(config.jobUrl!)
  console.log(`\nAdapter: ${adapter?.id || 'NONE'}`)
  console.log(`Strategy: ${finalRun.strategy || 'UNKNOWN'}`)
  console.log(`Can programmatically submit: ${finalRun.strategy === 'CUSTOM_FORM' ? 'YES' : 'NO'}`)

  console.log('\nSUBMISSION FLOW:')
  console.log('  1. User calls automationManager.submit(userId, runId)')
  console.log('  2. Manager checks: test_mode=NO, status=READY_FOR_REVIEW, adapter available')
  console.log('  3. Manager calls canProgrammaticallySubmit(strategy)')
  console.log('  4. Manager calls submitApplicationWithServerBrowser(jobUrl, userId, fields)')
  console.log('  5. launchHeadlessAutomationBrowser() creates disposable windowless browser')
  console.log('  6. adapter.openApplication(page, jobUrl) - opens Greenhouse form')
  console.log('  7. adapter.waitForApplication(page) - waits for form to load')
  console.log('  8. runReviewedSubmission() calls:')
  console.log('     a. fillReviewedApplicationOnPage()')
  console.log('     b. applyStoredAnswers() - maps canonical fields to DOM controls')
  console.log('     c. adapter.fillAnswer() - fills each field via Playwright')
  console.log('     d. adapter.submitApplication() - clicks submit button')
  console.log('     e. waitForAtsConfirmation() - waits for ATS confirmation')
  console.log('  9. Browser closed')
  console.log(' 10. Status updated to SUBMITTED if confirmation detected')

  console.log('\nFIELD MAPPING:')
  console.log('  - ApplicationField.id → Greenhouse DOM locator')
  console.log('  - ApplicationField.value → Playwright fill()')
  console.log('  - Radio/select → adapter selects option matching value')
  console.log('  - Resume → adapter.uploadResume() via setInputFiles()')

  console.log('\n' + '='.repeat(80))
  console.log('NO SUBMISSION EXECUTED')
  console.log('='.repeat(80))

  cleanup()
  console.log('\n✓ Payload trace complete')
}

main().catch(error => {
  console.error('Fatal error:', error)
  cleanup()
  process.exit(1)
})
