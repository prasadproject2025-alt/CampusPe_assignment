import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, EducationRecord, JobBoardAdapter, ResumeUpload } from '../../types.js'
import { AshbyApplicationPage } from './AshbyApplicationPage.js'
import { AshbyJobPage } from './AshbyJobPage.js'

export class AshbyAdapter implements JobBoardAdapter {
  readonly id = 'ashby'
  supports(url: URL) { return AshbyJobPage.supports(url) }
  applicationUrl(url: URL) { return AshbyJobPage.applicationUrl(url) }
  async openApplication(page: Page, jobUrl: string) { return new AshbyJobPage(page).openApplication(jobUrl) }
  async waitForApplication(page: Page) { return new AshbyApplicationPage(page).waitUntilReady() }
  async extractJob(page: Page, originalUrl: string) { return new AshbyJobPage(page).readDetails(originalUrl) }
  async extractQuestions(page: Page) { return new AshbyApplicationPage(page).readQuestions() }
  async focusQuestion(page: Page, question: AdapterQuestion) { return new AshbyApplicationPage(page).focus(question) }
  async fillAnswer(page: Page, question: AdapterQuestion, answer: AnswerValue) { return new AshbyApplicationPage(page).fill(question, answer) }
  async fillEducation(page: Page, education: EducationRecord[]) { return new AshbyApplicationPage(page).fillEducation(education) }
  async uploadResume(page: Page, resume: ResumeUpload) { return new AshbyApplicationPage(page).uploadResume(resume) }
  async uploadFile(page: Page, question: AdapterQuestion, file: ResumeUpload) { return new AshbyApplicationPage(page).uploadFile(question, file) }
  async detectBlocker(page: Page) { return new AshbyApplicationPage(page).detectBlocker() }
  async isReviewReady(page: Page) { return new AshbyApplicationPage(page).isReadyForReview() }
  async submitApplication(page: Page) { return new AshbyApplicationPage(page).submit() }
}
