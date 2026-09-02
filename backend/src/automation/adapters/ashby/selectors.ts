export const ashbySelectors = {
  questionTitle: '.ashby-application-form-question-title',
  fieldContainer: '.ashby-application-form-field-entry, fieldset',
  jobHeading: '.ashby-job-posting-heading, h1',
  applyLink: 'a[href$="/application"], a[href*="/application?"]',
  resume: '#_systemfield_resume',
  educationDegree: '#_systemfield_education_history-degree',
  schoolSearch: 'input[placeholder="Search schools..."]',
  yesNo: '.ashby-application-form-input-yesno',
  submit: 'button',
  recaptchaChallenge: 'iframe[src*="recaptcha/api2/bframe"]',
} as const
