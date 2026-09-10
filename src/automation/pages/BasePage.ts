import { Page, Locator } from 'playwright';
import { logger } from '../logger';
import path from 'path';
import fs from 'fs';

export abstract class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  public async isSessionExpiredModalVisible(): Promise<boolean> {
    const modal = this.page.locator('#session-modal');
    return await modal.isVisible();
  }

  public async getAlertMessage(): Promise<string | null> {
    const alertBox = this.page.locator('#alert-box');
    if (await alertBox.isVisible()) {
      return await this.page.locator('#alert-message').innerText();
    }
    return null;
  }

  public async isStepActive(stepNumber: number): Promise<boolean> {
    const pane = this.page.locator(`#step-pane-${stepNumber}`);
    return await pane.isVisible();
  }

  public async waitForStep(stepNumber: number, timeoutMs: number = 10000): Promise<void> {
    await this.page.locator(`#step-pane-${stepNumber}`).waitFor({ state: 'visible', timeout: timeoutMs });
  }

  public async submitAndAdvance(buttonSelector: string, nextStepNumber: number, timeoutMs: number = 8000): Promise<void> {
    await this.page.click(buttonSelector);

    // Wait for next step or check if error alert appeared
    try {
      await this.page.locator(`#step-pane-${nextStepNumber}`).waitFor({ state: 'visible', timeout: timeoutMs });
    } catch (err: any) {
      const alertMsg = await this.getAlertMessage();
      if (alertMsg) {
        throw new Error(`Step transition failed with server message: ${alertMsg}`);
      }
      throw err;
    }
  }

  public async captureScreenshot(name: string): Promise<string> {
    const dir = path.join(process.cwd(), 'artifacts', 'screenshots');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const timestamp = Date.now();
    const screenshotPath = path.join(dir, `${name}_${timestamp}.png`);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info(`Captured failure screenshot at: ${screenshotPath}`);
    return screenshotPath;
  }
}
