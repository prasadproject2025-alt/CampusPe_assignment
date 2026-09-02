import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, EducationRecord, JobBoardAdapter, ResumeUpload } from '../../types.js'
import { BreezyApplicationPage } from './BreezyApplicationPage.js'
import { BreezyJobPage } from './BreezyJobPage.js'

export class BreezyAdapter implements JobBoardAdapter {
  readonly id = 'breezy'
  supports(url: URL) { return BreezyJobPage.supports(url) }
  applicationUrl(url: URL) { return BreezyJobPage.applicationUrl(url) }
  async openApplication(page: Page, jobUrl: string) { return new BreezyJobPage(page).openApplication(jobUrl) }
  async waitForApplication(page: Page) { return new BreezyApplicationPage(page).waitUntilReady() }
  async extractJob(page: Page, originalUrl: string) { return new BreezyJobPage(page).readDetails(originalUrl) }
  async extractQuestions(page: Page) { return new BreezyApplicationPage(page).readQuestions() }
  async focusQuestion(page: Page, question: AdapterQuestion) { return new BreezyApplicationPage(page).focus(question) }
  async fillAnswer(page: Page, question: AdapterQuestion, answer: AnswerValue) { return new BreezyApplicationPage(page).fill(question, answer) }
  async fillEducation(page: Page, education: EducationRecord[]) { return new BreezyApplicationPage(page).fillEducation(education) }
  async uploadResume(page: Page, resume: ResumeUpload) { return new BreezyApplicationPage(page).uploadResume(resume) }
  async uploadFile(page: Page, question: AdapterQuestion, file: ResumeUpload) { return new BreezyApplicationPage(page).uploadFile(question, file) }
  async detectBlocker(page: Page) { return new BreezyApplicationPage(page).detectBlocker() }
  async isReviewReady(page: Page) { return new BreezyApplicationPage(page).isReadyForReview() }
  async submitApplication(page: Page) { return new BreezyApplicationPage(page).submit() }
}
