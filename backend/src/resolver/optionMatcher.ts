import type { AnswerValue } from './types.js'

export function matchNoticePeriodOption(answer: AnswerValue, options: string[]) {
  const saved = String(answer).toLowerCase().trim()
  if (/\b(?:immediate(?:ly)?|available now|no notice|as soon as possible)\b/.test(saved)) {
    return options.find((option) => /\bno notice\b|\bas soon as possible\b|\bimmediate(?:ly)?\b/i.test(option)) ?? null
  }

  const amount = Number(saved.match(/\d+/)?.[0])
  if (!Number.isFinite(amount)) return null
  const days = /month/.test(saved) ? amount * 30 : /week/.test(saved) ? amount * 7 : amount
  return options.find((option) => {
    const optionNumbers = [...option.matchAll(/\d+/g)].map((match) => Number(match[0]))
    if (!optionNumbers.length) return false
    if (/month/i.test(option) && optionNumbers.some((value) => value * 30 === days)) return true
    return optionNumbers.some((value) => value === days)
  }) ?? null
}
