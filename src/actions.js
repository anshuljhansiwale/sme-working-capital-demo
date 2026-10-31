export function availableActions(caseDoc) {
  if (!caseDoc) {
    return [
      { id: "intake", source: "file-drop", label: "Drop case file" },
      { id: "intake", source: "simulated-los-webhook", label: "Simulated LOS webhook" },
    ];
  }

  const actions = [];
  if (caseDoc.status === "Received") {
    actions.push({ id: "check-documents", label: "Check documents" });
  } else if (caseDoc.status === "Awaiting documents") {
    actions.push({ id: "start-policy", label: "Start policy" });
  } else if (caseDoc.status === "Checking policy" && !caseDoc.policyOutcome) {
    actions.push({ id: "start-policy", label: "Run policy" });
  } else if (caseDoc.status === "Checking policy" && caseDoc.policyOutcome === "Escalate" && !caseDoc.decisionPayload) {
    const expired = caseDoc.auditLines?.some((line) => line.eventType === "CHECKIN_FAILED");
    if (!expired) {
      actions.push({ id: "select-build", mode: "landed", label: "Select the landed build" });
      actions.push({ id: "time-box", label: "Time box elapsed" });
    }
    actions.push({ id: "select-build", mode: "last-green", label: "Use last green build" });
  } else if (caseDoc.status === "Checking policy" && caseDoc.policyOutcome === "Approve" && caseDoc.makerRequired === "No") {
    actions.push({ id: "finalize", label: "Finalize decision" });
  } else if (caseDoc.status === "Checking policy" && caseDoc.makerRequired === "Yes" && caseDoc.policyOutcome !== "Escalate") {
    actions.push({ id: "open-maker", label: "Open the maker gate" });
  } else if (caseDoc.status === "Pending maker") {
    actions.push({ id: "maker-confirm", label: "Maker confirms" });
  } else if (caseDoc.status === "Pending checker") {
    actions.push({ id: "checker-confirm", label: "Checker confirms" });
  } else if (caseDoc.status === "Decision final") {
    actions.push({ id: "write-back", label: "Simulate LOS write-back" });
  }

  if (caseDoc.status === "Written back" || caseDoc.status) {
    actions.push({ id: "reset", label: "Reset this path" });
  }
  return actions;
}
