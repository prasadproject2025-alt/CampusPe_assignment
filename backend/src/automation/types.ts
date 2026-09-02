import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { AnswerValue, FieldType, FormQuestion, JobContext } from '../resolver/types.js'

export type AutomationStatus = 'QUEUED' | 'OPENING_JOB' | 'EXTRACTING_JOB' | 'FILLING_APPLICATION' | 'PAUSED_BY_USER' | 'PAUSED_NEEDS_INPUT' | 'PAUSED_LOGIN' | 'PAUSED_CAPTCHA' | 'READY_FOR_REVIEW' | 'SUBMITTING' | 'SUBMITTED' | 'FAILED'

export type JobDetails = JobContext & {
  postingId: string | null
  url: string
  location?: string
  employmentType?: string
  workplaceType?: string
  compensation?: string
}

export type AdapterQuestion = FormQuestion & {
  locator: { kind: 'field'; value: string } | { kind: 'education'; value: string }
  answered: boolean
  inputType?: string
}

export type Blocker = { type: 'LOGIN' | 'CAPTCHA'; message: string }
export type EducationRecord = { school: string; degree: string; field: string; startDate: string; endDate: string; current?: boolean }
export type ResumeUpload = { name: string; mimeType: string; buffer: Buffer }

export interface JobBoardAdapter {
  readonly id: string
  supports(url: URL): boolean
  applicationUrl(url: URL): URL
  openApplication(page: Page, jobUrl: string): Promise<void>
  waitForApplication(page: Page): Promise<void>
  extractJob(page: Page, originalUrl: string): Promise<JobDetails>
  extractQuestions(page: Page): Promise<AdapterQuestion[]>
  focusQuestion(page: Page, question: AdapterQuestion): Promise<void>
  extractQuestionOptions?(page: Page, question: AdapterQuestion): Promise<string[]>
  fillAnswer(page: Page, question: AdapterQuestion, answer: AnswerValue): Promise<void>
  fillEducation(page: Page, education: EducationRecord[]): Promise<void>
  uploadResume(page: Page, resume: ResumeUpload): Promise<void>
  waitForResumeParsing?(page: Page): Promise<void>
  uploadFile(page: Page, question: AdapterQuestion, file: ResumeUpload): Promise<void>
  detectBlocker(page: Page): Promise<Blocker | null>
  isReviewReady(page: Page): Promise<boolean>
  submitApplication(page: Page): Promise<void>
}

export type ActiveRun = { browser: Browser; context: BrowserContext; page: Page; processing: boolean }
