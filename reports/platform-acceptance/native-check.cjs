const { DuckDBInstance } = require('C:\\Users\\Docker\\ticket-10\\artifact\\package\\node_modules\\@duckdb\\node-api');
(async () => {
  const db = await DuckDBInstance.create(':memory:');
  const connection = await db.connect();
  const result = await connection.runAndReadAll('SELECT 1 AS value');
  const value = result.getRows()[0][0];
  result.closeSync();
  connection.closeSync();
  db.closeSync();
  if (value !== 1 && value !== 1n) throw new Error('Unexpected query result: ' + value);
  console.log(JSON.stringify({native: 'loaded', query: String(value)}));
})().catch((error) => { console.error(error); process.exitCode = 1; });
