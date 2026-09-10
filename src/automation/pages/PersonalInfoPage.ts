import { Page } from 'playwright';
import { BasePage } from './BasePage';
import { CandidateProfile } from '../types';

export class PersonalInfoPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async fillAndSubmit(personalInfo: CandidateProfile['personalInfo']): Promise<void> {
    await this.waitForStep(1);

    await this.page.fill('#fullName', personalInfo.fullName);
    await this.page.fill('#email', personalInfo.email);
    await this.page.fill('#phone', personalInfo.phone);

    if (personalInfo.location) {
      await this.page.fill('#location', personalInfo.location);
    }
    if (personalInfo.linkedIn) {
      await this.page.fill('#linkedIn', personalInfo.linkedIn);
    }
    if (personalInfo.portfolio) {
      await this.page.fill('#portfolio', personalInfo.portfolio);
    }

    await this.submitAndAdvance('#btn-step-1-next', 2);
  }
}
