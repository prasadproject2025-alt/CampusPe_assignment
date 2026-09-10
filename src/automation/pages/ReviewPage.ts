import { Page } from 'playwright';
import { BasePage } from './BasePage';

export class ReviewPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async verifyAndSubmit(): Promise<void> {
    await this.waitForStep(5);

    // Verify key fields are populated on review card
    const emailText = await this.page.locator('#rev-email').innerText();
    if (!emailText || emailText === '-') {
      throw new Error('Review validation failed: Candidate email was empty on review screen.');
    }

    // Click submit button and verify advance to step 6 (confirmation)
    await this.submitAndAdvance('#btn-submit-application', 6, 12000);
  }
}
