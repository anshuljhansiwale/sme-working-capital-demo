import { formatMoney, HIGH_VALUE_ABOVE, POLICY_VERSION, PRODUCT } from "./policy.js";

export function inPolicyNote(caseDoc) {
  return `POL_IN_POLICY. Approve under policy ${caseDoc.policyVersion}. Facility ${formatMoney(caseDoc.facilityAmount, caseDoc.currency)} is at or under ${formatMoney(HIGH_VALUE_ABOVE)}.`;
}

export function reasonCodeMemo(caseDoc) {
  const lines = [
    `${PRODUCT} — ${caseDoc.policyOutcome} — ${caseDoc.caseId}`,
    "",
    `Policy ${caseDoc.policyVersion ?? POLICY_VERSION}. The outcome is ${caseDoc.policyOutcome}. This memo is filled from the reason codes. The exception service was not called.`,
    "",
  ];
  for (const check of caseDoc.policyChecks ?? []) {
    if (check.result === "fail") {
      lines.push(`${check.reasonCode}: ${check.rule}, actual ${check.actual}, limit ${check.limit}.`);
    }
  }
  if ((caseDoc.reasonCodes ?? []).includes("GATE_HIGH_VALUE")) {
    lines.push(`GATE_HIGH_VALUE: facility ${formatMoney(caseDoc.facilityAmount, caseDoc.currency)} is over ${formatMoney(HIGH_VALUE_ABOVE)}. The outcome word is unchanged.`);
  }
  if (caseDoc.policyOutcome === "Approve") {
    lines.push("POL_IN_POLICY. All decision rules passed. This short note is the policy result. The exception service was not called.");
  }
  lines.push("", "The maker may edit this wording. The outcome stays the policy outcome.");
  return lines.join("\n");
}

export function chaseText(caseDoc, dueDate) {
  const missing = (caseDoc.documents ?? [])
    .filter((doc) => !doc.present)
    .map((doc) => doc.type)
    .join("; ");
  return [
    `${PRODUCT} — ${caseDoc.legalName} (${caseDoc.caseId}).`,
    `Missing documents: ${missing}.`,
    `SLA due ${dueDate} (two business days after this gap).`,
    "No message has been sent. This chase is a demo record.",
  ].join("\n");
}

export const CONTEXT_SENTENCE = "The late invoice is context and is not a waiver of the debt-service rule.";
