#!/usr/bin/env node
/**
 * Quick verification script to test Greenhouse job URLs
 */

async function verifyJobUrl(jobUrl: string) {
  console.log(`\n=== VERIFYING: ${jobUrl} ===`)
  
  // Parse URL
  const url = new URL(jobUrl)
  const match = url.pathname.match(/\/([^/]+)\/jobs\/(\d+)/)
  if (!match) {
    console.log('ERROR: Could not extract board and job ID from URL')
    return null
  }
  
  const board = match[1]
  const jobId = match[2]
  
  console.log(`Board: ${board}`)
  console.log(`Job ID: ${jobId}`)
  
  // Test public job API
  const publicApiUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}?questions=true`
  console.log(`Testing public API: ${publicApiUrl}`)
  
  try {
    const response = await fetch(publicApiUrl)
    console.log(`Public API status: ${response.status}`)
    
    if (response.ok) {
      const data = await response.json()
      console.log(`Public API: PASS`)
      console.log(`Title: ${data.title || 'N/A'}`)
      console.log(`Questions available: ${data.questions ? 'YES' : 'NO'}`)
      if (data.questions) {
        console.log(`Question count: ${data.questions.length}`)
        const requiredQuestions = data.questions.filter((q: any) => q.required)
        console.log(`Required questions: ${requiredQuestions.length}`)
        if (requiredQuestions.length > 0) {
          console.log(`Required question types: ${requiredQuestions.map((q: any) => q.name || q.label || q.type).join(', ')}`)
        }
      }
      return { url: jobUrl, status: 'PASS', jobId, board, publicApiStatus: response.status, hasQuestions: !!data.questions, data }
    } else {
      console.log(`Public API: FAIL`)
      return { url: jobUrl, status: 'FAIL', jobId, board, publicApiStatus: response.status, error: response.statusText }
    }
  } catch (error) {
    console.log(`Public API: ERROR - ${error}`)
    return { url: jobUrl, status: 'ERROR', jobId, board, error: String(error) }
  }
}

async function main() {
  const urls = [
    'https://job-boards.greenhouse.io/eudia/jobs/4020070009',
    'https://job-boards.greenhouse.io/airtable/jobs/8403127002',
    'https://job-boards.greenhouse.io/bamboohr17/jobs/6115974004',
  ]
  
  console.log('GREENHOUSE JOB URL VERIFICATION')
  console.log('===============================')
  
  for (const url of urls) {
    const result = await verifyJobUrl(url)
    if (result) {
      console.log(`Result: ${result.status}`)
      if (result.status === 'PASS') {
        console.log(`✓ SUITABLE: ${url}`)
      } else {
        console.log(`✗ UNSUITABLE: ${url}`)
      }
    }
  }
}

main().catch(console.error)
