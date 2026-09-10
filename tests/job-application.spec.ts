import { test, expect } from '@playwright/test';
import { ApplicationEngine } from '../src/automation/engine';
import { getMockCandidate } from '../scripts/seed-data';
import { PersonalInfoPage } from '../src/automation/pages/PersonalInfoPage';
import { EducationPage } from '../src/automation/pages/EducationPage';
import { ExperiencePage } from '../src/automation/pages/ExperiencePage';
import fs from 'fs';
import path from 'path';

test.describe('Job Application Automation - Production Reliability Test Suite', () => {

  test.beforeEach(async () => {
    // Reset server-side test state and chaos knobs
    try {
      await fetch('http://localhost:3000/api/admin/reset', { method: 'POST' });
      await fetch('http://localhost:3000/api/chaos/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetChaos: true })
      });
    } catch {
      // Server may not be ready yet if spawned by runner
    }
  });

  test('Scenario 1: Happy Path - Complete all 6 application steps seamlessly', async () => {
    const candidate = getMockCandidate('test_spec_happy_path');
    const engine = new ApplicationEngine(candidate, 'http://localhost:3000');

    const receipt = await engine.run();

    expect(receipt.applicationId).toBeTruthy();
    expect(receipt.applicationId.startsWith('APP-')).toBe(true);
    expect(receipt.candidateName).toBe(candidate.personalInfo.fullName);
    expect(receipt.isDuplicate).toBe(false);

    const state = engine.getStateManager().getState();
    expect(state.status).toBe('SUBMITTED');
    expect(state.completedSteps).toEqual([
      'PERSONAL_INFO',
      'EDUCATION',
      'EXPERIENCE',
      'RESUME_UPLOAD',
      'REVIEW',
      'SUBMIT'
    ]);
  });

  test('Scenario 2: Session Expiry - Detects expired session, re-authenticates and resumes without restarting', async () => {
    const candidate = getMockCandidate('test_spec_session_expiry');
    const engine = new ApplicationEngine(candidate, 'http://localhost:3000');

    // Invalidate session on server after 2.5s via HTTP endpoint
    setTimeout(async () => {
      await fetch('http://localhost:3000/api/chaos/expire-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: candidate.personalInfo.email })
      }).catch(() => {});
    }, 2500);

    const receipt = await engine.run();

    expect(receipt.applicationId).toBeTruthy();
    const state = engine.getStateManager().getState();
    expect(state.status).toBe('SUBMITTED');
    
    // Check that recovery event occurred in journal
    const recoveryEvents = state.history.filter(h => h.status === 'RECOVERED');
    expect(recoveryEvents.length).toBeGreaterThanOrEqual(1);
  });

  test('Scenario 3: Transient Failure & Latency - Retries with exponential backoff on 500 error', async () => {
    // Configure transient 500 on Step 2 via API
    await fetch('http://localhost:3000/api/chaos/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceServerErrorSteps: [2] })
    });

    const candidate = getMockCandidate('test_spec_transient_failure');
    const engine = new ApplicationEngine(candidate, 'http://localhost:3000', {
      maxRetries: 3,
      baseRetryDelayMs: 600
    });

    const receipt = await engine.run();

    expect(receipt.applicationId).toBeTruthy();
    const state = engine.getStateManager().getState();
    expect(state.status).toBe('SUBMITTED');
  });

  test('Scenario 4: Browser Crash Recovery - Resumes from persistent checkpoint after worker termination', async () => {
    const candidate = getMockCandidate('test_spec_crash_recovery');

    // Phase 1: Actually execute steps 1, 2, 3 through browser
    const enginePhase1 = new ApplicationEngine(candidate, 'http://localhost:3000');
    await enginePhase1.initializeBrowser(true);
    const page1 = (enginePhase1 as any).page;
    await page1.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    const pPage = new PersonalInfoPage(page1);
    await pPage.fillAndSubmit(candidate.personalInfo);
    enginePhase1.getStateManager().markStepCompleted('PERSONAL_INFO');

    const ePage = new EducationPage(page1);
    await ePage.fillAndSubmit(candidate.education);
    enginePhase1.getStateManager().markStepCompleted('EDUCATION');

    const xPage = new ExperiencePage(page1);
    await xPage.fillAndSubmit(candidate.experience);
    enginePhase1.getStateManager().markStepCompleted('EXPERIENCE');

    // Kill browser
    await ((enginePhase1 as any).browser).close();

    // Phase 2: Start fresh engine instance simulating process respawn
    const enginePhase2 = new ApplicationEngine(candidate, 'http://localhost:3000');
    expect(enginePhase2.getStateManager().getNextPendingStep()).toBe('RESUME_UPLOAD');

    const receipt = await enginePhase2.run();
    expect(receipt.applicationId).toBeTruthy();
    expect(receipt.isDuplicate).toBe(false);
  });

  test('Scenario 5: Duplicate Submission Prevention - Idempotency guard blocks re-submission', async () => {
    const candidate = getMockCandidate('test_spec_idempotency');
    const engine1 = new ApplicationEngine(candidate, 'http://localhost:3000');
    const receipt1 = await engine1.run();

    // Re-run submission with the exact same candidate profile
    const engine2 = new ApplicationEngine(candidate, 'http://localhost:3000');
    const receipt2 = await engine2.run();

    expect(receipt2.applicationId).toBe(receipt1.applicationId);
    expect(receipt2.isDuplicate).toBe(true);
  });

});
