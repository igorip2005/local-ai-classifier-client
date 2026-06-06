import { runClientServiceInstall } from '../src/deploy/install-service.js';

const report = await runClientServiceInstall({
  execute: process.env.CLIENT_DEPLOY_INSTALL_CONFIRM === '1'
});
console.log(JSON.stringify(report, null, 2));

if (report.status === 'fail') process.exit(1);
