import { CustomApplicationForm } from './CustomApplicationForm'
import type { AutomationRun } from './types'

export function ApplicationForm({
  run,
  disabled,
  onUpdateAnswers,
}: {
  run: AutomationRun
  disabled?: boolean
  onUpdateAnswers: (fields: Array<{ id: string; value: string }>) => void
}) {
  return <CustomApplicationForm key={run.id} run={run} disabled={disabled} onUpdateAnswers={onUpdateAnswers} />
}

export { CustomApplicationForm }
