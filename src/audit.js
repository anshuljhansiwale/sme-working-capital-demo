export function appendAudit(caseDoc, event) {
  const line = {
    time: event.time,
    caseId: caseDoc.caseId,
    actor: event.actor,
    eventType: event.eventType,
    statusBefore: event.statusBefore ?? caseDoc.status ?? null,
    statusAfter: event.statusAfter ?? caseDoc.status ?? null,
    detail: event.detail,
    policyVersion: caseDoc.policyVersion ?? null,
    serviceBuildId: caseDoc.serviceBuildId ?? null,
    modelName: caseDoc.modelName ?? null,
  };
  caseDoc.auditLines.push(line);
  return line;
}

export function setStatus(caseDoc, next, time, detail) {
  const before = caseDoc.status ?? null;
  caseDoc.status = next;
  appendAudit(caseDoc, {
    time,
    actor: "Lead Credit Orchestrator",
    eventType: "STATUS_CHANGED",
    statusBefore: before,
    statusAfter: next,
    detail: detail ?? `From ${before ?? "none"} to ${next}.`,
  });
}
