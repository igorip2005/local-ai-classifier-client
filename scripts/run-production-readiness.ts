import { getClientProductionReadiness } from '../src/deploy/production-readiness.js';
import { writeClientDeployReport } from '../src/deploy/report-service.js';

const report = await getClientProductionReadiness();
const saved = await writeClientDeployReport('production-readiness', report);
console.log(JSON.stringify({ ...report, report_path: saved.path }, null, 2));
if (report.status !== 'pass') process.exit(1);
