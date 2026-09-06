#!/usr/bin/env node
/**
 * CONTROLLED MULTI-PROVIDER REAL SUBMISSION
 *
 * This script performs AUTHORIZED real employer submissions to multiple ATS providers.
 * Requires CONFIRM_REAL_SUBMISSION=YES environment variable.
 *
 * Authorized candidate:
 * - Name: Ankita Lokhande
 * - Email: 2023.ankital@isu.ac.in
 * - Phone: +91 7678085840
 * - Location: Mumbai, India
 * - Resume: resume_for_me.pdf
 *
 * Providers to test:
 * - Workable: https://apply.workable.com/huggingface/j/002470F128/apply/
 * - Breezy: https://shopritex.breezy.hr/p/0cd2475842bb-software-engineer-i/apply
 * - Recruitee: https://metyisag.recruitee.com/o/ai-solutions-engineer/c/new
 * - Rippling: https://ats.rippling.com/rippling/jobs/3f7826f8-cd91-4086-9425-6399600c733f
 */

import { randomUUID } from 'node:crypto'
import { existsSync, copyFileSync, unlinkSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AutomationStatus } from '../src/automation/types.js'
import { db } from '../src/database.ts'
import { automationManager } from '../src/automation/manager.ts'
import { assistedSessionExists, cancelAssistedSession } from '../src/automation/application/assistedSession.ts'
import { validateApplicationForRealSubmission } from '../src/automation/application/submissionValidator.ts'
import { uploadDir } from '../src/config.ts'

// Configuration from environment - NO FALLBACKS
const config = {
  candidateName: process.env.TEST_CANDIDATE_NAME,
  candidateEmail: process.env.TEST_CANDIDATE_EMAIL,
  resumePath: process.env.TEST_CANDIDATE_RESUME_PATH,
  phone: process.env.TEST_CANDIDATE_PHONE,
  linkedinUrl: process.env.TEST_CANDIDATE_LINKEDIN_URL,
  location: process.env.TEST_CANDIDATE_LOCATION,
  confirmSubmission: process.env.CONFIRM_REAL_SUBMISSION,
}

const PROVIDERS = [
  {
    name: 'Workable',
    jobUrl: 'https://apply.workable.com/huggingface/j/002470F128/apply/',
  },
  {
    name: 'Breezy',
    jobUrl: 'https://shopritex.breezy.hr/p/0cd2475842bb-software-engineer-i/apply',
  },
  {
    name: 'Recruitee',
    jobUrl: 'https://metyisag.recruitee.com/o/ai-solutions-engineer/c/new',
  },
  {
    name: 'Rippling',
    jobUrl: 'https://ats.rippling.com/rippling/jobs/3f7826f8-cd91-4086-9425-6399600c733f',
  },
]

let tempUserId: string | null = null
let tempResumeStorageName: string | null = null
let runId: string | null = null

const results: Array<{
  provider: string
  jobUrl: string
  status: string
  reason?: string
  fields?: number
  required?: number
  captcha?: string
  confirmation?: string
  dbStatus?: string
  submittedAt?: string
}> = []

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function error(message: string) {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`)
}

function validateConfig() {
  if (!config.candidateName) {
    error('TEST_CANDIDATE_NAME environment variable is required')
    process.exit(1)
  }
  if (!config.candidateEmail) {
    error('TEST_CANDIDATE_EMAIL environment variable is required')
    process.exit(1)
  }
  if (!config.phone) {
    error('TEST_CANDIDATE_PHONE environment variable is required')
    process.exit(1)
  }
  if (!config.location) {
    error('TEST_CANDIDATE_LOCATION environment variable is required')
    process.exit(1)
  }
  if (!config.resumePath) {
    error('TEST_CANDIDATE_RESUME_PATH environment variable is required')
    process.exit(1)
  }

  if (!existsSync(config.resumePath)) {
    error(`Resume file does not exist: ${config.resumePath}`)
    process.exit(1)
  }

  const resumeStats = statSync(config.resumePath)
  if (resumeStats.size === 0) {
    error(`Resume file is empty: ${config.resumePath}`)
    process.exit(1)
  }

  if (config.confirmSubmission !== 'YES') {
    error('CONFIRM_REAL_SUBMISSION=YES environment variable is required for real submission')
    process.exit(1)
  }

  log('Configuration validated successfully')
}

function createTestUser(): string {
  const now = new Date().toISOString()

  // Check if user with this email already exists
  const existingUser = db.prepare('SELECT id, email, name FROM users WHERE email=?').get(config.candidateEmail) as { id: string; email: string; name: string } | undefined

  let userId: string
  if (existingUser) {
    userId = existingUser.id
    log(`Using existing user: ${userId} (${existingUser.email})`)

    // Update name if different
    if (existingUser.name !== config.candidateName) {
      db.prepare('UPDATE users SET name=? WHERE id=?').run(config.candidateName!, userId)
      log(`Updated user name to: ${config.candidateName}`)
    }
  } else {
    userId = randomUUID()
    db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)')
      .run(userId, config.candidateEmail!, config.candidateName!, 'test_hash', 'test_salt', now)
    log(`Created new user: ${userId}`)
  }

  // Parse location
  const locationParts = (config.location || '').split(',').map(p => p.trim())
  const locationCity = locationParts[0] || ''
  const locationState = locationParts[1] || ''
  const locationCountry = locationParts[2] || ''

  // Parse phone
  const phoneCountryCode = config.phone?.startsWith('+') ? config.phone.substring(0, 3) : ''
  const nationalPhone = config.phone?.substring(config.phone.startsWith('+') ? 3 : 0) || ''

  // Check if profile exists
  const existingProfile = db.prepare('SELECT user_id FROM profiles WHERE user_id=?').get(userId) as { user_id: string } | undefined

  if (existingProfile) {
    log(`Updating existing profile for user: ${userId}`)
    db.prepare(`UPDATE profiles SET updated_at=?, phone=?, phone_country_code=?, location=?, current_city=?, current_state=?, current_country=?, linkedin_url=?, experiences_json=?, education_json=? WHERE user_id=?`)
      .run(now,
        config.phone,
        phoneCountryCode,
        config.location,
        locationCity,
        locationState,
        locationCountry,
        config.linkedinUrl || '',
        JSON.stringify([]),
        JSON.stringify([]),
        userId)
  } else {
    log(`Creating new profile for user: ${userId}`)
    db.prepare(`INSERT INTO profiles (user_id,updated_at,phone,phone_country_code,location,current_city,current_state,current_country,linkedin_url,github_url,portfolio_url,experience_years,notice_period,work_authorized,sponsorship,current_salary,expected_salary,work_arrangement,willing_in_office,willing_relocate,us_work_authorized,us_sponsorship,us_visa_type,active_immigration_case,referral_source,career_motivation,cover_letter_intro,additional_information,experiences_json,education_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(userId, now,
        config.phone,
        phoneCountryCode,
        config.location,
        locationCity,
        locationState,
        locationCountry,
        config.linkedinUrl || null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        JSON.stringify([]),
        JSON.stringify([]))
  }

  const resumeExt = config.resumePath!.toLowerCase().endsWith('.pdf') ? '.pdf' :
                    config.resumePath!.toLowerCase().endsWith('.docx') ? '.docx' : '.doc'
  const storageName = `${userId}${resumeExt}`
  const destPath = resolve(uploadDir, storageName)

  copyFileSync(config.resumePath!, destPath)

  const resumeMime = resumeExt === '.pdf' ? 'application/pdf' :
                     resumeExt === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword'
  db.prepare('UPDATE profiles SET resume_filename=?, resume_storage_name=?, resume_mime=?, updated_at=? WHERE user_id=?')
    .run(config.resumePath!.split('/').pop() || 'resume.pdf', storageName, resumeMime, now, userId)

  tempUserId = userId
  tempResumeStorageName = storageName

  log(`Candidate email: ${config.candidateEmail}`)
  log(`Resume copied to: ${destPath}`)

  return userId
}

function cleanup() {
  log('Starting cleanup...')

  if (runId && tempUserId) {
    if (assistedSessionExists(runId)) {
      try {
        cancelAssistedSession(tempUserId, runId)
        log('Cancelled assisted session')
      } catch (e) {
        error(`Failed to cancel assisted session: ${e}`)
      }
    }
  }

  // Do NOT delete the user or profile - keep for verification
  log('User and profile preserved for verification')

  if (tempResumeStorageName) {
    const resumePath = resolve(uploadDir, tempResumeStorageName)
    if (existsSync(resumePath)) {
      try {
        unlinkSync(resumePath)
        log(`Deleted resume: ${resumePath}`)
      } catch (e) {
        error(`Failed to delete resume: ${e}`)
      }
    }
  }

  log('Cleanup complete')
}

async function waitForSubmission(userId: string, runId: string, timeoutMs = 300000): Promise<any> {
  const startTime = Date.now()
  const finalStates: AutomationStatus[] = ['SUBMITTED', 'FAILED', 'PAUSED_CAPTCHA', 'PAUSED_NEEDS_INPUT']
  let lastStatus = 'UNKNOWN'
  let returned = false

  while (Date.now() - startTime < timeoutMs) {
    const run = automationManager.get(userId, runId)
    if (!run) {
      error(`Run not found: ${runId}`)
      return null
    }

    if (run.status !== lastStatus) {
      log(`Status transition: ${lastStatus} → ${run.status}`)
      lastStatus = run.status
    }

    if (finalStates.includes(run.status)) {
      log(`Settled in state: ${run.status}`)
      returned = true
      return run
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  if (!returned) {
    error(`Timeout waiting for settled state (last status: ${lastStatus})`)
  }
  return automationManager.get(userId, runId)
}

async function testProvider(provider: typeof PROVIDERS[0], userId: string) {
  log(`=== TESTING ${provider.name.toUpperCase()} ===`)
  log(`Job URL: ${provider.jobUrl}`)
  
  // Check if URL is live
  try {
    const response = await fetch(provider.jobUrl, { method: 'HEAD' })
    if (!response.ok) {
      log(`WARNING: Job URL returned ${response.status} - may not be live`)
    } else {
      log('Job URL appears live')
    }
  } catch (e) {
    log(`WARNING: Could not verify job URL liveness: ${e}`)
  }
  
  log('Creating automation run...')

  // Create run with testMode=false, autoSubmit=true for REAL submission
  const created = automationManager.create(userId, provider.jobUrl, true, false) // autoSubmit=true, testMode=false
  if (!created) {
    error('Failed to create automation run')
    return {
      provider: provider.name,
      jobUrl: provider.jobUrl,
      status: 'FAILED',
      reason: 'Failed to create automation run',
    }
  }

  runId = created.id
  log(`Automation run created: ${runId}`)
  log(`Strategy: ${created.strategy}`)
  log(`Test mode: ${created.testMode}`)
  log(`Auto submit: ${created.autoSubmit}`)

  // Wait for either READY_FOR_REVIEW or a final state
  log('Waiting for READY_FOR_REVIEW or final state...')
  const readyRun = await waitForSubmission(userId, runId, 180000)

  if (!readyRun) {
    error('Run failed to reach settled state')
    return {
      provider: provider.name,
      jobUrl: provider.jobUrl,
      status: 'FAILED',
      reason: 'Run failed to reach settled state',
    }
  }

  // If already in a final state (SUBMITTED, FAILED, PAUSED_CAPTCHA), skip validation
  if (['SUBMITTED', 'FAILED', 'PAUSED_CAPTCHA'].includes(readyRun.status)) {
    log(`Run reached final state directly: ${readyRun.status}`)
    log('Skipping pre-submission validation (already in final state)')

    const finalApp = db.prepare('SELECT application_json, status, current_step, error_message, created_at, updated_at FROM automation_runs WHERE id=?').get(runId) as any
    let application = null
    if (finalApp?.application_json) {
      try {
        application = JSON.parse(finalApp.application_json)
      } catch (e) {
        log('Failed to parse application data')
      }
    }

    const result = {
      provider: provider.name,
      jobUrl: provider.jobUrl,
      status: readyRun.status === 'SUBMITTED' ? 'REAL_SUBMISSION_VERIFIED' : 
             readyRun.status === 'PAUSED_CAPTCHA' ? 'CAPTCHA_BLOCKED' : 'FAILED',
      reason: readyRun.status === 'SUBMITTED' ? 'ATS confirmation detected' :
              readyRun.status === 'PAUSED_CAPTCHA' ? 'CAPTCHA detected' : finalApp?.error_message || 'Submission failed',
      fields: application?.fields?.length,
      required: application?.fields?.filter((f: any) => f.required).length,
      captcha: readyRun.status === 'PAUSED_CAPTCHA' ? 'YES' : 'NO',
      confirmation: readyRun.status === 'SUBMITTED' ? 'YES' : 'NO',
      dbStatus: readyRun.status,
      submittedAt: finalApp?.updated_at,
    }

    log(`=== RESULT: ${result.status} ===`)
    log(`Reason: ${result.reason}`)

    // Cleanup for next provider
    try {
      db.prepare('DELETE FROM automation_runs WHERE id=?').run(runId)
      log(`Cleaned up run ${runId}`)
    } catch (e) {
      error(`Failed to delete run: ${e}`)
    }
    runId = null

    return result
  }

  if (readyRun.status !== 'READY_FOR_REVIEW') {
    error(`Run did not reach READY_FOR_REVIEW. Status: ${readyRun.status}`)
    if (readyRun.pause) {
      error(`Pause reason: ${readyRun.pause.reason || readyRun.pause.instruction}`)
    }

    // Cleanup for next provider
    try {
      db.prepare('DELETE FROM automation_runs WHERE id=?').run(runId)
      log(`Cleaned up run ${runId}`)
    } catch (e) {
      error(`Failed to delete run: ${e}`)
    }
    runId = null

    return {
      provider: provider.name,
      jobUrl: provider.jobUrl,
      status: 'BLOCKED_BEFORE_SUBMIT',
      reason: readyRun.pause?.reason || readyRun.pause?.instruction || 'Did not reach READY_FOR_REVIEW',
    }
  }

  log('READY_FOR_REVIEW achieved. Performing pre-submission validation...')

  // Pre-submission validation
  const application = db.prepare('SELECT application_json, test_mode FROM automation_runs WHERE id=?').get(runId) as { application_json: string; test_mode: number } | undefined
  if (!application) {
    error('Application data not found')
    return {
      provider: provider.name,
      jobUrl: provider.jobUrl,
      status: 'FAILED',
      reason: 'Application data not found',
    }
  }

  const appData = JSON.parse(application.application_json)
  const validation = validateApplicationForRealSubmission(appData, Boolean(application.test_mode))

  log(`Pre-submit validation: ${validation.isValid ? 'PASS' : 'FAIL'}`)
  if (!validation.isValid) {
    error(`Pre-submission validation FAILED: ${validation.violations.join('; ')}`)
    error('DO NOT SUBMITTING')

    // Cleanup for next provider
    try {
      db.prepare('DELETE FROM automation_runs WHERE id=?').run(runId)
      log(`Cleaned up run ${runId}`)
    } catch (e) {
      error(`Failed to delete run: ${e}`)
    }
    runId = null

    return {
      provider: provider.name,
      jobUrl: provider.jobUrl,
      status: 'BLOCKED_BEFORE_SUBMIT',
      reason: `Pre-submit validation failed: ${validation.violations.join('; ')}`,
    }
  }

  // Now trigger the actual submission
  log('Pre-submission validation PASSED. Triggering real submission...')
  await automationManager.submit(userId, runId)

  // Wait for final state
  log('Waiting for submission completion...')
  const finalRun = await waitForSubmission(userId, runId, 300000)

  if (!finalRun) {
    error('Run failed to reach final state')
    return {
      provider: provider.name,
      jobUrl: provider.jobUrl,
      status: 'FAILED',
      reason: 'Run failed to reach final state',
    }
  }

  const finalApp = db.prepare('SELECT application_json, status, current_step, error_message, created_at, updated_at FROM automation_runs WHERE id=?').get(runId) as any
  let applicationData = null
  if (finalApp?.application_json) {
    try {
      applicationData = JSON.parse(finalApp.application_json)
    } catch (e) {
      log('Failed to parse application data')
    }
  }

  const result = {
    provider: provider.name,
    jobUrl: provider.jobUrl,
    status: finalRun.status === 'SUBMITTED' ? 'REAL_SUBMISSION_VERIFIED' : 
           finalRun.status === 'PAUSED_CAPTCHA' ? 'CAPTCHA_BLOCKED' : 'FAILED',
    reason: finalRun.status === 'SUBMITTED' ? 'ATS confirmation detected' :
            finalRun.status === 'PAUSED_CAPTCHA' ? 'CAPTCHA detected' : finalApp?.error_message || 'Submission failed',
    fields: applicationData?.fields?.length,
    required: applicationData?.fields?.filter((f: any) => f.required).length,
    captcha: finalRun.status === 'PAUSED_CAPTCHA' ? 'YES' : 'NO',
    confirmation: finalRun.status === 'SUBMITTED' ? 'YES' : 'NO',
    dbStatus: finalRun.status,
    submittedAt: finalApp?.updated_at,
  }

  log(`=== RESULT: ${result.status} ===`)
  log(`Reason: ${result.reason}`)

  // Cleanup for next provider
  try {
    db.prepare('DELETE FROM automation_runs WHERE id=?').run(runId)
    log(`Cleaned up run ${runId}`)
  } catch (e) {
    error(`Failed to delete run: ${e}`)
  }
  runId = null

  return result
}

async function main() {
  try {
    log('Starting controlled multi-provider real submission')
    validateConfig()

    console.log('\n' + '='.repeat(80))
    console.log('CONTROLLED MULTI-PROVIDER REAL SUBMISSION')
    console.log('This will submit ACTUAL applications to real employers.')
    console.log('='.repeat(80))
    console.log('')

    const userId = createTestUser()

    // Test each provider sequentially
    for (const provider of PROVIDERS) {
      log('')
      log(`=== STARTING ${provider.name.toUpperCase()} ===`)
      const result = await testProvider(provider, userId)
      results.push(result)
      log(`=== ${provider.name.toUpperCase()} COMPLETE ===`)
      log('')
      
      // Wait between providers
      await new Promise(resolve => setTimeout(resolve, 5000))
    }

    // Print final matrix
    console.log('\n' + '='.repeat(80))
    console.log('FINAL SUBMISSION MATRIX')
    console.log('='.repeat(80))
    console.log('')
    console.log('PROVIDER\t\tSTATUS\t\t\tREASON')
    console.log('--------\t\t------\t\t\t------')
    results.forEach(result => {
      console.log(`${result.provider}\t\t${result.status}\t\t${result.reason || ''}`)
    })

    console.log('')
    console.log('=== SUMMARY ===')
    const verified = results.filter(r => r.status === 'REAL_SUBMISSION_VERIFIED').length
    const blocked = results.filter(r => r.status === 'CAPTCHA_BLOCKED').length
    const failed = results.filter(r => r.status === 'FAILED').length
    const blockedBefore = results.filter(r => r.status === 'BLOCKED_BEFORE_SUBMIT').length

    console.log(`REAL_SUBMISSION_VERIFIED: ${verified} / ${results.length}`)
    console.log(`CAPTCHA_BLOCKED: ${blocked}`)
    console.log(`FAILED: ${failed}`)
    console.log(`BLOCKED_BEFORE_SUBMIT: ${blockedBefore}`)

    console.log('')
    console.log('Including previous Lever result: CAPTCHA_BLOCKED')
    console.log('')
    console.log(`TOTAL VERIFIED: ${verified} / 5 (Lever + 4 providers)`)
    console.log(`TOTAL CAPTCHA_BLOCKED: ${blocked + 1} / 5`)

    console.log('='.repeat(80))

    log('✓ Controlled multi-provider submission completed')

    process.exit(0)

  } catch (err: any) {
    error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  } finally {
    cleanup()
  }
}

main()