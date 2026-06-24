import { ServiceRequest } from '../types/envelope.types.js';

export function resolveRequesterEmail(request: Pick<ServiceRequest, 'initiator' | 'envelopes'>): string {
  const requestParams = (request.envelopes.request as any)?.parameters || {};
  const serviceData = requestParams.serviceData || {};
  const candidates = [
    requestParams.email,
    requestParams.emailAddress,
    requestParams.requesterEmail,
    requestParams.requestorEmail,
    requestParams.initiatorEmail,
    requestParams.studentEmail,
    requestParams.contactEmail,
    serviceData.email,
    serviceData.emailAddress,
    serviceData.requesterEmail,
    serviceData.requestorEmail,
    serviceData.initiatorEmail,
    request.initiator,
  ];

  const email = candidates.find(candidate =>
    typeof candidate === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
  );

  return email || '';
}
