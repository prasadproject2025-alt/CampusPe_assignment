import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, EducationRecord, JobBoardAdapter, ResumeUpload } from '../../types.js'
import { WorkableApplicationPage } from './WorkableApplicationPage.js'
import { WorkableJobPage } from './WorkableJobPage.js'

export class WorkableAdapter implements JobBoardAdapter {
  readonly id = 'workable'
  supports(url: URL) { return WorkableJobPage.supports(url) }
  applicationUrl(url: URL) { return WorkableJobPage.applicationUrl(url) }
  async openApplication(page: Page, jobUrl: string) { return new WorkableJobPage(page).openApplication(jobUrl) }
  async waitForApplication(page: Page) { return new WorkableApplicationPage(page).waitUntilReady() }
  async extractJob(page: Page, originalUrl: string) { return new WorkableJobPage(page).readDetails(originalUrl) }
  async extractQuestions(page: Page) { return new WorkableApplicationPage(page).readQuestions() }
  async focusQuestion(page: Page, question: AdapterQuestion) { return new WorkableApplicationPage(page).focus(question) }
  async fillAnswer(page: Page, question: AdapterQuestion, answer: AnswerValue) { return new WorkableApplicationPage(page).fill(question, answer) }
  async fillEducation(page: Page, education: EducationRecord[]) { return new WorkableApplicationPage(page).fillEducation(education) }
  async uploadResume(page: Page, resume: ResumeUpload) { return new WorkableApplicationPage(page).uploadResume(resume) }
  async waitForResumeParsing(page: Page) { return new WorkableApplicationPage(page).waitForResumeParsing() }
  async uploadFile(page: Page, question: AdapterQuestion, file: ResumeUpload) { return new WorkableApplicationPage(page).uploadFile(question, file) }
  async detectBlocker(page: Page) { return new WorkableApplicationPage(page).detectBlocker() }
  async isReviewReady(page: Page) { return new WorkableApplicationPage(page).isReadyForReview() }
  async submitApplication(page: Page) { return new WorkableApplicationPage(page).submit() }
}
