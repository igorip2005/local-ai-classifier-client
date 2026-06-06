import { runClientDeployPreflight, type ClientDeployPreflightReport } from './preflight-service.js';
import { runClientServiceStatus, type ClientServiceStatusReport } from './service-status.js';

export type ClientProductionReadinessComponent = {
  name: 'deploy-preflight' | 'systemd-user-service';
  status: 'pass' | 'fail';
  source_status: string;
  message: string;
};

export type ClientProductionReadinessReport = {
  checked_at: string;
  status: 'pass' | 'fail';
  components: ClientProductionReadinessComponent[];
  preflight: ClientDeployPreflightReport;
  service_status: ClientServiceStatusReport;
};

// Production gate for doc/IMPLEMENTATION_DETAILS.md sections 20, 23, 24 and
// 25. A production client host is not ready just because the code builds: the
// host-specific env/service artifact must pass preflight and the systemd user
// service must be installed, enabled and active.
export async function getClientProductionReadiness(
  options: {
    now?: Date;
    preflight?: ClientDeployPreflightReport;
    serviceStatus?: ClientServiceStatusReport;
  } = {}
): Promise<ClientProductionReadinessReport> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  const preflight = options.preflight ?? await runClientDeployPreflight(options.now ? { now: options.now } : {});
  const serviceStatus = options.serviceStatus ?? await runClientServiceStatus(options.now ? { now: options.now } : {});
  const components = [
    preflightComponent(preflight),
    serviceComponent(serviceStatus)
  ];

  return {
    checked_at: checkedAt,
    status: components.every((component) => component.status === 'pass') ? 'pass' : 'fail',
    components,
    preflight,
    service_status: serviceStatus
  };
}

function preflightComponent(report: ClientDeployPreflightReport): ClientProductionReadinessComponent {
  if (report.status === 'pass') {
    return {
      name: 'deploy-preflight',
      status: 'pass',
      source_status: report.status,
      message: 'Client deploy preflight passed with service artifact, scripts and host environment present.'
    };
  }
  return {
    name: 'deploy-preflight',
    status: 'fail',
    source_status: report.status,
    message: 'Client deploy preflight is not production-ready; fix package, service artifact or target-host .env issues.'
  };
}

function serviceComponent(report: ClientServiceStatusReport): ClientProductionReadinessComponent {
  if (report.status === 'pass') {
    return {
      name: 'systemd-user-service',
      status: 'pass',
      source_status: report.status,
      message: 'Client systemd user service is enabled and active.'
    };
  }
  return {
    name: 'systemd-user-service',
    status: 'fail',
    source_status: report.status,
    message: 'Client systemd user service is not production-ready; run npm run deploy:service-status on the client host.'
  };
}
