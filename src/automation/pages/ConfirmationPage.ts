import { Page } from 'playwright';
import { BasePage } from './BasePage';

export interface ConfirmationReceipt {
  applicationId: string;
  candidateName: string;
  email: string;
  timestamp: string;
  isDuplicate: boolean;
}

export class ConfirmationPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async getReceipt(timeoutMs: number = 10000): Promise<ConfirmationReceipt> {
    await this.waitForStep(6, timeoutMs);

    const appId = await this.page.locator('#confirm-app-id').innerText();
    const candidateName = await this.page.locator('#confirm-name').innerText();
    const email = await this.page.locator('#confirm-email').innerText();
    const timestamp = await this.page.locator('#confirm-timestamp').innerText();
    const isDuplicate = await this.page.locator('#duplicate-warning-banner').isVisible();

    return {
      applicationId: appId.trim(),
      candidateName: candidateName.trim(),
      email: email.trim(),
      timestamp: timestamp.trim(),
      isDuplicate
    };
  }
}
