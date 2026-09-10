export type StepName =
  | 'PERSONAL_INFO'
  | 'EDUCATION'
  | 'EXPERIENCE'
  | 'RESUME_UPLOAD'
  | 'REVIEW'
  | 'SUBMIT';

export const STEP_ORDER: StepName[] = [
  'PERSONAL_INFO',
  'EDUCATION',
  'EXPERIENCE',
  'RESUME_UPLOAD',
  'REVIEW',
  'SUBMIT'
];

export type ApplicationStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'RETRYING'
  | 'RECOVERING'
  | 'SUBMITTED'
  | 'FAILED';

export interface CandidateProfile {
  candidateId: string;
  personalInfo: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    linkedIn?: string;
    portfolio?: string;
  };
  education: {
    degree: string;
    institution: string;
    fieldOfStudy: string;
    graduationYear: string;
    gpa?: string;
  };
  experience: {
    currentCompany: string;
    jobTitle: string;
    yearsOfExperience: string;
    techStack?: string;
    responsibilities?: string;
  };
  resume: {
    filePath: string;
    fileName: string;
  };
}

export interface StepEvent {
  step: StepName;
  timestamp: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED' | 'RECOVERED';
  attempt: number;
  error?: string;
  durationMs?: number;
}

export interface ApplicationState {
  candidateId: string;
  email: string;
  applicationId: string | null;
  status: ApplicationStatus;
  currentStep: StepName;
  completedSteps: StepName[];
  stepAttempts: Record<StepName, number>;
  idempotencyKey: string;
  submissionReceipt?: {
    applicationId: string;
    submittedAt: string;
    isDuplicate: boolean;
  };
  lastUpdated: string;
  history: StepEvent[];
}

export interface ResilienceConfig {
  maxRetries: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
  enableTracing: boolean;
  enableScreenshotsOnFailure: boolean;
  traceDir: string;
  screenshotDir: string;
  stateDir: string;
}
