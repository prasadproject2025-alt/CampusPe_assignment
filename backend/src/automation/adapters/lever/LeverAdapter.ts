import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, EducationRecord, JobBoardAdapter, ResumeUpload } from '../../types.js'
import { LeverApplicationPage } from './LeverApplicationPage.js'
import { LeverJobPage } from './LeverJobPage.js'

export class LeverAdapter implements JobBoardAdapter {
  readonly id = 'lever'
  supports(url: URL) { return LeverJobPage.supports(url) }
  applicationUrl(url: URL) { return LeverJobPage.applicationUrl(url) }
  async openApplication(page: Page, jobUrl: string) { return new LeverJobPage(page).openApplication(jobUrl) }
  async waitForApplication(page: Page) { return new LeverApplicationPage(page).waitUntilReady() }
  async extractJob(page: Page, originalUrl: string) { return new LeverJobPage(page).readDetails(originalUrl) }
  async extractQuestions(page: Page) { return new LeverApplicationPage(page).readQuestions() }
  async focusQuestion(page: Page, question: AdapterQuestion) { return new LeverApplicationPage(page).focus(question) }
  async fillAnswer(page: Page, question: AdapterQuestion, answer: AnswerValue) { return new LeverApplicationPage(page).fill(question, answer) }
  async fillEducation(page: Page, education: EducationRecord[]) { return new LeverApplicationPage(page).fillEducation(education) }
  async uploadResume(page: Page, resume: ResumeUpload) { return new LeverApplicationPage(page).uploadResume(resume) }
  async waitForResumeParsing(page: Page) { return new LeverApplicationPage(page).waitForResumeParsing() }
  async uploadFile(page: Page, question: AdapterQuestion, file: ResumeUpload) { return new LeverApplicationPage(page).uploadFile(question, file) }
  async detectBlocker(page: Page) { return new LeverApplicationPage(page).detectBlocker() }
  async isReviewReady(page: Page) { return new LeverApplicationPage(page).isReadyForReview() }
  async submitApplication(page: Page) { return new LeverApplicationPage(page).submit() }
}
