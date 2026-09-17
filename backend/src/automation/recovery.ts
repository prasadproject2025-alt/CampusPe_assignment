import type { DatabaseSync } from 'node:sqlite'

// Browser sessions and workers live in this server process. After restart they
// cannot be resumed, especially when a submission may already have been sent.
export function recoverInterruptedRuns(database: DatabaseSync) {
  return database.prepare(`UPDATE automation_runs
    SET status='FAILED', current_step='INTERRUPTED',
      error_message='The server restarted before this run finished. Submission was not confirmed. Check the employer before starting another application.',
      pause_json=NULL, updated_at=?
    WHERE status IN ('QUEUED','OPENING_JOB','EXTRACTING_JOB','FILLING_APPLICATION','SUBMITTING','RESUMING')`)
    .run(new Date().toISOString()).changes
}
