import postgres from 'postgres'

const sql = postgres('postgresql://erp_admin:Ziner_a18@localhost:5433/erp_dinamico')

async function run() {
  try {
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;`
    console.log('Grants updated')
  } catch (err) {
    console.error('Error:', err.message)
  }
  await sql.end()
}
run()
