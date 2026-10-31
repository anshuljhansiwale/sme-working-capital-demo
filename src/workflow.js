const ORCHESTRATOR = "Lead Credit Orchestrator";
const DOCUMENT_BOT = "Document Completeness bot";
const POLICY_BOT = "Risk & Policy bot";
const EXCEPTION_SERVICE = "Exception service";

function step(id, label, state, holder, result) {
  return { id, label, state, holder: holder ?? null, result: result ?? null };
}

/**
 * Same seven steps for every path. The current step follows the status the orchestrator set.
 * WC-1002 marks Policy blocked. Steps the path does not use are skipped.
 */
export function workflowFor(caseDoc) {
  if (!caseDoc) {
    return [
      step("received", "Received", "waiting", null, null),
      step("documents", "Document check", "waiting", null, null),
      step("policy", "Policy", "waiting", null, null),
      step("advisory", "Advisory", "waiting", null, null),
      step("maker", "Maker", "waiting", null, null),
      step("checker", "Checker", "waiting", null, null),
      step("written", "Written back", "waiting", null, null),
    ];
  }

  const status = caseDoc.status;
  const stopped = status === "Awaiting documents";
  const outcome = caseDoc.policyOutcome;

  let received;
  if (status === "Received") received = step("received", "Received", "current", ORCHESTRATOR, null);
  else received = step("received", "Received", "done", null, "Received");

  let documents;
  if (status === "Received") documents = step("documents", "Document check", "waiting", null, null);
  else if (status === "Checking documents") documents = step("documents", "Document check", "current", DOCUMENT_BOT, null);
  else if (stopped) documents = step("documents", "Document check", "current", ORCHESTRATOR, "Gaps");
  else documents = step("documents", "Document check", "done", null, caseDoc.completeness);

  let policy;
  if (stopped || caseDoc.completeness === "Gaps") policy = step("policy", "Policy", "blocked", null, "Blocked");
  else if (!caseDoc.completeness) policy = step("policy", "Policy", "waiting", null, null);
  else if (status === "Checking policy") {
    policy = step(
      "policy",
      "Policy",
      "current",
      outcome ? ORCHESTRATOR : POLICY_BOT,
      outcome,
    );
  } else if (outcome) policy = step("policy", "Policy", "done", null, outcome);
  else policy = step("policy", "Policy", "waiting", null, null);

  const serviceSkipped = caseDoc.advisoryState === "Not required" || (outcome && outcome !== "Escalate");
  let advisory;
  if (stopped) advisory = step("advisory", "Advisory", "skipped", null, "Skipped");
  else if (serviceSkipped && outcome) advisory = step("advisory", "Advisory", "skipped", null, "Skipped");
  else if (status === "Drafting advisory") advisory = step("advisory", "Advisory", "current", EXCEPTION_SERVICE, null);
  else if (caseDoc.decisionPayload) {
    const result = caseDoc.advisoryState === "fallback" ? "Fallback" : "Returned";
    advisory = step("advisory", "Advisory", "done", null, result);
  } else advisory = step("advisory", "Advisory", "waiting", null, null);

  let maker;
  if (stopped || caseDoc.makerRequired === "No") maker = step("maker", "Maker", "skipped", null, "Skipped");
  else if (status === "Pending maker") maker = step("maker", "Maker", "current", "Maker seat", null);
  else if (caseDoc.makerAction) maker = step("maker", "Maker", "done", null, "Confirmed");
  else maker = step("maker", "Maker", "waiting", null, null);

  let checker;
  if (stopped || caseDoc.checkerRequired === "No") checker = step("checker", "Checker", "skipped", null, "Skipped");
  else if (status === "Pending checker") checker = step("checker", "Checker", "current", "Checker seat", null);
  else if (caseDoc.checkerAction) checker = step("checker", "Checker", "done", null, "Confirmed");
  else checker = step("checker", "Checker", "waiting", null, null);

  let written;
  if (stopped) written = step("written", "Written back", "skipped", null, "Skipped");
  else if (status === "Written back") written = step("written", "Written back", "done", null, "Written back");
  else if (status === "Decision final") written = step("written", "Written back", "current", ORCHESTRATOR, null);
  else written = step("written", "Written back", "waiting", null, null);

  return [received, documents, policy, advisory, maker, checker, written];
}
