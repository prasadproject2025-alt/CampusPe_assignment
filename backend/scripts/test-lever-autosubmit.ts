#!/usr/bin/env node
/**
 * LEVER AUTO-SUBMIT TEST - STAGE A
 * 
 * Test Lever with testMode=true, autoSubmit=false
 * Verify it reaches READY_FOR_REVIEW and stops there
 */

import { randomUUID } from 'node:crypto'
import { existsSync, copyFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AutomationStatus } from '../src/automation/types.js'
import { db } from '../src/database.js'
import { automationManager } from '../src/automation/manager.js'
import { uploadDir } from '../src/config.js'

// Configuration
const config = {
  jobUrl: 'https://jobs.lever.co/Flex/94e2c098-99e8-4737-97a0-e4a5cafd749b/apply',
  candidateName: 'Ankita Lokhande',
  candidateEmail: '2023.ankital@isu.ac.in',
  resumePath: '/Users/ankitalokhande/Desktop/campuspe_mvp/uploads/resumes/lever-test-candidate-001.pdf',
  phone: '+91 7678085840',
  location: 'Mumbai, India',
  linkedinUrl: '',
  testMode: true,
  autoSubmit: false,
}

let tempUserId: string | null = null
let tempResumeStorageName: string | null = null
let runId: string | null = null
let userCreated = false

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

async function main() {
  try {
    log('=== LEVER AUTO-SUBMIT TEST - STAGE A ===')
    log('Configuration:')
    log(`  Job URL: ${config.jobUrl}`)
    log(`  Candidate: ${config.candidateName}`)
    log(`  Email: ${config.candidateEmail}`)
    log(`  Test Mode: ${config.testMode}`)
    log(`  Auto Submit: ${config.autoSubmit}`)
    
    // Validate configuration
    if (!config.jobUrl || !config.candidateName || !config.candidateEmail || !config.resumePath) {
      error('Missing required configuration')
      process.exit(1)
    }
    
    if (!existsSync(config.resumePath)) {
      error(`Resume file not found: ${config.resumePath}`)
      process.exit(1)
    }
    
    // Get or create user
    const existingUser = db.prepare('SELECT id FROM users WHERE email=?').get(config.candidateEmail) as { id: string } | undefined
    if (existingUser) {
      tempUserId = existingUser.id
      log(`Using existing user: ${tempUserId}`)
    } else {
      tempUserId = randomUUID()
      const now = new Date().toISOString()
      db.prepare('INSERT INTO users (id, email, name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        tempUserId,
        config.candidateEmail,
        config.candidateName,
        'dummy_hash', // Password not used for automation
        'dummy_salt',
        now
      )
      userCreated = true
      log(`Created temp user: ${tempUserId}`)
    }
    
    // Copy resume to uploads directory
    const resumeStorageName = `test-${randomUUID()}.pdf`
    const resumeDestPath = resolve(uploadDir, resumeStorageName)
    copyFileSync(config.resumePath, resumeDestPath)
    tempResumeStorageName = resumeStorageName
    log(`Copied resume to: ${resumeStorageName}`)
    
    // Store resume in database
    try {
      db.prepare('INSERT INTO resumes (user_id, storage_name, original_name, file_size) VALUES (?, ?, ?, ?)').run(
        tempUserId,
        resumeStorageName,
        'resume_for_me.pdf',
        148582 // From previous observation
      )
      log('Stored resume in database')
    } catch (e) {
      // If resumes table doesn't exist, skip this step
      log('Resume storage skipped (table may not exist)')
    }
    
    // Create/update profile with phone
    try {
      const existingProfile = db.prepare('SELECT id FROM profiles WHERE user_id=?').get(tempUserId) as { id: string } | undefined
      if (existingProfile) {
        db.prepare('UPDATE profiles SET phone=?, location=?, linkedin_url=? WHERE user_id=?').run(
          config.phone,
          config.location,
          config.linkedinUrl,
          tempUserId
        )
        log('Updated profile')
      } else {
        db.prepare('INSERT INTO profiles (user_id, phone, location, linkedin_url) VALUES (?, ?, ?, ?)').run(
          tempUserId,
          config.phone,
          config.location,
          config.linkedinUrl
        )
        log('Created profile')
      }
    } catch (e) {
      log('Profile creation/update skipped')
    }
    
    // Start the automation
    log('Starting automation...')
    const run = automationManager.create(tempUserId, config.jobUrl, config.autoSubmit, config.testMode)
    runId = run.id
    log(`Started run: ${runId}`)
    
    // Resume to start processing
    log('Resuming to start processing...')
    await automationManager.resume(tempUserId, runId)
    
    // Wait for processing to complete
    log('Waiting for processing to complete...')
    let status = 'QUEUED'
    let attempts = 0
    while (status === 'QUEUED' && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const current = db.prepare('SELECT status FROM automation_runs WHERE id=?').get(runId) as { status: AutomationStatus } | undefined
      status = current?.status || 'QUEUED'
      attempts++
      log(`  Status: ${status} (attempt ${attempts})`)
    }
    
    // Check final status
    const finalStatus = db.prepare('SELECT status, current_step FROM automation_runs WHERE id=?').get(runId) as { status: AutomationStatus; current_step: string } | undefined
    
    log('=== FINAL STATE ===')
    log(`Status: ${finalStatus?.status}`)
    log(`Current Step: ${finalStatus?.current_step}`)
    
    // Verify expectations
    if (finalStatus?.status === 'READY_FOR_REVIEW') {
      log('✓ SUCCESS: Reached READY_FOR_REVIEW as expected with autoSubmit=false')
      process.exit(0)
    } else {
      error(`✗ FAILED: Expected READY_FOR_REVIEW but got ${finalStatus?.status}`)
      process.exit(1)
    }
    
  } catch (e) {
    error(`Error: ${e}`)
    process.exit(1)
  } finally {
    await cleanup()
  }
}

main()