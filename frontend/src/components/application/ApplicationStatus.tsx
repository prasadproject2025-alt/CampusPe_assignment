export function ApplicationStatus({
  fieldCount,
  requiredCount,
  filledCount,
  llmCount,
  userRequiredCount,
}: {
  fieldCount: number
  requiredCount: number
  filledCount?: number
  llmCount?: number
  userRequiredCount?: number
}) {
  return (
    <p className="application-status-meta">
      {fieldCount} fields discovered
      {typeof filledCount === 'number' ? ` · ${filledCount} answered from profile/resume` : requiredCount ? ` · ${requiredCount} required` : ''}
      {llmCount ? ` · ${llmCount} AI suggestions` : ''}
      {userRequiredCount ? ` · ${userRequiredCount} require your input` : ''}
    </p>
  )
}
