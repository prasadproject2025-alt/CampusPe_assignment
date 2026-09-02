const replacements: Array<[RegExp, string]> = [
  [/\be[- ]?mail address\b/g, 'email'],
  [/\btelephone\b|\bmobile(?: number)?\b|\bcontact number\b/g, 'phone'],
  [/\bcurriculum vitae\b/g, 'resume'],
  [/\bwork authorisation\b/g, 'work authorization'],
  [/\bvisa sponsorship\b/g, 'sponsorship'],
  [/\bhow many years(?: of)?\b/g, 'years'],
  [/\byears? of experience\b/g, 'experience years'],
  [/\bdo you need\b|\bwill you require\b/g, 'require'],
  [/\b(?:are|would) you be willing to\b|\bare you willing to\b/g, 'willing to'],
  [/\bposition\b/g, 'role'],
  [/\b(?:this|the) role\b/g, 'role'],
  [/\bplease select\b|\bplease enter\b|\bplease provide\b/g, ''],
]

export function normalizeQuestion(question: string) {
  let value = question.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9+#.\s-]/g, ' ')
  for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement)
  return value.replace(/\s+/g, ' ').trim()
}

const classifiers: Array<{ field: string; patterns: RegExp[] }> = [
  { field: 'first_name', patterns: [/^first name$/, /^given name$/] },
  { field: 'last_name', patterns: [/^last name$/, /^family name$/, /^surname$/] },
  { field: 'full_name', patterns: [/\bfull name\b/, /\blegal name\b/, /^name$/] },
  { field: 'declaration_date', patterns: [/^date$/] },
  { field: 'email', patterns: [/\bemail\b/] },
  { field: 'phone_country_code', patterns: [/\bphone country(?: code)?\b/, /\bmobile country(?: code)?\b/] },
  { field: 'phone', patterns: [/\bphone\b/] },
  { field: 'linkedin_url', patterns: [/\blinkedin\b/] },
  { field: 'github_url', patterns: [/\bgithub\b/] },
  { field: 'portfolio_url', patterns: [/\bportfolio\b/, /^website$/, /\bpersonal website\b/] },
  { field: 'current_company', patterns: [/\bcurrent company\b/, /\bcurrent employer\b/] },
  { field: 'us_visa_type', patterns: [/^(?!.*\bsponsor)\b.*\bvisa (?:type|status)\b/, /\b(?:h1b|h-1b)\b.*\bopt\b/, /\bopt\b.*\b(?:h1b|h-1b)\b/] },
  { field: 'us_sponsorship', patterns: [/\bsponsorship.*(?:\bu\.?s\.?(?:\b|$)|\bunited states\b)/, /(?:\bu\.?s\.?(?:\b|$)|\bunited states\b).*\bsponsorship\b/, /\bsponsorship to work in the u s\b/] },
  { field: 'active_immigration_case', patterns: [/\bactive immigration case\b/, /\bh-?1b extension\b.*\bgreen card\b/] },
  { field: 'sponsorship', patterns: [/\bsponsorship\b/, /\bsponsor.*visa\b/] },
  { field: 'us_work_authorized', patterns: [/\bauthori[sz]ed to work.*(?:u\.?s\.?|united states)\b/, /(?:u\.?s\.?|united states).*\bauthori[sz]ed to work\b/] },
  { field: 'work_authorized', patterns: [/\bauthori[sz]ed to work\b/, /\blegally (?:eligible|entitled) to work\b/] },
  { field: 'notice_period', patterns: [/\bnotice period\b/, /\bwhen can you (?:start|join)\b/, /\bavailable to start\b/] },
  { field: 'current_salary', patterns: [/\bcurrent (?:annual |base |gross )?(?:salary|compensation|ctc)\b/, /\bpresent (?:annual |base |gross )?(?:salary|compensation|ctc)\b/, /\bexisting (?:annual |base |gross )?(?:salary|compensation|ctc)\b/] },
  { field: 'expected_salary', patterns: [/\bexpected (?:annual |base |gross )?(?:salary|compensation|ctc)\b/, /\bsalary expectation\b/, /\bdesired (?:annual |base |gross )?(?:salary|compensation)\b/] },
  { field: 'work_arrangement', patterns: [/\bremote.*hybrid.*on.?site\b/, /\bpreferred work arrangement\b/] },
  { field: 'willing_in_office', patterns: [/\bopen to being in.?office\b/, /\bwilling to.*in.?office\b/, /\bin.?office 5 days\b/] },
  { field: 'willing_relocate', patterns: [/\bwilling to relocate\b/, /\bopen to relocat/] },
  { field: 'referral_source', patterns: [/\bhow did you hear about (?:us|this|the company|this opportunity|the opportunity|this role|the role)\b/, /\breferral source\b/] },
  { field: 'degree_type', patterns: [/^degree$/, /\bdegree type\b/, /\btype of degree\b/] },
  { field: 'education_discipline', patterns: [/^discipline$/, /^field of study$/, /^major$/] },
  { field: 'education_school', patterns: [/^school$/, /^school or university$/, /^university$/, /^college$/] },
  { field: 'education_start_year', patterns: [/^start date year$/, /^education start year$/, /^start year$/] },
  { field: 'education_end_year', patterns: [/^end date year$/, /^graduation year$/, /^education end year$/] },
  { field: 'location_confirmation', patterns: [/\bare you (?:currently )?located in\b/] },
  { field: 'current_city', patterns: [/^city$/, /^current city$/] },
  { field: 'current_state', patterns: [/^state$/, /^state province$/, /^current state$/] },
  { field: 'current_country', patterns: [/^country$/, /^current country$/] },
  { field: 'postal_code', patterns: [/^zip$/, /^zip code$/, /^postal code$/, /^pin code$/] },
  { field: 'total_experience_years', patterns: [/\btotal experience\b/, /\boverall experience\b/, /^experience years$/, /^years\b.*\bexperience\b/] },
  { field: 'skill_experience_years', patterns: [/^years have you worked (?:on|with|using)\b/, /\bexperience years.*\bwith\b/, /\byears.*experience.*\b(?:in|with|using|on)\b/, /\bhow long.*(?:worked|experience).*(?:with|using|on)\b/] },
  { field: 'location', patterns: [/\bcurrent location\b/, /\bwhere are you (?:currently )?(?:based|located)\b/, /^location$/, /^address$/] },
  { field: 'pronouns', patterns: [/\bpronouns?\b/] },
  { field: 'gender', patterns: [/\bgender\b/] },
  { field: 'sexual_orientation', patterns: [/\bsexual orientation\b/] },
  { field: 'ethnicity', patterns: [/\bethnicity\b/, /\brace\b/] },
  { field: 'disability', patterns: [/\bdisab(?:ility|led)\b/] },
  { field: 'veteran', patterns: [/\bveteran\b/, /\bmilitary service\b/] },
  { field: 'motivation', patterns: [/\bwhy (?:do you want|are you interested|this company)\b/, /\bwhy .*join\b/] },
  { field: 'career_motivation', patterns: [/\bwhat motivates you\b/, /\blooking for in your next role\b/] },
  { field: 'cover_letter_intro', patterns: [/\bintroduce yourself\b/, /\btell us about yourself\b/] },
  { field: 'additional_information', patterns: [/\badditional information\b/, /\banything else.*know\b/] },
]

export function classifyQuestion(normalized: string) {
  return classifiers.find((classifier) => classifier.patterns.some((pattern) => pattern.test(normalized)))?.field ?? null
}

export function questionSimilarity(left: string, right: string) {
  if (left === right) return 1
  const tokens = (value: string) => new Set(value.split(' ').filter((token) => token.length > 2 && !['the', 'and', 'you', 'your', 'are', 'for', 'this', 'with'].includes(token)))
  const a = tokens(left); const b = tokens(right)
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter((token) => b.has(token)).length
  const union = new Set([...a, ...b]).size
  return intersection / union
}
