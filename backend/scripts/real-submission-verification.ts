#!/usr/bin/env node
/**
 * REAL END-TO-END ATS SUBMISSION VERIFICATION
 * 
 * Controlled real employer submissions for verification testing
 * 
 * Authorized candidate:
 * - Name: Ankita Lokhande
 * - Email: 2023.ankital@isu.ac.in
 * - Phone: +91 7678085840
 * - Location: Mumbai, India
 * - Resume: /Users/ankitalokhande/Desktop/campuspe_mvp/uploads/resumes/resume_for_me.pdf
 */

import { randomUUID } from 'node:crypto'
import { existsSync, copyFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AutomationStatus } from '../src/automation/types.js'
import { db } from '../src/database.js'
import { automationManager } from '../src/automation/manager.js'
import { uploadDir } from '../src/config.js'

// Configuration
const CANDIDATE = {
  name: 'Ankita Lokhande',
  email: '2023.ankital@isu.ac.in',
  phone: '+91 7678085840',
  location: 'Mumbai, India',
  linkedinUrl: '',
  resumePath: '/Users/ankitalokhande/Desktop/campuspe_mvp/uploads/resumes/resume_for_me.pdf',
}

const PROVIDERS = [
  {
    name: 'Lever',
    jobUrl: 'https://jobs.lever.co/Flex/94e2c098-99e8-4737-97a0-e4a5cafd749b/apply',
  },
  {
    name: 'Workable',
    jobUrl: 'https://apply.workable.com/api/v1/jobs/EXAMPLE', // Will need to update with live URL
  },
  {
    name: 'Breezy',
    jobUrl: 'https://BREEZY-COMPANY.breezy.hr/positions/EXAMPLE', // Will need to update with live URL
  },
  {
    name: 'Recruitee',
    jobUrl: 'https://RECRUITEE-COMPANY.recruitee.com/jobs/EXAMPLE', // Will need to update with live URL
  },
  {
    name: 'Rippling',
    jobUrl: 'https://JOBS.rippling.com/EXAMPLE', // Will need to update with live URL
  },
]

let tempUserId: string | null = null
let tempResumeStorageName: string | null = null
let runId: string | null = null
let userCreated = false

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

async function cleanup() {
  log('Cleaning up...')
  
  if (runId) {
    try {
      db.prepare('DELETE FROM automation_runs WHERE id=?').run(runId)
      log(`Deleted run ${runId}`)
    } catch (e) {
      error(`Failed to delete run: ${e}`)
    }
  }
  
  if (tempUserId && userCreated) {
    try {
      db.prepare('DELETE FROM users WHERE id=?').run(tempUserId)
      log(`Deleted user ${tempUserId}`)
    } catch (e) {
      error(`Failed to delete user: ${e}`)
    }
  }
  
  if (tempResumeStorageName) {
    try {
      const resumePath = resolve(uploadDir, tempResumeStorageName)
      if (existsSync(resumePath)) {
        unlinkSync(resumePath)
        log(`Deleted temp resume ${tempResumeStorageName}`)
      }
    } catch (e) {
      error(`Failed to delete resume: ${e}`)
    }
  }
}

async function setupCandidate() {
  log('=== CANDIDATE SETUP ===')
  log(`Name: ${CANDIDATE.name}`)
  log(`Email: ${CANDIDATE.email}`)
  log(`Phone: ${CANDIDATE.phone}`)
  log(`Location: ${CANDIDATE.location}`)
  log(`Resume: ${CANDIDATE.resumePath}`)
  
  if (!existsSync(CANDIDATE.resumePath)) {
    error(`Resume file not found: ${CANDIDATE.resumePath}`)
    process.exit(1)
  }
  
  const { stat } = await import('node:fs/promises')
  const resumeSize = (await stat(CANDIDATE.resumePath)).size
  log(`Resume size: ${resumeSize} bytes`)
  
  // Get or create user
  const existingUser = db.prepare('SELECT id FROM users WHERE email=?').get(CANDIDATE.email) as { id: string } | undefined
  if (existingUser) {
    tempUserId = existingUser.id
    log(`Using existing user: ${tempUserId}`)
  } else {
    tempUserId = randomUUID()
    const now = new Date().toISOString()
    db.prepare('INSERT INTO users (id, email, name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      tempUserId,
      CANDIDATE.email,
      CANDIDATE.name,
      'dummy_hash',
      'dummy_salt',
      now
    )
    userCreated = true
    log(`Created temp user: ${tempUserId}`)
  }
  
  // Copy resume to uploads directory
  const resumeStorageName = `test-${randomUUID()}.pdf`
  const resumeDestPath = resolve(uploadDir, resumeStorageName)
  copyFileSync(CANDIDATE.resumePath, resumeDestPath)
  tempResumeStorageName = resumeStorageName
  log(`Copied resume to: ${resumeStorageName}`)
  
  // Store resume in database
  try {
    db.prepare('INSERT INTO resumes (user_id, storage_name, original_name, file_size) VALUES (?, ?, ?, ?)').run(
      tempUserId,
      resumeStorageName,
      'resume_for_me.pdf',
      resumeSize
    )
    log('Stored resume in database')
  } catch (e) {
    log('Resume storage skipped (table may not exist)')
  }
  
  // Create/update profile with phone
  try {
    const existingProfile = db.prepare('SELECT id FROM profiles WHERE user_id=?').get(tempUserId) as { id: string } | undefined
    if (existingProfile) {
      db.prepare('UPDATE profiles SET phone=?, location=?, linkedin_url=? WHERE user_id=?').run(
        CANDIDATE.phone,
        CANDIDATE.location,
        CANDIDATE.linkedinUrl,
        tempUserId
      )
      log('Updated profile')
    } else {
      db.prepare('INSERT INTO profiles (user_id, phone, location, linkedin_url) VALUES (?, ?, ?, ?)').run(
        tempUserId,
        CANDIDATE.phone,
        CANDIDATE.location,
        CANDIDATE.linkedinUrl
      )
      log('Created profile')
    }
  } catch (e) {
    log('Profile creation/update skipped')
  }
}

async function testProvider(provider: typeof PROVIDERS[0]) {
  log('=== PROVIDER TEST ===')
  log(`Provider: ${provider.name}`)
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
  
  // For now, mark as SKIPPED since we need to understand the proper automation flow
  log('SKIPPED: Need to implement proper automation processing flow')
  
  // Record result
  results.push({
    provider: provider.name,
    jobUrl: provider.jobUrl,
    status: 'SKIPPED',
    reason: 'Need to implement proper automation processing flow',
  })
  
  log(`=== RESULT: SKIPPED ===`)
}

async function main() {
  try {
    log('=== REAL END-TO-END ATS SUBMISSION VERIFICATION ===')
    log('Provider order: Lever, Workable, Breezy, Recruitee, Rippling')
    
    // Setup candidate
    await setupCandidate()
    
    // Test each provider sequentially
    for (const provider of PROVIDERS) {
      log('')
      log(`=== STARTING ${provider.name.toUpperCase()} ===`)
      await testProvider(provider)
      log(`=== ${provider.name.toUpperCase()} COMPLETE ===`)
      log('')
      
      // Wait between providers
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    
    // Print final matrix
    log('=== FINAL SUBMISSION MATRIX ===')
    log('')
    log('PROVIDER\t\tSTATUS\t\tREASON')
    log('--------\t\t------\t\t------')
    results.forEach(result => {
      log(`${result.provider}\t\t${result.status}\t\t${result.reason || ''}`)
    })
    
    log('')
    log('=== SUMMARY ===')
    const verified = results.filter(r => r.status === 'REAL_SUBMISSION_VERIFIED').length
    const blocked = results.filter(r => r.status === 'CAPTCHA_BLOCKED').length
    const failed = results.filter(r => r.status === 'FAILED').length
    const blockedBefore = results.filter(r => r.status === 'BLOCKED_BEFORE_SUBMIT').length
    const unknown = results.filter(r => r.status === 'UNKNOWN_SUBMISSION_STATE').length
    const skipped = results.filter(r => r.status === 'SKIPPED').length
    
    log(`REAL_SUBMISSION_VERIFIED: ${verified} / ${results.length}`)
    log(`CAPTCHA_BLOCKED: ${blocked}`)
    log(`FAILED: ${failed}`)
    log(`BLOCKED_BEFORE_SUBMIT: ${blockedBefore}`)
    log(`UNKNOWN_SUBMISSION_STATE: ${unknown}`)
    log(`SKIPPED: ${skipped}`)
    
    log('')
    log('NOTE: Full real submission verification requires integration with the production')
    log('automation orchestration system. The automationManager.create() method creates')
    log('runs but processing is handled asynchronously by the system. For complete')
    log('end-to-end verification, use the production API or implement proper async processing.')
    
    process.exit(0)
    
  } catch (e) {
    error(`Error: ${e}`)
    process.exit(1)
  } finally {
    await cleanup()
  }
}

main()