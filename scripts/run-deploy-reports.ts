import { listClientDeployReports, type ClientDeployReportKind } from '../src/deploy/report-service.js';

const kind = parseKind(process.env.CLIENT_REPORT_KIND);
const limit = process.env.CLIENT_REPORT_LIMIT ? Number(process.env.CLIENT_REPORT_LIMIT) : undefined;
const options: { kind?: ClientDeployReportKind; limit?: number } = {};
if (kind) options.kind = kind;
if (limit !== undefined) options.limit = limit;
const report = await listClientDeployReports(options);
console.log(JSON.stringify(report, null, 2));

function parseKind(value: string | undefined): ClientDeployReportKind | undefined {
  if (value === 'production-readiness') return value;
  if (!value) return undefined;
  throw new Error(`Invalid CLIENT_REPORT_KIND: ${value}`);
}
