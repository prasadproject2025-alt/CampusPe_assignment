import { Page } from 'playwright';
import { BasePage } from './BasePage';
import { CandidateProfile } from '../types';
import fs from 'fs';

export class ResumeUploadPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  public async uploadAndSubmit(resume: CandidateProfile['resume']): Promise<void> {
    await this.waitForStep(4);

    if (!fs.existsSync(resume.filePath)) {
      throw new Error(`Resume file not found at path: ${resume.filePath}`);
    }

    // Set file via Playwright input file chooser
    await this.page.setInputFiles('#resumeFile', resume.filePath);

    // Verify file-info-card is visible
    await this.page.locator('#file-info-card').waitFor({ state: 'visible', timeout: 5000 });

    await this.submitAndAdvance('#btn-step-4-next', 5);
  }
}
