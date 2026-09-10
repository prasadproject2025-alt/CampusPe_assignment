export interface UserSession {
  userId: string;
  email: string;
  name: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  isValid: boolean;
}

export interface ApplicationDraft {
  applicationId: string;
  userId: string;
  jobId: string;
  currentStep: number;
  status: 'DRAFT' | 'SUBMITTED';
  personalInfo?: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    linkedIn?: string;
    portfolio?: string;
  };
  education?: {
    degree: string;
    institution: string;
    fieldOfStudy: string;
    graduationYear: string;
    gpa?: string;
  };
  experience?: {
    currentCompany: string;
    jobTitle: string;
    yearsOfExperience: string;
    responsibilities: string;
    techStack?: string;
  };
  resume?: {
    fileName: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    uploadedAt: string;
  };
  submittedAt?: string;
  idempotencyKey?: string;
  updatedAt: string;
}

export interface ChaosConfig {
  sessionExpiryInjected: boolean;
  networkLatencyMs: number;
  forceServerErrorSteps: number[];
  serverCrashTriggered: boolean;
}
