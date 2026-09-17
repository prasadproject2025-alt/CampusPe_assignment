import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { recoverInterruptedRuns } from './recovery.js'

test('restart marks lost workers interrupted without retrying or changing reviewed and submitted runs', () => {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec('CREATE TABLE automation_runs (status TEXT,current_step TEXT,error_message TEXT,pause_json TEXT,updated_at TEXT)')
    for (const status of ['FILLING_APPLICATION', 'SUBMITTING', 'READY_FOR_REVIEW', 'SUBMITTED', 'PAUSED_NEEDS_INPUT']) {
      database.prepare('INSERT INTO automation_runs (status) VALUES (?)').run(status)
    }
    assert.equal(recoverInterruptedRuns(database), 2)
    const rows = database.prepare('SELECT status,current_step,error_message FROM automation_runs').all()
    assert.deepEqual(rows.map(row => row.status), ['FAILED','FAILED','READY_FOR_REVIEW','SUBMITTED','PAUSED_NEEDS_INPUT'])
    assert.match(String(rows[1]!.error_message), /Submission was not confirmed/)
    assert.equal(recoverInterruptedRuns(database), 0)
  } finally { database.close() }
})
