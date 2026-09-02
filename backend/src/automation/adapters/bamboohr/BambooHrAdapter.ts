import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, EducationRecord, JobBoardAdapter, ResumeUpload } from '../../types.js'
import { BambooHrApplicationPage } from './BambooHrApplicationPage.js'
import { BambooHrJobPage } from './BambooHrJobPage.js'
export class BambooHrAdapter implements JobBoardAdapter {
  readonly id = 'bamboohr'
  supports(url: URL) { return BambooHrJobPage.supports(url) }
  applicationUrl(url: URL) { return BambooHrJobPage.applicationUrl(url) }
  async openApplication(page: Page, url: string) { return new BambooHrJobPage(page).openApplication(url) }
  async waitForApplication(page: Page) { return new BambooHrApplicationPage(page).waitUntilReady() }
  async extractJob(page: Page, url: string) { return new BambooHrJobPage(page).readDetails(url) }
  async extractQuestions(page: Page) { return new BambooHrApplicationPage(page).readQuestions() }
  async focusQuestion(page: Page, q: AdapterQuestion) { return new BambooHrApplicationPage(page).focus(q) }
  async fillAnswer(page: Page, q: AdapterQuestion, a: AnswerValue) { return new BambooHrApplicationPage(page).fill(q, a) }
  async fillEducation(page: Page, e: EducationRecord[]) { return new BambooHrApplicationPage(page).fillEducation(e) }
  async uploadResume(page: Page, r: ResumeUpload) { return new BambooHrApplicationPage(page).uploadResume(r) }
  async waitForResumeParsing(page: Page) { return new BambooHrApplicationPage(page).waitForResumeParsing() }
  async uploadFile(page: Page, q: AdapterQuestion, f: ResumeUpload) { return new BambooHrApplicationPage(page).uploadFile(q, f) }
  async detectBlocker(page: Page) { return new BambooHrApplicationPage(page).detectBlocker() }
  async isReviewReady(page: Page) { return new BambooHrApplicationPage(page).isReadyForReview() }
  async submitApplication(page: Page) { return new BambooHrApplicationPage(page).submit() }
}
