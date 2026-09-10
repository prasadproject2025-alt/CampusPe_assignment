import { ApplicationDraft } from './types';
import { v4 as uuidv4 } from 'uuid';

// In-memory application drafts mapped by user email + jobId, and by applicationId
const draftsByCandidateAndJob = new Map<string, ApplicationDraft>();
const draftsById = new Map<string, ApplicationDraft>();
// Deduplication registry for submitted applications: Map<idempotencyKey, ApplicationDraft>
const idempotencyRegistry = new Map<string, ApplicationDraft>();
const submittedApplications = new Map<string, ApplicationDraft>();

export function getOrCreateDraft(userId: string, email: string, jobId: string = 'SWE-2026-IN'): ApplicationDraft {
  const key = `${email.toLowerCase()}_${jobId}`;
  let draft = draftsByCandidateAndJob.get(key);

  if (!draft) {
    const applicationId = `APP-${uuidv4().substring(0, 8).toUpperCase()}`;
    draft = {
      applicationId,
      userId,
      jobId,
      currentStep: 1,
      status: 'DRAFT',
      updatedAt: new Date().toISOString()
    };
    draftsByCandidateAndJob.set(key, draft);
    draftsById.set(applicationId, draft);
  }

  return draft;
}

export function getDraftById(applicationId: string): ApplicationDraft | null {
  return draftsById.get(applicationId) || null;
}

export function updateDraftStep(
  applicationId: string,
  step: number,
  data: Partial<ApplicationDraft>
): ApplicationDraft {
  const draft = draftsById.get(applicationId);
  if (!draft) {
    throw new Error(`Application ${applicationId} not found`);
  }

  if (draft.status === 'SUBMITTED') {
    throw new Error(`Application ${applicationId} is already submitted and cannot be modified`);
  }

  // Update step payload
  if (data.personalInfo) draft.personalInfo = { ...draft.personalInfo, ...data.personalInfo };
  if (data.education) draft.education = { ...draft.education, ...data.education };
  if (data.experience) draft.experience = { ...draft.experience, ...data.experience };
  if (data.resume) draft.resume = { ...draft.resume, ...data.resume };

  draft.currentStep = Math.max(draft.currentStep, step);
  draft.updatedAt = new Date().toISOString();

  return draft;
}

export function submitApplication(
  applicationId: string,
  idempotencyKey?: string
): { success: boolean; application: ApplicationDraft; isDuplicate: boolean; message: string } {
  const draft = draftsById.get(applicationId);
  if (!draft) {
    throw new Error(`Application ${applicationId} not found`);
  }

  // 1. Check idempotency key if provided
  if (idempotencyKey) {
    const existingSubmission = idempotencyRegistry.get(idempotencyKey);
    if (existingSubmission) {
      return {
        success: true,
        application: existingSubmission,
        isDuplicate: true,
        message: 'Duplicate submission detected via Idempotency-Key. Returning existing submission.'
      };
    }
  }

  // 2. Check if this application has already been submitted
  if (draft.status === 'SUBMITTED' || submittedApplications.has(applicationId)) {
    return {
      success: true,
      application: draft,
      isDuplicate: true,
      message: 'Application has already been submitted successfully.'
    };
  }

  // 3. Validate that all required steps are filled
  if (!draft.personalInfo || !draft.education || !draft.experience || !draft.resume) {
    throw new Error('Incomplete application: All steps (Personal, Education, Experience, Resume) must be filled before submission.');
  }

  // 4. Mark as submitted
  draft.status = 'SUBMITTED';
  draft.submittedAt = new Date().toISOString();
  draft.idempotencyKey = idempotencyKey;
  draft.updatedAt = new Date().toISOString();

  submittedApplications.set(applicationId, draft);
  if (idempotencyKey) {
    idempotencyRegistry.set(idempotencyKey, draft);
  }

  return {
    success: true,
    application: draft,
    isDuplicate: false,
    message: 'Application submitted successfully.'
  };
}

export function resetApplicationState(): void {
  draftsByCandidateAndJob.clear();
  draftsById.clear();
  idempotencyRegistry.clear();
  submittedApplications.clear();
}
