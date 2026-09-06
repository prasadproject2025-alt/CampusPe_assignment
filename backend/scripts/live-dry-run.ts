import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../src/database.js'
import { automationManager } from '../src/automation/manager.js'
import { uploadDir } from '../src/config.js'

const TEST_USER_ID = randomUUID()

async function setupTestUser() {
  const now = new Date().toISOString()
  db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)').run(
    TEST_USER_ID,
    `live-test-${TEST_USER_ID}@jobcopilot.test`,
    'Test Candidate',
    'x',
    'x',
    now
  )
  
  // Create a mock resume file
  const resumeFileName = `test-resume-${TEST_USER_ID}.pdf`
  const resumePath = resolve(uploadDir, resumeFileName)
  mkdirSync(uploadDir, { recursive: true, mode: 0o700 })
  writeFileSync(resumePath, '%PDF-1.4\nMock PDF content for testing')
  
  // Insert profile with resume, phone country code, and location
  db.prepare(`INSERT INTO profiles (
    user_id, updated_at, phone, phone_country_code, location, linkedin_url, portfolio_url, education_json, resume_storage_name, resume_filename, resume_mime
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    TEST_USER_ID,
    now,
    '+91 9876543210',
    '+91',
    'San Francisco, CA',
    'https://linkedin.com/in/test',
    'https://test.dev',
    JSON.stringify([
      { school: 'Indian Institute of Technology', degree: 'Bachelor of Technology', field: 'Computer Science', startDate: '2018-07', endDate: '2022-05' }
    ]),
    resumeFileName,
    'Test Resume.pdf',
    'application/pdf'
  )
  console.log(`Created test user: ${TEST_USER_ID}`)
  console.log(`Created mock resume: ${resumePath}`)
}

async function waitForSettled(runId: string, timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const run = automationManager.get(TEST_USER_ID, runId)
    if (run && !['QUEUED', 'OPENING_JOB', 'EXTRACTING_JOB', 'FILLING_APPLICATION'].includes(run.status)) {
      return run
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return automationManager.get(TEST_USER_ID, runId)
}

async function runLiveDryRun(provider: string, url: string) {
  console.log(`\n=== ${provider.toUpperCase()} LIVE DRY RUN ===`)
  console.log(`URL: ${url}`)
  
  try {
    const created = automationManager.create(TEST_USER_ID, url, false, true)
    console.log(`Run ID: ${created?.id}`)
    console.log(`Strategy: ${created?.strategy}`)
    
    const run = await waitForSettled(created!.id)
    console.log(`Final Status: ${run?.status}`)
    console.log(`Step: ${run?.currentStep}`)
    
    if (run?.application) {
      console.log(`Fields: ${run.application.fields.length}`)
      console.log(`Required: ${run.application.fields.filter(f => f.required).length}`)
      console.log(`Filled: ${run.application.fields.filter(f => f.value).length}`)
      
      const resumeField = run.application.fields.find(f => f.inputType === 'file' && /resume|cv/i.test(f.text))
      console.log(`Resume field: ${resumeField ? 'FOUND' : 'NOT FOUND'}`)
      
      const phoneField = run.application.fields.find(f => /phone/i.test(f.text))
      console.log(`Phone field: ${phoneField ? 'FOUND' : 'NOT FOUND'}`)
      
      const educationField = run.application.fields.find(f => /education|school|degree/i.test(f.text))
      console.log(`Education field: ${educationField ? 'FOUND' : 'NOT FOUND'}`)
      
      const dynamicFields = run.application.fields.filter(f => !f.value && f.required)
      console.log(`Unresolved required: ${dynamicFields.length}`)
    }
    
    if (run?.error) {
      console.log(`Error: ${run.error}`)
    }
    
    const events = run?.events || []
    const lastEvent = events[events.length - 1]
    console.log(`Last event: ${lastEvent?.status} - ${lastEvent?.message}`)
    
    return {
      provider,
      url,
      success: run?.status !== 'FAILED',
      status: run?.status,
      step: run?.currentStep,
      fields: run?.application?.fields.length || 0,
      required: run?.application?.fields.filter(f => f.required).length || 0,
      filled: run?.application?.fields.filter(f => f.value).length || 0,
      unresolvedRequired: run?.application?.fields.filter(f => !f.value && f.required).length || 0,
      resumeField: run?.application?.fields.find(f => f.inputType === 'file' && /resume|cv/i.test(f.text)) ? 'FOUND' : 'NOT FOUND',
      phoneField: run?.application?.fields.find(f => /phone/i.test(f.text)) ? 'FOUND' : 'NOT FOUND',
      educationField: run?.application?.fields.find(f => /education|school|degree/i.test(f.text)) ? 'FOUND' : 'NOT FOUND',
      error: run?.error,
      lastEvent: lastEvent?.message
    }
  } catch (error) {
    console.log(`Exception: ${error}`)
    return {
      provider,
      url,
      success: false,
      error: String(error)
    }
  }
}

async function main() {
  await setupTestUser()
  
  const urls = {
    Rippling: 'https://ats.rippling.com/rippling/jobs/3f7826f8-cd91-4086-9425-6399600c733f'
  }
  
  const results = []
  
  for (const [provider, url] of Object.entries(urls)) {
    const result = await runLiveDryRun(provider, url)
    results.push(result)
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  
  console.log('\n=== SUMMARY ===')
  for (const result of results) {
    console.log(`${result.provider}: ${result.success ? 'PASS' : 'FAIL'} - ${result.status}`)
  }
  
  db.prepare('DELETE FROM users WHERE id=?').run(TEST_USER_ID)
  console.log(`Cleaned up test user: ${TEST_USER_ID}`)
}

main().catch(console.error)
