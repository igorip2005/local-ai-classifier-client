import { redactDeployText } from './redaction.js';
import { writeClientDeployReport, type ClientDeployReportKind } from './report-service.js';

export type ClientReportedCommandError = {
  name: string;
  message: string;
};

export type ClientReportedCommandFailurePayload = {
  status: 'fail';
  error: ClientReportedCommandError;
};

export type ClientReportWriter = typeof writeClientDeployReport;

// Production readiness is target-host evidence, not just terminal output. This
// helper keeps the CLI fail-closed even when report writing fails, while avoiding
// raw stack traces or signed URL/token leakage in stderr/stdout.
export async function runClientReportedCommand<TPayload extends Record<string, unknown>>(
  kind: ClientDeployReportKind,
  run: () => Promise<TPayload>,
  options: {
    writeReport?: ClientReportWriter;
    writeOutput?: (text: string) => void;
    successExitCode?: (payload: TPayload) => number;
  } = {}
): Promise<number> {
  const writeReport = options.writeReport ?? writeClientDeployReport;
  const writeOutput = options.writeOutput ?? ((text) => console.log(text));
  const successExitCode = options.successExitCode ?? (() => 0);

  try {
    const payload = await run();
    const saved = await writeReport(kind, payload);
    writeOutput(JSON.stringify({ ...payload, report_path: redactDeployText(saved.path) }, null, 2));
    return successExitCode(payload);
  } catch (error) {
    const payload: ClientReportedCommandFailurePayload = {
      status: 'fail',
      error: safeClientReportedError(error)
    };

    try {
      const saved = await writeReport(kind, payload);
      writeOutput(JSON.stringify({ ...payload, report_path: redactDeployText(saved.path) }, null, 2));
    } catch (reportError) {
      writeOutput(JSON.stringify({
        ...payload,
        report_error: safeClientReportedError(reportError)
      }, null, 2));
    }
    return 1;
  }
}

export function safeClientReportedError(error: unknown): ClientReportedCommandError {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: redactDeployText(error.message)
    };
  }
  return {
    name: 'Error',
    message: redactDeployText(String(error))
  };
}
