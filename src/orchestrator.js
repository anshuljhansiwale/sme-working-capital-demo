import { availableActions } from "./actions.js";
import { appendAudit, setStatus } from "./audit.js";
import { addBusinessDays } from "./dates.js";
import { payloadMatchesRequest } from "../exception-service/respond.js";
import { chaseText, inPolicyNote, reasonCodeMemo } from "./memos.js";
import { evaluateCase, formatMoney, gateFlags, HIGH_VALUE_ABOVE, POLICY_VERSION, PRODUCT, SYNTHETIC_MARKER } from "./policy.js";
import { copyDocuments } from "./required-documents.js";
import { workflowFor } from "./workflow.js";

export class CaseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ORCH = "Lead Credit Orchestrator";
const DOC_BOT = "Document Completeness bot";
const POL_BOT = "Risk & Policy bot";

function clockNow(clock) {
  return clock?.now ? clock.now() : new Date();
}

function iso(clock) {
  return clockNow(clock).toISOString();
}

export function present(caseDoc) {
  if (!caseDoc) return null;
  return {
    ...caseDoc,
    workflow: workflowFor(caseDoc),
    actions: availableActions(caseDoc),
  };
}

async function loadCase(db, caseId) {
  const caseDoc = await db.collection("cases").findOne({ caseId }, { projection: { _id: 0 } });
  if (!caseDoc) throw new CaseError(404, `No case ${caseId} has been received.`);
  return caseDoc;
}

async function save(db, caseDoc) {
  await db.collection("cases").replaceOne({ caseId: caseDoc.caseId }, caseDoc, { upsert: true });
  return caseDoc;
}

async function loadIntakeFixture(db, caseId) {
  const fixture = await db.collection("fixtures").findOne(
    { caseId },
    {
      projection: {
        _id: 0,
        caseId: 1,
        legalName: 1,
        yearsTrading: 1,
        existingExposure: 1,
        facilityAmount: 1,
        tenorMonths: 1,
        purpose: 1,
        applicationComments: 1,
        emails: 1,
      },
    },
  );
  if (!fixture) throw new CaseError(404, `No synthetic fixture for ${caseId}.`);
  return fixture;
}

async function loadDocumentFixture(db, caseId) {
  const fixture = await db.collection("fixtures").findOne(
    { caseId },
    { projection: { _id: 0, caseId: 1, documents: 1 } },
  );
  if (!fixture) throw new CaseError(404, `No synthetic fixture for ${caseId}.`);
  return fixture;
}

async function loadPolicyFixture(db, caseId) {
  return db.collection("fixtures").findOne(
    { caseId },
    {
      projection: {
        _id: 0,
        caseId: 1,
        bureau: 1,
        internalScore: 1,
        debtServiceCover: 1,
        sanctionsFlag: 1,
      },
    },
  );
}

function blankCase(fixture, source, receivedAt) {
  return {
    caseId: fixture.caseId,
    product: PRODUCT,
    source,
    receivedAt,
    syntheticMarker: SYNTHETIC_MARKER,
    legalName: fixture.legalName,
    yearsTrading: fixture.yearsTrading,
    existingExposure: fixture.existingExposure,
    facilityAmount: fixture.facilityAmount,
    currency: "USD",
    tenorMonths: fixture.tenorMonths,
    purpose: fixture.purpose,
    applicationComments: fixture.applicationComments,
    emails: (fixture.emails ?? []).map((email) => ({ ...email })),
    documents: [],
    completeness: null,
    gapCodes: [],
    chaseState: "None",
    slaDue: null,
    chaseText: null,
    status: null,
    policyVersion: null,
    bureauSnapshot: null,
    internalScore: null,
    debtServiceCover: null,
    policyChecks: [],
    policyOutcome: null,
    reasonCodes: [],
    advisoryState: null,
    serviceBuildId: null,
    structuredComments: [],
    exceptionScore: null,
    modelMemo: null,
    templateMemo: null,
    advisoryConflict: null,
    decisionPayload: null,
    makerRequired: null,
    checkerRequired: null,
    finalMemo: null,
    makerAction: null,
    checkerAction: null,
    finalDecision: null,
    finalizedAt: null,
    losReference: null,
    writtenBackAt: null,
    modelName: null,
    modelInvocation: null,
    auditLines: [],
  };
}

function sourceLabel(source) {
  if (source === "file-drop") return "file drop";
  if (source === "simulated-los-webhook") return "simulated LOS webhook";
  return source;
}

export async function intake(db, caseId, source, clock) {
  if (source !== "file-drop" && source !== "simulated-los-webhook") {
    throw new CaseError(400, "Source must be a file drop or a simulated LOS webhook.");
  }
  const existing = await db.collection("cases").findOne({ caseId }, { projection: { caseId: 1 } });
  if (existing) throw new CaseError(409, "This path already has a case. Reset it before receiving the file again.");
  const fixture = await loadIntakeFixture(db, caseId);
  const time = iso(clock);
  const caseDoc = blankCase(fixture, source, time);
  appendAudit(caseDoc, {
    time,
    actor: ORCH,
    eventType: "CASE_RECEIVED",
    statusBefore: null,
    statusAfter: null,
    detail: `Source ${sourceLabel(source)}. Product ${PRODUCT}. Amount ${formatMoney(caseDoc.facilityAmount)}.`,
  });
  setStatus(caseDoc, "Received", time);
  await save(db, caseDoc);
  return present(caseDoc);
}

export async function checkDocuments(db, caseId, clock) {
  const caseDoc = await loadCase(db, caseId);
  if (caseDoc.status !== "Received") throw new CaseError(409, "Document check starts from Received.");
  const time = iso(clock);
  setStatus(caseDoc, "Checking documents", time);
  appendAudit(caseDoc, {
    time,
    actor: DOC_BOT,
    eventType: "BOT_STARTED",
    detail: "Bot name: Document Completeness bot.",
  });

  const fixture = await loadDocumentFixture(db, caseId);
  const result = copyDocuments(fixture);
  caseDoc.documents = result.documents;
  caseDoc.completeness = result.completeness;
  caseDoc.gapCodes = result.gapCodes;

  const listed = result.documents
    .map((doc) => `${doc.type}: ${doc.present ? "present" : "missing"}`)
    .join(". ");
  appendAudit(caseDoc, {
    time,
    actor: DOC_BOT,
    eventType: "BOT_COMPLETED",
    detail: "Bot name: Document Completeness bot. Fields written: documents, completeness, gap codes.",
  });
  appendAudit(caseDoc, {
    time,
    actor: DOC_BOT,
    eventType: "DOCUMENTS_CHECKED",
    detail: `Completeness ${result.completeness}. ${listed}.`,
  });

  if (result.completeness === "Gaps") {
    appendAudit(caseDoc, {
      time,
      actor: DOC_BOT,
      eventType: "GAPS_FOUND",
      detail: result.gapCodes.join(", "),
    });
    const due = addBusinessDays(time, 2);
    caseDoc.chaseState = "Open";
    caseDoc.slaDue = due;
    caseDoc.chaseText = chaseText(caseDoc, due);
    appendAudit(caseDoc, {
      time,
      actor: ORCH,
      eventType: "CHASE_OPENED",
      detail: "Chase template stored on the case.",
    });
    appendAudit(caseDoc, {
      time,
      actor: ORCH,
      eventType: "SLA_SET",
      detail: due,
    });
    setStatus(caseDoc, "Awaiting documents", time);
    appendAudit(caseDoc, {
      time,
      actor: ORCH,
      eventType: "GATE_BLOCKED",
      detail: result.gapCodes.join(", "),
    });
  } else {
    setStatus(caseDoc, "Checking policy", time);
  }

  await save(db, caseDoc);
  return present(caseDoc);
}

function applyPolicy(caseDoc, fixture, time) {
  const result = evaluateCase({
    completeness: caseDoc.completeness,
    facility: {
      yearsTrading: caseDoc.yearsTrading,
      existingExposure: caseDoc.existingExposure,
      facilityAmount: caseDoc.facilityAmount,
      tenorMonths: caseDoc.tenorMonths,
      purpose: caseDoc.purpose,
    },
    bureau: fixture.bureau,
    internalScore: fixture.internalScore,
    debtServiceCover: fixture.debtServiceCover,
    sanctionsFlag: fixture.sanctionsFlag,
    pullTime: time,
  });
  if (result.blocked) return result;

  caseDoc.policyVersion = result.policyVersion;
  appendAudit(caseDoc, {
    time,
    actor: POL_BOT,
    eventType: "POLICY_VERSION_RECORDED",
    detail: result.policyVersion,
  });
  caseDoc.bureauSnapshot = result.bureauSnapshot;
  caseDoc.internalScore = result.internalScore;
  caseDoc.debtServiceCover = result.debtServiceCover;
  caseDoc.policyChecks = result.policyChecks;
  caseDoc.policyOutcome = result.policyOutcome;
  caseDoc.reasonCodes = result.reasonCodes;
  const flags = gateFlags(result.policyOutcome, caseDoc.facilityAmount);
  caseDoc.makerRequired = flags.makerRequired;
  caseDoc.checkerRequired = flags.checkerRequired;
  if (result.policyOutcome !== "Escalate") caseDoc.advisoryState = "Not required";

  const checkText = result.policyChecks
    .map((entry) => `${entry.rule}: actual ${entry.actual}, limit ${entry.limit}, ${entry.result}`)
    .join(". ");
  appendAudit(caseDoc, {
    time,
    actor: POL_BOT,
    eventType: "BOT_COMPLETED",
    detail: "Bot name: Risk & Policy bot. Fields written: policy version, bureau snapshot, internal score, debt-service cover, policy checks, policy outcome, reason codes.",
  });
  appendAudit(caseDoc, {
    time,
    actor: POL_BOT,
    eventType: "POLICY_EVALUATED",
    detail: `Outcome ${result.policyOutcome}. Reason codes ${result.reasonCodes.join(", ")}. ${checkText}.`,
  });
  return result;
}

export async function startPolicy(db, caseId, clock) {
  const caseDoc = await loadCase(db, caseId);
  const time = iso(clock);
  if (caseDoc.completeness !== "Complete") {
    appendAudit(caseDoc, {
      time,
      actor: ORCH,
      eventType: "RISK_BLOCKED_INCOMPLETE",
      detail: "The bureau fixture was not read. No bureau snapshot was written to the case.",
    });
    await save(db, caseDoc);
    return { blocked: true, case: present(caseDoc) };
  }
  if (caseDoc.status !== "Checking policy") {
    throw new CaseError(409, "Policy runs only while the case is Checking policy.");
  }
  if (caseDoc.policyOutcome) throw new CaseError(409, "The policy outcome is already written.");

  appendAudit(caseDoc, {
    time,
    actor: POL_BOT,
    eventType: "BOT_STARTED",
    detail: "Bot name: Risk & Policy bot.",
  });
  const fixture = await loadPolicyFixture(db, caseId);
  applyPolicy(caseDoc, fixture, time);
  await save(db, caseDoc);
  return { blocked: false, case: present(caseDoc) };
}

function assertGates(caseDoc) {
  if (caseDoc.makerRequired === "Yes" && !caseDoc.makerAction) {
    throw new CaseError(409, "Write-back waits for the maker.");
  }
  if (caseDoc.checkerRequired === "Yes" && !caseDoc.checkerAction) {
    throw new CaseError(409, "Write-back waits for the checker.");
  }
}

function lockDecision(caseDoc, time) {
  caseDoc.finalDecision = caseDoc.policyOutcome;
  caseDoc.finalizedAt = time;
  const seats = [];
  if (caseDoc.makerRequired === "Yes") seats.push("maker");
  if (caseDoc.checkerRequired === "Yes") seats.push("checker");
  if (seats.length) {
    appendAudit(caseDoc, {
      time,
      actor: ORCH,
      eventType: "GATE_PASSED",
      detail: `Seats required: ${seats.join(", ")}.`,
    });
  }
  setStatus(caseDoc, "Decision final", time);
  appendAudit(caseDoc, {
    time,
    actor: ORCH,
    eventType: "DECISION_FINAL",
    detail: `Outcome ${caseDoc.finalDecision} copied from the policy outcome. Reason codes ${caseDoc.reasonCodes.join(", ")}.`,
  });
}

export async function finalizeStraightThrough(db, caseId, clock) {
  const caseDoc = await loadCase(db, caseId);
  if (caseDoc.policyOutcome !== "Approve" || caseDoc.makerRequired !== "No" || caseDoc.checkerRequired !== "No") {
    throw new CaseError(409, "Straight-through finality is only for an in-policy Approve at or under the high-value line.");
  }
  if (caseDoc.status !== "Checking policy") throw new CaseError(409, "The case is not waiting to be finalized.");
  const time = iso(clock);
  caseDoc.advisoryState = "Not required";
  caseDoc.finalMemo = inPolicyNote(caseDoc);
  appendAudit(caseDoc, {
    time,
    actor: ORCH,
    eventType: "ADVISORY_NOT_REQUIRED",
    detail: "Clean Approve at or under the high-value line. The exception service was not called. There is nothing to extract.",
  });
  appendAudit(caseDoc, {
    time,
    actor: ORCH,
    eventType: "GATE_NOT_REQUIRED",
    detail: `Facility ${formatMoney(caseDoc.facilityAmount)} is at or under ${formatMoney(HIGH_VALUE_ABOVE)}. No maker and no checker.`,
  });
  lockDecision(caseDoc, time);
  await save(db, caseDoc);
  return present(caseDoc);
}

export async function openMaker(db, caseId, clock) {
  const caseDoc = await loadCase(db, caseId);
  if (caseDoc.policyOutcome === "Escalate") {
    throw new CaseError(409, "An escalation opens the maker gate only after the exception service returns.");
  }
  if (caseDoc.makerRequired !== "Yes") throw new CaseError(409, "This case does not need a maker.");
  if (caseDoc.status !== "Checking policy") throw new CaseError(409, "The maker gate is not open yet.");
  const time = iso(clock);
  caseDoc.templateMemo = reasonCodeMemo(caseDoc);
  caseDoc.advisoryState = "Not required";
  if (caseDoc.policyOutcome === "Approve") {
    appendAudit(caseDoc, {
      time,
      actor: ORCH,
      eventType: "ADVISORY_NOT_REQUIRED",
      detail: "Clean Approve over the high-value line. The exception service was not called. The memo is a short note from the policy result.",
    });
  }
  setStatus(caseDoc, "Pending maker", time);
  await save(db, caseDoc);
  return present(caseDoc);
}

function exceptionRequest(caseDoc, buildId) {
  return {
    synthetic: true,
    caseId: caseDoc.caseId,
    product: caseDoc.product,
    policyVersion: caseDoc.policyVersion,
    policyOutcome: caseDoc.policyOutcome,
    reasonCodes: [...caseDoc.reasonCodes],
    checks: caseDoc.policyChecks.map((check) => ({ ...check })),
    facility: {
      amount: caseDoc.facilityAmount,
      currency: caseDoc.currency,
      tenorMonths: caseDoc.tenorMonths,
      purpose: caseDoc.purpose,
      existingExposure: caseDoc.existingExposure,
      yearsTrading: caseDoc.yearsTrading,
    },
    applicationComments: caseDoc.applicationComments,
    emails: caseDoc.emails.map((email) => ({ ...email })),
    gapCodes: [...(caseDoc.gapCodes ?? [])],
    requestedBuildId: buildId,
  };
}

function storeAdvisory(caseDoc, response, time, fallbackUsed) {
  const conflict = response.memo?.outcomeEchoed && response.memo.outcomeEchoed !== caseDoc.policyOutcome;
  caseDoc.structuredComments = response.structuredComments;
  caseDoc.exceptionScore = response.exceptionScore;
  caseDoc.modelMemo = response.memo;
  caseDoc.templateMemo = null;
  caseDoc.decisionPayload = {
    ...response.decisionPayload,
    fallbackUsed: fallbackUsed ? "Yes" : "No",
    serviceBuildId: caseDoc.serviceBuildId,
  };
  caseDoc.modelName = response.decisionPayload.modelName;
  caseDoc.modelInvocation = response.modelInvocation ?? null;
  caseDoc.advisoryConflict = conflict ? "Yes" : "No";
  caseDoc.advisoryState = fallbackUsed ? "fallback" : "returned";
  appendAudit(caseDoc, {
    time,
    actor: ORCH,
    eventType: "ADVISORY_RETURNED",
    detail: `Score ${response.exceptionScore.score}, band ${response.exceptionScore.band}, outcome ${response.decisionPayload.policyOutcome} copied, reason codes ${response.decisionPayload.reasonCodes.join(", ")} copied. Model ${response.decisionPayload.modelName}.`,
  });
  if (conflict) {
    appendAudit(caseDoc, {
      time,
      actor: ORCH,
      eventType: "ADVISORY_CONFLICT",
      detail: `Draft wording ${response.memo.outcomeEchoed}. Policy outcome ${caseDoc.policyOutcome}. The policy outcome remains.`,
    });
  }
  appendAudit(caseDoc, {
    time,
    actor: ORCH,
    eventType: "MODEL_DRAFT_STORED",
    detail: `Memo ${response.memo.memoId}.`,
  });
  setStatus(caseDoc, "Pending maker", time);
}

async function callWithTimeout(callService, request, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      callService(request),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("The exception service did not return within 15 seconds.");
          error.code = "TIMEOUT";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function selectBuild(db, caseId, { mode, clock, callService, build, timeoutMs = 15_000 }) {
  const caseDoc = await loadCase(db, caseId);
  if (caseDoc.status !== "Checking policy" || caseDoc.policyOutcome !== "Escalate" || caseDoc.decisionPayload) {
    throw new CaseError(409, "A build is selected only after policy has written Escalate and before advisory is stored.");
  }
  if (!build?.commit || !build.green) throw new CaseError(409, "There is no green commit to call.");
  const time = iso(clock);
  let fallbackUsed = false;
  let selected = build.commit;

  if (mode === "landed") {
    if (caseDoc.auditLines.some((line) => line.eventType === "CHECKIN_FAILED")) {
      throw new CaseError(409, "The time box already expired. Use the last green build.");
    }
    appendAudit(caseDoc, {
      time,
      actor: "Exception Service agent",
      eventType: "CHECKIN_LANDED",
      detail: `Repository ${build.repository}. Commit ${build.commit}.`,
    });
    caseDoc.serviceBuildId = build.commit;
    appendAudit(caseDoc, {
      time,
      actor: ORCH,
      eventType: "SERVICE_BUILD_SELECTED",
      detail: build.commit,
    });
  } else if (mode === "last-green") {
    fallbackUsed = true;
    selected = build.commit;
    caseDoc.serviceBuildId = build.commit;
    appendAudit(caseDoc, {
      time,
      actor: ORCH,
      eventType: "FALLBACK_BUILD_USED",
      detail: `Attempted commit none. Last green commit ${build.commit}.`,
    });
  } else {
    throw new CaseError(400, "Mode must be landed or last-green.");
  }

  setStatus(caseDoc, "Drafting advisory", time);
  caseDoc.advisoryState = "requested";
  appendAudit(caseDoc, {
    time,
    actor: ORCH,
    eventType: "ADVISORY_REQUESTED",
    detail: caseDoc.serviceBuildId,
  });

  const request = exceptionRequest(caseDoc, selected);
  const accepted = async (request) => {
    try {
      const response = await callWithTimeout(callService, request, timeoutMs);
      if (payloadMatchesRequest(request, response)) return response;
      appendAudit(caseDoc, {
        time,
        actor: ORCH,
        eventType: "ADVISORY_CONFLICT",
        detail: `Draft wording ${response?.decisionPayload?.policyOutcome ?? response?.memo?.outcomeEchoed ?? "missing"}. Policy outcome ${caseDoc.policyOutcome}. The policy outcome remains. The response was rejected.`,
      });
      return null;
    } catch {
      return null;
    }
  };

  let response = await accepted(request);
  if (!response) {
    const retryRequest = exceptionRequest(caseDoc, build.commit);
    if (!fallbackUsed) {
      fallbackUsed = true;
      caseDoc.serviceBuildId = build.commit;
      appendAudit(caseDoc, {
        time,
        actor: ORCH,
        eventType: "FALLBACK_BUILD_USED",
        detail: `Attempted commit ${selected}. Last green commit ${build.commit}.`,
      });
    }
    response = await accepted(retryRequest);
    if (!response) {
      caseDoc.advisoryState = null;
      caseDoc.serviceBuildId = null;
      setStatus(caseDoc, "Checking policy", time, "Advisory did not return a usable payload. The policy outcome is unchanged.");
      await save(db, caseDoc);
      throw new CaseError(502, "The last green build did not return a payload that copies the policy outcome. Nothing was stored.");
    }
  }

  storeAdvisory(caseDoc, response, time, fallbackUsed);
  await save(db, caseDoc);
  return present(caseDoc);
}

export async function timeBoxElapsed(db, caseId, clock, build) {
  const caseDoc = await loadCase(db, caseId);
  if (caseDoc.policyOutcome !== "Escalate" || caseDoc.decisionPayload || caseDoc.status !== "Checking policy") {
    throw new CaseError(409, "The time box applies while an escalation is waiting for a build.");
  }
  if (caseDoc.auditLines.some((line) => line.eventType === "CHECKIN_FAILED")) {
    throw new CaseError(409, "The time box is already recorded.");
  }
  const time = iso(clock);
  appendAudit(caseDoc, {
    time,
    actor: ORCH,
    eventType: "CHECKIN_FAILED",
    detail: `No new commit was on the repository inside the four-minute box. The repository still has the last green commit ${build.commit}.`,
  });
  await save(db, caseDoc);
  return present(caseDoc);
}

function draftText(caseDoc) {
  if (caseDoc.modelMemo?.body) return `${caseDoc.modelMemo.headline}\n\n${caseDoc.modelMemo.body}`;
  return caseDoc.templateMemo ?? "";
}

function normalizeMemo(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

export async function confirmMaker(db, caseId, { seat, finalMemo }, clock) {
  const caseDoc = await loadCase(db, caseId);
  if (caseDoc.status !== "Pending maker") throw new CaseError(409, "The maker seat opens only when status is Pending maker.");
  if (seat !== "maker") throw new CaseError(409, "Switch to the maker seat to confirm.");
  const text = normalizeMemo(finalMemo);
  if (!text) throw new CaseError(400, "The memo text is empty.");
  const time = iso(clock);
  const edited = text !== normalizeMemo(draftText(caseDoc));
  caseDoc.finalMemo = text;
  if (edited) {
    appendAudit(caseDoc, {
      time,
      actor: "Maker seat",
      eventType: "MEMO_EDITED",
      detail: `Memo ${caseDoc.modelMemo?.memoId ?? caseDoc.caseId}. The model text and the edited text both remain on the case.`,
    });
  }
  caseDoc.makerAction = { seat: "maker", result: "Confirmed", edited, at: time };
  appendAudit(caseDoc, {
    time,
    actor: "Maker seat",
    eventType: "MAKER_CONFIRMED",
    detail: `Seat maker. Time ${time}. Text changed: ${edited ? "yes" : "no"}.`,
  });
  if (caseDoc.checkerRequired === "Yes") setStatus(caseDoc, "Pending checker", time);
  else lockDecision(caseDoc, time);
  await save(db, caseDoc);
  return present(caseDoc);
}

export async function confirmChecker(db, caseId, { seat }, clock) {
  const caseDoc = await loadCase(db, caseId);
  if (caseDoc.status !== "Pending checker") throw new CaseError(409, "The checker seat opens only when status is Pending checker.");
  if (caseDoc.checkerRequired !== "Yes") throw new CaseError(409, "This facility is not over the high-value line.");
  if (seat !== "checker") throw new CaseError(409, "Switch to the checker seat to confirm.");
  const time = iso(clock);
  caseDoc.checkerAction = { seat: "checker", result: "Confirmed", at: time };
  appendAudit(caseDoc, {
    time,
    actor: "Checker seat",
    eventType: "CHECKER_CONFIRMED",
    detail: `Seat checker. Time ${time}.`,
  });
  lockDecision(caseDoc, time);
  await save(db, caseDoc);
  return present(caseDoc);
}

export async function writeBack(db, caseId, clock) {
  const caseDoc = await loadCase(db, caseId);
  assertGates(caseDoc);
  if (caseDoc.status !== "Decision final") throw new CaseError(409, "Write-back runs only after the decision is final.");
  if (caseDoc.finalDecision !== caseDoc.policyOutcome) {
    throw new CaseError(409, "The final decision must stay a copy of the policy outcome.");
  }
  const time = iso(clock);
  const suffix = caseDoc.caseId.slice(-4);
  caseDoc.losReference = `LOS-DEMO-${suffix}`;
  caseDoc.writtenBackAt = time;
  const build = caseDoc.serviceBuildId ? ` Service build ${caseDoc.serviceBuildId}.` : "";
  appendAudit(caseDoc, {
    time,
    actor: ORCH,
    eventType: "LOS_WRITEBACK",
    detail: `Simulated reference ${caseDoc.losReference}. Outcome ${caseDoc.finalDecision}. Policy ${caseDoc.policyVersion ?? POLICY_VERSION}.${build}`,
  });
  setStatus(caseDoc, "Written back", time);
  await save(db, caseDoc);
  return present(caseDoc);
}

export async function resetCase(db, caseId) {
  const fixture = await db.collection("fixtures").findOne({ caseId }, { projection: { caseId: 1 } });
  if (!fixture) throw new CaseError(404, `No synthetic fixture for ${caseId}.`);
  await db.collection("cases").deleteOne({ caseId });
  return { reset: true, caseId };
}
