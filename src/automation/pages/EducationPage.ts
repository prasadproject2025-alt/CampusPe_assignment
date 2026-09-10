import { Page } from 'playwright';
import { BasePage } from './BasePage';
import { CandidateProfile } from '../types';

export class EducationPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async fillAndSubmit(education: CandidateProfile['education']): Promise<void> {
    await this.waitForStep(2);

    await this.page.selectOption('#degree', { label: education.degree });
    await this.page.fill('#institution', education.institution);
    if (education.fieldOfStudy) {
      await this.page.fill('#fieldOfStudy', education.fieldOfStudy);
    }
    await this.page.selectOption('#graduationYear', education.graduationYear);
    if (education.gpa) {
      await this.page.fill('#gpa', education.gpa);
    }

    await this.submitAndAdvance('#btn-step-2-next', 3);
  }
}
