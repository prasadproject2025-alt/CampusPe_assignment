import { Page, BrowserContext } from 'playwright';
import { logger, logRecovery } from '../logger';
import { CandidateProfile, StepName } from '../types';
import { StateManager } from '../state-manager';

export class SessionManager {
  private page: Page;
  private context: BrowserContext;
  private candidate: CandidateProfile;
  private baseUrl: string;
  private stateManager?: StateManager;
  private isRecovering: boolean = false;

  constructor(page: Page, context: BrowserContext, candidate: CandidateProfile, baseUrl: string, stateManager?: StateManager) {
    this.page = page;
    this.context = context;
    this.candidate = candidate;
    this.baseUrl = baseUrl;
    this.stateManager = stateManager;
  }

  public updatePageAndContext(page: Page, context: BrowserContext): void {
    this.page = page;
    this.context = context;
  }

  /**
   * Checks if session has expired either via modal presence or API response check
   */
  public async isSessionExpired(stepNumber?: number): Promise<boolean> {
    try {
      const modal = this.page.locator('#session-modal');
      if (await modal.isVisible({ timeout: 500 }).catch(() => false)) {
        return true;
      }

      // Check session status API directly only if past step 1 (where auth is initialized)
      if (stepNumber && stepNumber > 1) {
        const sessionRes = await this.context.request.get(`${this.baseUrl}/api/auth/session`).catch(() => null);
        if (sessionRes && sessionRes.status() === 401) {
          return true;
        }
      }
    } catch {
      // Ignore transient errors
    }
    return false;
  }

  /**
   * Re-authenticates without losing application state, and resumes at the target step
   */
  public async recoverSession(resumeStepNumber: number, stepName: StepName): Promise<boolean> {
    if (this.isRecovering) return false;
    this.isRecovering = true;

    try {
      logRecovery(stepName, `Detected expired session during step [${stepName}]. Initiating re-authentication recovery.`);

      // 1. Check if the modal is currently open on page
      const modal = this.page.locator('#session-modal');
      const isModalVisible = await modal.isVisible({ timeout: 1000 }).catch(() => false);

      if (isModalVisible) {
        logger.info('Session expiry modal detected on UI. Triggering modal re-authentication...');
        await this.page.click('#btn-reauth-submit');
        // Wait for modal to disappear
        await modal.waitFor({ state: 'hidden', timeout: 5000 });
      } else {
        // 2. Perform direct API re-authentication
        logger.info(`Re-authenticating via API login for ${this.candidate.personalInfo.email}...`);
        const loginRes = await this.context.request.post(`${this.baseUrl}/api/auth/login`, {
          data: {
            email: this.candidate.personalInfo.email,
            name: this.candidate.personalInfo.fullName
          }
        });

        if (!loginRes.ok()) {
          throw new Error(`Re-authentication failed with status: ${loginRes.status()}`);
        }
      }

      // 3. Resume directly to the failed step via client-side wizard controller
      logger.info(`Session restored. Resuming directly to step [${stepName}] (Step #${resumeStepNumber}) without restarting application.`);
      await this.page.evaluate((stepNum) => {
        if ((window as any).app && (window as any).app.goToStep) {
          (window as any).app.goToStep(stepNum);
        }
      }, resumeStepNumber);

      // 4. Verify step pane is active again
      await this.page.locator(`#step-pane-${resumeStepNumber}`).waitFor({ state: 'visible', timeout: 5000 });
      if (this.stateManager) {
        this.stateManager.markRecovery(stepName, 'Session re-authenticated after expiry');
      }
      logRecovery(stepName, `Successfully recovered session and resumed at step [${stepName}]!`);
      return true;
    } catch (err: any) {
      logger.error(`Session recovery failed: ${err.message}`);
      throw err;
    } finally {
      this.isRecovering = false;
    }
  }
}
