import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, EducationRecord, JobBoardAdapter, ResumeUpload } from '../../types.js'
import { GreenhouseApplicationPage } from './GreenhouseApplicationPage.js'
import { GreenhouseJobPage } from './GreenhouseJobPage.js'

export class GreenhouseAdapter implements JobBoardAdapter {
  readonly id = 'greenhouse'
  supports(url: URL) { return GreenhouseJobPage.supports(url) }
  applicationUrl(url: URL) { return GreenhouseJobPage.applicationUrl(url) }
  async openApplication(page: Page, jobUrl: string) { return new GreenhouseJobPage(page).openApplication(jobUrl) }
  async waitForApplication(page: Page) { return new GreenhouseApplicationPage(page).waitUntilReady() }
  async extractJob(page: Page, originalUrl: string) { return new GreenhouseJobPage(page).readDetails(originalUrl) }
  async extractQuestions(page: Page) { return new GreenhouseApplicationPage(page).readQuestions() }
  async focusQuestion(page: Page, question: AdapterQuestion) { return new GreenhouseApplicationPage(page).focus(question) }
  async extractQuestionOptions(page: Page, question: AdapterQuestion) { return new GreenhouseApplicationPage(page).extractOptions(question) }
  async fillAnswer(page: Page, question: AdapterQuestion, answer: AnswerValue) { return new GreenhouseApplicationPage(page).fill(question, answer) }
  async fillEducation(page: Page, education: EducationRecord[]) { return new GreenhouseApplicationPage(page).fillEducation(education) }
  async uploadResume(page: Page, resume: ResumeUpload) { return new GreenhouseApplicationPage(page).uploadResume(resume) }
  async uploadFile(page: Page, question: AdapterQuestion, file: ResumeUpload) { return new GreenhouseApplicationPage(page).uploadFile(question, file) }
  async detectBlocker(page: Page) { return new GreenhouseApplicationPage(page).detectBlocker() }
  async isReviewReady(page: Page) { return new GreenhouseApplicationPage(page).isReadyForReview() }
  async submitApplication(page: Page) { return new GreenhouseApplicationPage(page).submit() }
}
