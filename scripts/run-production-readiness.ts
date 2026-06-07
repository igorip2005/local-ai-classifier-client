import { getClientProductionReadiness } from '../src/deploy/production-readiness.js';
import { runClientReportedCommand } from '../src/deploy/reported-command.js';

const exitCode = await runClientReportedCommand('production-readiness', getClientProductionReadiness, {
  successExitCode: (report) => report.status === 'pass' ? 0 : 1
});
if (exitCode !== 0) process.exit(exitCode);
