import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { logger, logRecovery } from '../logger';
import { StateManager } from '../state-manager';
import { CandidateProfile, STEP_ORDER, StepName } from '../types';

export class CrashRecovery {
  public static async recoverFromCrash(params: {
    browser?: Browser;
    baseUrl: string;
    candidate: CandidateProfile;
    stateManager: StateManager;
    headless?: boolean;
  }): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    const { baseUrl, candidate, stateManager, headless = true } = params;
    const currentState = stateManager.getState();
    const resumeStep = currentState.currentStep;
    const resumeStepIndex = STEP_ORDER.indexOf(resumeStep) + 1;

    logRecovery(resumeStep, `Browser crash detected! Initiating automated crash recovery from disk checkpoint.`);
    stateManager.markRecovery(resumeStep, 'Browser crash respawn');

    // 1. Ensure any lingering browser process is cleaned up
    if (params.browser) {
      try {
        await params.browser.close();
      } catch {
        // Expected if process already died
      }
    }

    // 2. Launch fresh browser instance
    logger.info('Launching new Chromium browser instance...');
    const newBrowser = await chromium.launch({
      headless,
      args: ['--disable-dev-shm-usage', '--no-sandbox']
    });

    const context = await newBrowser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    // 3. Navigate to portal
    logger.info(`Navigating to ${baseUrl}...`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    // 4. Authenticate in the new session
    logger.info(`Re-authenticating session for ${candidate.personalInfo.email}...`);
    const loginRes = await context.request.post(`${baseUrl}/api/auth/login`, {
      data: {
        email: candidate.personalInfo.email,
        name: candidate.personalInfo.fullName
      }
    });

    if (!loginRes.ok()) {
      throw new Error(`Crash recovery login failed: ${loginRes.status()}`);
    }

    // 5. Restore application draft from server
    logger.info(`Restoring application draft and advancing directly to pending step [${resumeStep}] (Step #${resumeStepIndex})...`);
    await page.reload({ waitUntil: 'networkidle' });

    // Navigate wizard to the pending step
    await page.evaluate((targetStep) => {
      if ((window as any).app && (window as any).app.goToStep) {
        (window as any).app.goToStep(targetStep);
      }
    }, resumeStepIndex);

    await page.locator(`#step-pane-${resumeStepIndex}`).waitFor({ state: 'visible', timeout: 8000 });
    logRecovery(resumeStep, `Crash recovery successful! Browser and session recreated, resumed at step [${resumeStep}].`);

    return { browser: newBrowser, context, page };
  }
}
