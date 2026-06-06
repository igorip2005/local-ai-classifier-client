import { getClientProductionReadiness } from '../src/deploy/production-readiness.js';

const report = await getClientProductionReadiness();
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'pass') process.exit(1);
