require('dotenv').config();

const { loadConfig } = require('../src/config');
const { run } = require('../src/run');

async function main() {
  const config = loadConfig(process.env);
  console.log(`Starting scan pipeline with ${config.concurrency} worker${config.concurrency === 1 ? '' : 's'}.`);
  const result = await run(config);
  console.log(`Scan pipeline finished. Artifacts: ${result.runDir}`);
  console.table(result.summary.outcomes);
  if (result.summary.incomplete_jobs) process.exitCode = 2;
}

if (require.main === module) main().catch((error) => { console.error(`Scan pipeline failed: ${error.message}`); process.exitCode = 1; });

module.exports = { main };
