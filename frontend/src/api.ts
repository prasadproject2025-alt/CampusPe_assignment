export type WorkExperience = { id: number; title: string; company: string; employmentType: string; location: string; city: string; state: string; country: string; postalCode: string; startDate: string; endDate: string; current: boolean; description: string }
export type Education = { id: number; school: string; degree: string; field: string; grade: string; city: string; state: string; country: string; postalCode: string; startDate: string; endDate: string; current: boolean; description: string }
export type Demographics = { gender: string; orientation: string; ethnicity: string; disability: string; veteran: string }
export type StoredProfile = {
  name: string; email: string; phone: string; phoneCountryCode: string; location: string; currentCity: string; currentState: string; currentCountry: string; linkedinUrl: string; githubUrl: string; portfolioUrl: string
  experienceYears: string; noticePeriod: string; workAuthorized: string; sponsorship: string; currentSalary: string; expectedSalary: string; workArrangement: string
  willingInOffice: string; willingRelocate: string; usWorkAuthorized: string; usSponsorship: string; usVisaType: string; activeImmigrationCase: string; referralSource: string
  careerMotivation: string; coverLetterIntro: string; additionalInformation: string
  experiences: WorkExperience[]; education: Education[]; demographics: Demographics; allowDemographicSuggestions: boolean
  resume: { filename: string; mime: string } | null; updatedAt?: string
}

export type RecommendedJob = {
  id: string; source: 'ashby' | 'greenhouse' | 'lever' | 'workable'; company: string; title: string; location: string; workplaceType: string; employmentType: string
  salary: string | null; department: string | null; skills: string[]; publishedAt: string | null; jobUrl: string; applyUrl: string
}

type ApiErrorBody = { error?: { message?: string; code?: string } }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers } })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ApiErrorBody
    const code = payload.error?.code || (response.status === 401 ? 'AUTH_REQUIRED' : `HTTP_${response.status}`)
    throw new ApiError(response.status, code, payload.error?.message || `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
