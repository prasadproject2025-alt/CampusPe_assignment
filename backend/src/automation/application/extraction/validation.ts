import { isOptionOnlyLabel } from './fieldNormalizer.js'
import type { AdapterQuestion } from '../../types.js'

export function assessExtractionCompleteness(questions: AdapterQuestion[], expectedControls?: number) {
  const extractedControls = questions.length
  const optionAsLabel = questions.filter((question) => isOptionOnlyLabel(question.text))
  const warnings: string[] = []
  if (!extractedControls) warnings.push('Application form could not be completely inspected.')
  if (optionAsLabel.length) warnings.push('Some choice options were read as question labels and were discarded.')
  if (typeof expectedControls === 'number' && expectedControls > extractedControls) {
    warnings.push('Application form could not be completely inspected.')
  }
  return {
    complete: warnings.length === 0 && extractedControls > 0,
    fieldCount: extractedControls,
    expectedControls,
    extractedControls,
    unresolvedControls: optionAsLabel.length,
    warnings,
  }
}
