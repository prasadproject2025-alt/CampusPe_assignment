import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { CandidateProfile, ResilienceConfig, StepName, STEP_ORDER } from './types';
import { StateManager } from './state-manager';
import { logger, logStep, logFailure } from './logger';
import { SessionManager } from './resilience/SessionManager';
import { RetryHandler } from './resilience/RetryHandler';
import { CrashRecovery } from './resilience/CrashRecovery';
import { IdempotencyGuard } from './resilience/IdempotencyGuard';
import { PersonalInfoPage } from './pages/PersonalInfoPage';
import { EducationPage } from './pages/EducationPage';
import { ExperiencePage } from './pages/ExperiencePage';
import { ResumeUploadPage } from './pages/ResumeUploadPage';
import { ReviewPage } from './pages/ReviewPage';
import { ConfirmationPage, ConfirmationReceipt } from './pages/ConfirmationPage';
import path from 'path';
import fs from 'fs';

export class ApplicationEngine {
  private candidate: CandidateProfile;
  private baseUrl: string;
  private config: ResilienceConfig;
  private stateManager: StateManager;
  private idempotencyGuard: IdempotencyGuard;

  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private sessionManager?: SessionManager;

  constructor(
    candidate: CandidateProfile,
    baseUrl: string = 'http://localhost:3000',
    configPartial: Partial<ResilienceConfig> = {}
  ) {
    this.candidate = candidate;
    this.baseUrl = baseUrl;
    this.config = {
      maxRetries: 3,
      baseRetryDelayMs: 1000,
      maxRetryDelayMs: 5000,
      actionTimeoutMs: 10000,
      navigationTimeoutMs: 30000,
      enableTracing: true,
      enableScreenshotsOnFailure: true,
      traceDir: path.join(process.cwd(), 'artifacts', 'traces'),
      screenshotDir: path.join(process.cwd(), 'artifacts', 'screenshots'),
      stateDir: path.join(process.cwd(), 'state'),
      ...configPartial
    };

    this.stateManager = new StateManager(candidate, this.config.stateDir);
    this.idempotencyGuard = new IdempotencyGuard(this.stateManager);
  }

  public async initializeBrowser(headless?: boolean): Promise<void> {
    if (!fs.existsSync(this.config.traceDir)) fs.mkdirSync(this.config.traceDir, { recursive: true });
    if (!fs.existsSync(this.config.screenshotDir)) fs.mkdirSync(this.config.screenshotDir, { recursive: true });

    const isHeadless = headless !== undefined ? headless : (process.env.HEADED !== 'true' && !process.argv.includes('--headed'));
    const slowMo = isHeadless ? 0 : 600; // 600ms slow motion when headed to clearly watch live actions on screen

    logger.info(`Initializing Playwright Chromium browser (headless: ${isHeadless}) for candidate ${this.candidate.candidateId}...`);
    this.browser = await chromium.launch({
      headless: isHeadless,
      slowMo,
      args: ['--disable-dev-shm-usage', '--no-sandbox']
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 }
    });

    if (this.config.enableTracing) {
      try {
        await this.context.tracing.start({ screenshots: true, snapshots: true });
      } catch {
        // Tracing may already be active from outer runner
      }
    }

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.actionTimeoutMs);
    this.page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

    // Attach crash listener
    this.page.on('crash', async () => {
      logger.error('CRITICAL: Page crashed during execution!');
    });

    this.sessionManager = new SessionManager(this.page, this.context, this.candidate, this.baseUrl, this.stateManager);
  }

  public async run(): Promise<ConfirmationReceipt> {
    const startTime = Date.now();
    logger.info(`=== Starting Application Flow for [${this.candidate.personalInfo.fullName}] ===`);

    // 1. Check Idempotency before doing any work
    if (this.idempotencyGuard.shouldBlockSubmission()) {
      const existing = this.stateManager.getState().submissionReceipt;
      if (existing) {
        logger.info(`Returning cached submission receipt for application ${existing.applicationId}`);
        return {
          applicationId: existing.applicationId,
          candidateName: this.candidate.personalInfo.fullName,
          email: this.candidate.personalInfo.email,
          timestamp: existing.submittedAt,
          isDuplicate: true
        };
      }
    }

    try {
      if (!this.browser || !this.page) {
        await this.initializeBrowser();
      }

      // Navigate to portal
      await this.page!.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });

      // Run each step statefully
      for (const step of STEP_ORDER) {
        if (this.stateManager.isStepCompleted(step)) {
          logger.info(`Step [${step}] already verified as COMPLETED in state checkpoint. Skipping.`);
          continue;
        }

        await this.executeStepWithResilience(step);
      }

      // Extract final receipt
      const confirmationPage = new ConfirmationPage(this.page!);
      const receipt = await confirmationPage.getReceipt();

      this.stateManager.markSubmitted({
        applicationId: receipt.applicationId,
        submittedAt: receipt.timestamp,
        isDuplicate: receipt.isDuplicate
      });

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`=== Application Flow COMPLETED Successfully in ${totalDuration}s ===`, {
        applicationId: receipt.applicationId,
        isDuplicate: receipt.isDuplicate
      });

      // Save trace
      if (this.config.enableTracing && this.context) {
        const traceFile = path.join(this.config.traceDir, `trace_${this.candidate.candidateId}.zip`);
        try {
          await this.context.tracing.stop({ path: traceFile });
          logger.info(`Playwright execution trace saved to: ${traceFile}`);
        } catch {
          // Ignore if managed by outer runner
        }
      }

      return receipt;
    } catch (err: any) {
      logFailure('ENGINE_ROOT', err);

      if (this.page && this.config.enableScreenshotsOnFailure) {
        const failurePic = path.join(this.config.screenshotDir, `failure_${this.candidate.candidateId}_${Date.now()}.png`);
        await this.page.screenshot({ path: failurePic, fullPage: true }).catch(() => {});
        logger.info(`Failure screenshot captured: ${failurePic}`);
      }

      if (this.config.enableTracing && this.context) {
        const traceFile = path.join(this.config.traceDir, `failure_trace_${this.candidate.candidateId}.zip`);
        try {
          await this.context.tracing.stop({ path: traceFile });
          logger.info(`Failure trace saved: ${traceFile}`);
        } catch {
          // Ignore
        }
      }

      throw err;
    } finally {
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
    }
  }

  private async executeStepWithResilience(step: StepName): Promise<void> {
    const stepNumber = STEP_ORDER.indexOf(step) + 1;
    this.stateManager.markStepStarted(step);
    logStep(step, `Executing Step #${stepNumber} [${step}]`);

    await RetryHandler.executeWithRetry(
      `Step_${step}`,
      async (attempt) => {
        try {
          // Pre-flight check: Did session expire?
          if (await this.sessionManager!.isSessionExpired(stepNumber)) {
            await this.sessionManager!.recoverSession(stepNumber, step);
          }

          // Execute step logic
          await this.dispatchStepAction(step);

          // Post-flight check: Did the submit cause an expiry modal or 401?
          if (await this.sessionManager!.isSessionExpired(stepNumber)) {
            await this.sessionManager!.recoverSession(stepNumber, step);
            // Re-attempt step action if needed
            await this.dispatchStepAction(step);
          }

          this.stateManager.markStepCompleted(step);
        } catch (error: any) {
          // Check if session expired caused this error
          const isExpired = await this.sessionManager!.isSessionExpired(stepNumber).catch(() => false);
          if (isExpired) {
            await this.sessionManager!.recoverSession(stepNumber, step);
            // Re-run step after session restored
            await this.dispatchStepAction(step);
            this.stateManager.markStepCompleted(step);
            return;
          }

          // Check if page or browser crashed
          if (error.message && (error.message.includes('crash') || error.message.includes('Target closed') || error.message.includes('browser has been closed'))) {
            logger.warn(`Crash detected during step [${step}]. Respawning browser environment...`);
            const recovered = await CrashRecovery.recoverFromCrash({
              browser: this.browser,
              baseUrl: this.baseUrl,
              candidate: this.candidate,
              stateManager: this.stateManager
            });
            this.browser = recovered.browser;
            this.context = recovered.context;
            this.page = recovered.page;
            this.sessionManager!.updatePageAndContext(this.page, this.context);

            // Re-dispatch step on fresh page
            await this.dispatchStepAction(step);
            this.stateManager.markStepCompleted(step);
            return;
          }

          this.stateManager.markStepFailed(step, error.message);
          throw error;
        }
      },
      {
        maxRetries: this.config.maxRetries,
        baseDelayMs: this.config.baseRetryDelayMs,
        maxDelayMs: this.config.maxRetryDelayMs
      }
    );
  }

  private async dispatchStepAction(step: StepName): Promise<void> {
    const page = this.page!;

    switch (step) {
      case 'PERSONAL_INFO': {
        const pPage = new PersonalInfoPage(page);
        await pPage.fillAndSubmit(this.candidate.personalInfo);
        break;
      }
      case 'EDUCATION': {
        const ePage = new EducationPage(page);
        await ePage.fillAndSubmit(this.candidate.education);
        break;
      }
      case 'EXPERIENCE': {
        const xPage = new ExperiencePage(page);
        await xPage.fillAndSubmit(this.candidate.experience);
        break;
      }
      case 'RESUME_UPLOAD': {
        const rPage = new ResumeUploadPage(page);
        await rPage.uploadAndSubmit(this.candidate.resume);
        break;
      }
      case 'REVIEW': {
        const revPage = new ReviewPage(page);
        await revPage.verifyAndSubmit();
        break;
      }
      case 'SUBMIT': {
        // Confirmation page handles verification of submission status
        const cPage = new ConfirmationPage(page);
        await cPage.getReceipt();
        break;
      }
    }
  }

  public getStateManager(): StateManager {
    return this.stateManager;
  }
}
