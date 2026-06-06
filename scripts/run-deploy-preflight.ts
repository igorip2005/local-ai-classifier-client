import { runClientDeployPreflight } from '../src/deploy/preflight-service.js';

const report = await runClientDeployPreflight();
console.log(JSON.stringify(report, null, 2));

if (report.status === 'fail') process.exit(1);
