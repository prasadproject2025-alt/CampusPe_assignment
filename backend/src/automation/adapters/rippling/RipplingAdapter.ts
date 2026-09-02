import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, EducationRecord, JobBoardAdapter, ResumeUpload } from '../../types.js'
import { RipplingApplicationPage } from './RipplingApplicationPage.js'
import { RipplingJobPage } from './RipplingJobPage.js'

export class RipplingAdapter implements JobBoardAdapter {
  readonly id = 'rippling'
  supports(url: URL) { return RipplingJobPage.supports(url) }
  applicationUrl(url: URL) { return RipplingJobPage.applicationUrl(url) }
  async openApplication(page: Page, jobUrl: string) { return new RipplingJobPage(page).openApplication(jobUrl) }
  async waitForApplication(page: Page) { return new RipplingApplicationPage(page).waitUntilReady() }
  async extractJob(page: Page, originalUrl: string) { return new RipplingJobPage(page).readDetails(originalUrl) }
  async extractQuestions(page: Page) { return new RipplingApplicationPage(page).readQuestions() }
  async focusQuestion(page: Page, question: AdapterQuestion) { return new RipplingApplicationPage(page).focus(question) }
  async extractQuestionOptions(page: Page, question: AdapterQuestion) { return new RipplingApplicationPage(page).readOptions(question) }
  async fillAnswer(page: Page, question: AdapterQuestion, answer: AnswerValue) { return new RipplingApplicationPage(page).fill(question, answer) }
  async fillEducation(page: Page, education: EducationRecord[]) { return new RipplingApplicationPage(page).fillEducation(education) }
  async uploadResume(page: Page, resume: ResumeUpload) { return new RipplingApplicationPage(page).uploadResume(resume) }
  async uploadFile(page: Page, question: AdapterQuestion, file: ResumeUpload) { return new RipplingApplicationPage(page).uploadFile(question, file) }
  async detectBlocker(page: Page) { return new RipplingApplicationPage(page).detectBlocker() }
  async isReviewReady(page: Page) { return new RipplingApplicationPage(page).isReadyForReview() }
  async submitApplication(page: Page) { return new RipplingApplicationPage(page).submit() }
}
