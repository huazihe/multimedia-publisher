import { DatabaseSync } from 'node:sqlite'

const platform = process.argv[2] || 'douyin'
const db = new DatabaseSync('publisher-dashboard/data/publisher.sqlite')

try {
  const columns = db.prepare('PRAGMA table_info(publish_results)').all().map(row => row.name)
  if (process.argv.includes('--schema')) {
    console.log(JSON.stringify(columns, null, 2))
    process.exit(0)
  }

  const selectedColumns = [
    'created_at',
    'platform',
    'status',
    'message',
    'url',
    'result_json',
  ].filter(column => columns.includes(column))
    .map(column => `pr.${column}`)
    .join(', ')

  const rows = db.prepare(`
    SELECT
      ${selectedColumns},
      pj.status AS job_status
    FROM publish_results pr
    LEFT JOIN publish_jobs pj ON pj.id = pr.job_id
    WHERE pr.platform = ?
    ORDER BY pr.created_at DESC
    LIMIT 10
  `).all(platform)

  console.log(JSON.stringify(rows, null, 2))
} finally {
  db.close()
}
