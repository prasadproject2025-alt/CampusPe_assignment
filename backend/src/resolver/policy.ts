const alwaysManualPatterns = [
  /\bcriminal (?:record|history)\b/,
  /\bbackground check\b/,
  /\bsecurity clearance\b/,
  /\bconflict of interest\b/,
  /\bnon.?compete\b/,
  /\bcertify (?:that )?(?:the|this|all)\b/,
  /\bterms and conditions\b/,
  /\brecruitment privacy notice\b/,
  /\bconsent (?:to )?(?:the )?processing of my data\b/,
  /\bi acknowledge\b/,
  /\backnowledg(?:e|ement)\b/,
  /\btruthful and (?:complete|accurate)\b/,
  /\bgovernment identifier\b|\bpassport\b|\bsocial security\b|\baadhaar\b/,
]

export const sensitiveFields = new Set(['pronouns', 'gender', 'sexual_orientation', 'ethnicity', 'disability', 'veteran'])
export const nonInferableFields = new Set(['work_authorized', 'us_work_authorized', 'sponsorship', 'us_sponsorship', 'us_visa_type', 'active_immigration_case', 'current_salary', 'expected_salary', 'notice_period', 'willing_in_office', 'willing_relocate', 'degree_type', 'current_city', 'current_state', 'current_country', 'postal_code', 'location_confirmation'])

export function nonDisclosureOption(options: string[] = []) {
  return options.find((option) => /\b(?:decline|prefer not|do not wish|dont wish|choose not|not disclose)\b/i.test(option)) ?? null
}

export function approvedDeclarationAnswer(normalized: string, options: string[] = []) {
  const isNoRecordingAcknowledgement = /\b(?:record|recording)\b/.test(normalized)
    && /\b(?:transcrib|transcription)\w*\b/.test(normalized)
    && /\backnowledg(?:e|ement)\b/.test(normalized)
  if (!isNoRecordingAcknowledgement) return null
  return options.find((option) => /^i acknowledge\.?$/i.test(option.trim())) ?? null
}

export function manualPolicyReason(normalized: string) {
  return alwaysManualPatterns.some((pattern) => pattern.test(normalized))
    ? 'This declaration must be completed directly by the user.'
    : null
}
