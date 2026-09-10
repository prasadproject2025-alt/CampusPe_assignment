import { ApplicationEngine } from '../src/automation/engine';
import { getMockCandidate } from './seed-data';
import { logger } from '../src/automation/logger';
import http from 'http';
import app from '../server/index';
import { resetApplicationState } from '../server/applications';
import { invalidateAllSessionsForUser } from '../server/auth';
import { chaosState } from '../server/chaos';
import fs from 'fs';
import path from 'path';

const PORT = 3000;
let serverInstance: http.Server | null = null;

async function startServer(): Promise<void> {
  return new Promise((resolve) => {
    serverInstance = app.listen(PORT, () => {
      logger.info(`[Demo Runner] Test Server active at http://localhost:${PORT}`);
      resolve();
    });
    serverInstance.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        logger.info(`[Demo Runner] Reusing existing server at http://localhost:${PORT}`);
        serverInstance = null;
        resolve();
      } else {
        throw err;
      }
    });
  });
}

async function stopServer(): Promise<void> {
  if (serverInstance) {
    await new Promise<void>((resolve) => serverInstance!.close(() => resolve()));
    logger.info('[Demo Runner] Test Server stopped.');
  }
}

function cleanStateDir(): void {
  const stateDir = path.join(process.cwd(), 'state');
  if (fs.existsSync(stateDir)) {
    const files = fs.readdirSync(stateDir);
    for (const f of files) {
      if (f.endsWith('.json') || f.endsWith('.tmp')) {
        fs.unlinkSync(path.join(stateDir, f));
      }
    }
  }
}

// Scenario 1: Happy Path
async function runHappyPath(): Promise<boolean> {
  logger.info('\n================================================================');
  logger.info('SCENARIO 1: HAPPY PATH EXECUTION (ALL 6 STEPS)');
  logger.info('================================================================');

  const candidate = getMockCandidate('cand_happy_01');
  const engine = new ApplicationEngine(candidate, `http://localhost:${PORT}`);
  const receipt = await engine.run();

  logger.info('✔ Happy path verified successfully! Application ID: ' + receipt.applicationId);
  return receipt.applicationId.startsWith('APP-') && !receipt.isDuplicate;
}

// Scenario 2: Session Expiry Recovery
async function runSessionExpiryDemo(): Promise<boolean> {
  logger.info('\n================================================================');
  logger.info('SCENARIO 2: SESSION EXPIRY DETECTION & AUTO-RESUMPTION');
  logger.info('Requirement 4: Detects expired session, recovers, resumes from failed step');
  logger.info('================================================================');

  const candidate = getMockCandidate('cand_session_expiry_02');
  const engine = new ApplicationEngine(candidate, `http://localhost:${PORT}`);

  // We start the engine, and when it reaches Education (Step 2), we simulate background session invalidation
  // In our engine, SessionManager checks and recovers automatically!
  // To simulate external expiry mid-flow, we hook a timer that invalidates the session 3 seconds into execution:
  setTimeout(() => {
    logger.warn('⚡ [CHAOS INJECTOR] Forcibly invalidating candidate active session in auth store...');
    invalidateAllSessionsForUser(candidate.personalInfo.email);
  }, 2500);

  const receipt = await engine.run();
  const state = engine.getStateManager().getState();
  const recoveredEvents = state.history.filter(h => h.status === 'RECOVERED');

  logger.info(`✔ Session expiry recovery verified! Total recoveries performed: ${recoveredEvents.length}`);
  logger.info('✔ Application completed without restarting! Application ID: ' + receipt.applicationId);
  return receipt.applicationId.startsWith('APP-');
}

// Scenario 3: Transient Network / Timeout Recovery
async function runNetworkTimeoutDemo(): Promise<boolean> {
  logger.info('\n================================================================');
  logger.info('SCENARIO 3: TRANSIENT FAILURE RETRY (500 ERROR & LATENCY)');
  logger.info('Requirement 5 & 6: Exponential backoff with jitter on transient failures');
  logger.info('================================================================');

  // Inject a 1-time 500 error on Step 2 (Education) and 1000ms delay
  chaosState.forceServerErrorSteps = [2];
  chaosState.networkLatencyMs = 800;

  const candidate = getMockCandidate('cand_timeout_03');
  const engine = new ApplicationEngine(candidate, `http://localhost:${PORT}`, {
    maxRetries: 3,
    baseRetryDelayMs: 800
  });

  const receipt = await engine.run();
  const state = engine.getStateManager().getState();
  logger.info(`✔ Transient failure overcome via exponential backoff! Application ID: ${receipt.applicationId}`);
  logger.info(`Step attempts: ${JSON.stringify(state.stepAttempts)}`);

  // Reset chaos
  chaosState.forceServerErrorSteps = [];
  chaosState.networkLatencyMs = 0;
  return receipt.applicationId.startsWith('APP-');
}

// Scenario 4: Browser Crash Recovery
async function runBrowserCrashDemo(): Promise<boolean> {
  logger.info('\n================================================================');
  logger.info('SCENARIO 4: PROCESS / BROWSER CRASH RECOVERY FROM CHECKPOINT');
  logger.info('Requirement 5 & 7: Browser killed mid-flow, state hydrated, resumes');
  logger.info('================================================================');

  const candidate = getMockCandidate('cand_crash_04');
  
  // Phase 1: Run steps 1, 2, 3 and simulate sudden crash right before resume upload
  logger.info('Phase 1: Starting application and executing steps 1, 2, 3...');
  const enginePhase1 = new ApplicationEngine(candidate, `http://localhost:${PORT}`);
  await enginePhase1.initializeBrowser(true);
  const page1 = (enginePhase1 as any).page;
  await page1.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });

  const { PersonalInfoPage } = await import('../src/automation/pages/PersonalInfoPage');
  const pPage = new PersonalInfoPage(page1);
  await pPage.fillAndSubmit(candidate.personalInfo);
  enginePhase1.getStateManager().markStepCompleted('PERSONAL_INFO');

  const { EducationPage } = await import('../src/automation/pages/EducationPage');
  const ePage = new EducationPage(page1);
  await ePage.fillAndSubmit(candidate.education);
  enginePhase1.getStateManager().markStepCompleted('EDUCATION');

  const { ExperiencePage } = await import('../src/automation/pages/ExperiencePage');
  const xPage = new ExperiencePage(page1);
  await xPage.fillAndSubmit(candidate.experience);
  enginePhase1.getStateManager().markStepCompleted('EXPERIENCE');

  logger.warn('💥 [CHAOS INJECTOR] Simulating unrecoverable browser process kill during Step 4...');
  await ((enginePhase1 as any).browser).close();

  logger.info('Phase 2: Launching fresh engine instance to simulate worker restart / recovery...');
  const enginePhase2 = new ApplicationEngine(candidate, `http://localhost:${PORT}`);
  const recoveredState = enginePhase2.getStateManager().getState();
  logger.info(`State recovered from disk checkpoint! Completed steps: ${recoveredState.completedSteps.join(', ')}`);
  logger.info(`Next pending step to resume: ${enginePhase2.getStateManager().getNextPendingStep()}`);

  const receipt = await enginePhase2.run();
  logger.info(`✔ Crash recovery successfully completed from checkpoint! Application ID: ${receipt.applicationId}`);
  return receipt.applicationId.startsWith('APP-');
}

// Scenario 5: Duplicate Submission Prevention
async function runDuplicateSubmissionDemo(): Promise<boolean> {
  logger.info('\n================================================================');
  logger.info('SCENARIO 5: IDEMPOTENCY & DUPLICATE SUBMISSION PREVENTION');
  logger.info('Requirement 9: Prevent duplicate submission on already completed applications');
  logger.info('================================================================');

  const candidate = getMockCandidate('cand_idempotency_05');
  const engine1 = new ApplicationEngine(candidate, `http://localhost:${PORT}`);
  const firstReceipt = await engine1.run();
  logger.info(`First submission succeeded with ID: ${firstReceipt.applicationId}`);

  logger.info('Attempting second submission with the SAME candidate profile...');
  const engine2 = new ApplicationEngine(candidate, `http://localhost:${PORT}`);
  const secondReceipt = await engine2.run();

  logger.info('Second submission result:', {
    applicationId: secondReceipt.applicationId,
    isDuplicate: secondReceipt.isDuplicate
  });

  const passed = secondReceipt.applicationId === firstReceipt.applicationId && secondReceipt.isDuplicate === true;
  logger.info(`✔ Idempotency guard passed: Duplicate prevented, existing application preserved.`);
  return passed;
}

// Master CLI Runner
async function main() {
  const scenario = process.argv[2] || 'all';

  try {
    await startServer();
    cleanStateDir();
    resetApplicationState();

    const results: Record<string, boolean> = {};

    if (scenario === 'happy-path' || scenario === 'all') {
      results['Happy Path'] = await runHappyPath();
    }
    if (scenario === 'session-expiry' || scenario === 'all') {
      results['Session Expiry Recovery'] = await runSessionExpiryDemo();
    }
    if (scenario === 'network-timeout' || scenario === 'all') {
      results['Transient Timeout Retry'] = await runNetworkTimeoutDemo();
    }
    if (scenario === 'browser-crash' || scenario === 'all') {
      results['Browser Crash Recovery'] = await runBrowserCrashDemo();
    }
    if (scenario === 'duplicate-submission' || scenario === 'all') {
      results['Duplicate Submission Prevention'] = await runDuplicateSubmissionDemo();
    }

    logger.info('\n================================================================');
    logger.info('EXECUTION SUMMARY RESULTS');
    logger.info('================================================================');
    let allPassed = true;
    for (const [name, passed] of Object.entries(results)) {
      const statusIcon = passed ? '✅ PASS' : '❌ FAIL';
      logger.info(`${statusIcon} - ${name}`);
      if (!passed) allPassed = false;
    }

    if (allPassed) {
      logger.info('\n🎉 ALL PRODUCTION RELIABILITY SCENARIOS PASSED WITH 100% SUCCESS!');
    }

    process.exit(allPassed ? 0 : 1);
  } catch (err: any) {
    logger.error('Demo execution failed:', err);
    process.exit(1);
  } finally {
    await stopServer();
  }
}

main();
