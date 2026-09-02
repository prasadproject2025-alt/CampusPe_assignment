import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, EducationRecord, JobBoardAdapter, ResumeUpload } from '../../types.js'
import { RecruiteeApplicationPage } from './RecruiteeApplicationPage.js'
import { RecruiteeJobPage } from './RecruiteeJobPage.js'
export class RecruiteeAdapter implements JobBoardAdapter {
  readonly id = 'recruitee'
  supports(url: URL) { return RecruiteeJobPage.supports(url) }
  applicationUrl(url: URL) { return RecruiteeJobPage.applicationUrl(url) }
  async openApplication(page: Page, url: string) { return new RecruiteeJobPage(page).openApplication(url) }
  async waitForApplication(page: Page) { return new RecruiteeApplicationPage(page).waitUntilReady() }
  async extractJob(page: Page, url: string) { return new RecruiteeJobPage(page).readDetails(url) }
  async extractQuestions(page: Page) { return new RecruiteeApplicationPage(page).readQuestions() }
  async focusQuestion(page: Page, q: AdapterQuestion) { return new RecruiteeApplicationPage(page).focus(q) }
  async fillAnswer(page: Page, q: AdapterQuestion, a: AnswerValue) { return new RecruiteeApplicationPage(page).fill(q, a) }
  async fillEducation(page: Page, e: EducationRecord[]) { return new RecruiteeApplicationPage(page).fillEducation(e) }
  async uploadResume(page: Page, r: ResumeUpload) { return new RecruiteeApplicationPage(page).uploadResume(r) }
  async waitForResumeParsing(page: Page) { return new RecruiteeApplicationPage(page).waitForResumeParsing() }
  async uploadFile(page: Page, q: AdapterQuestion, f: ResumeUpload) { return new RecruiteeApplicationPage(page).uploadFile(q, f) }
  async detectBlocker(page: Page) { return new RecruiteeApplicationPage(page).detectBlocker() }
  async isReviewReady(page: Page) { return new RecruiteeApplicationPage(page).isReadyForReview() }
  async submitApplication(page: Page) { return new RecruiteeApplicationPage(page).submit() }
}
