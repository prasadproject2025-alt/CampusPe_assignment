export const breezySelectors = {
  form: 'form[name="form"]',
  jobHeading: 'h1',
  jobDescription: '.position-description .description',
  submit: 'form[name="form"] button[type="submit"]',
  resume: '#main-attachment',
  resumeButton: '.apply-buttons a.resume, a[ng-click*="showFileSelector"]',
  addEducation: 'a[ng-click*="addEducation"]',
  educationEntry: 'li[ng-repeat*="candidateSchool"]',
  recaptchaChallenge: 'iframe[src*="recaptcha"], iframe[title*="recaptcha" i]',
} as const
