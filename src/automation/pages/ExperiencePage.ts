import { Page } from 'playwright';
import { BasePage } from './BasePage';
import { CandidateProfile } from '../types';

export class ExperiencePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async fillAndSubmit(experience: CandidateProfile['experience']): Promise<void> {
    await this.waitForStep(3);

    await this.page.fill('#currentCompany', experience.currentCompany);
    await this.page.fill('#jobTitle', experience.jobTitle);
    await this.page.selectOption('#yearsOfExperience', experience.yearsOfExperience);
    if (experience.techStack) {
      await this.page.fill('#techStack', experience.techStack);
    }
    if (experience.responsibilities) {
      await this.page.fill('#responsibilities', experience.responsibilities);
    }

    await this.submitAndAdvance('#btn-step-3-next', 4);
  }
}
