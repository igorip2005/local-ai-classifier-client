import { runClientServiceStatus } from '../src/deploy/service-status.js';

const report = await runClientServiceStatus();
console.log(JSON.stringify(report, null, 2));

if (report.status === 'fail') process.exit(1);
