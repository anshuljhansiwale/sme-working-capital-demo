import { GROK_MODEL_ID, PRODUCT, REPOSITORY } from "./constants.js";

const TOPICS = new Set([
  "purpose",
  "cash flow",
  "delay",
  "existing debt",
  "request to waive policy",
  "other",
]);

function sameCodes(left, right) {
  const a = [...(left ?? [])].sort();
  const b = [...(right ?? [])].sort();
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

function bandFor(score) {
  if (score <= 30) return "low";
  if (score <= 70) return "material";
  return "severe";
}

function failedPolicyCodes(reasonCodes) {
  return (reasonCodes ?? []).filter((code) => code.startsWith("POL_") && code !== "POL_IN_POLICY");
}

export function scoreException(reasonCodes, comments) {
  const failed = failedPolicyCodes(reasonCodes);
  let score = 26 + failed.length * 16;
  if ((comments ?? []).some((comment) => comment.conflictsWith)) score += 8;
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return { score, band: bandFor(score) };
}

function waiverRequest(text) {
  return /approve despite|approve anyway|set aside|waive/i.test(text);
}

function aboutDelay(text) {
  return /late invoice|delay|will follow/i.test(text);
}

function aboutCash(text) {
  return /cash|run rate/i.test(text);
}

function firstConflictCode(reasonCodes) {
  if ((reasonCodes ?? []).includes("POL_DSCR")) return "POL_DSCR";
  return failedPolicyCodes(reasonCodes)[0] ?? "";
}

function commentFromApplication(request, index) {
  const text = request.applicationComments ?? "";
  if (!text.trim()) return null;
  let topic = "other";
  if (aboutCash(text)) topic = "cash flow";
  else if (aboutDelay(text)) topic = "delay";
  else if (/stock|debtor|payroll|supplier/i.test(text)) topic = "purpose";
  const asksWaiver = waiverRequest(text);
  if (asksWaiver) topic = "request to waive policy";
  return {
    commentId: `cmt-${request.caseId}-${index}`,
    source: "Application comments",
    sourceReference: "application",
    fromRole: "applicant",
    topic,
    statement: text.trim(),
    conflictsWith: asksWaiver ? firstConflictCode(request.reasonCodes) : "",
    confidence: "Medium",
  };
}

function commentFromEmail(request, email, index) {
  const text = `${email.subject ?? ""}. ${email.body ?? ""}`.trim();
  const asksWaiver = waiverRequest(text);
  let topic = "other";
  if (asksWaiver) topic = "request to waive policy";
  else if (aboutDelay(text)) topic = "delay";
  else if (aboutCash(text)) topic = "cash flow";
  else if (/exposure|existing debt|outstanding/i.test(text)) topic = "existing debt";
  const role = email.fromRole || "sender";
  return {
    commentId: `cmt-${request.caseId}-${index}`,
    source: "email",
    sourceReference: `email ${index} — ${role} — ${email.subject ?? "message"}`,
    fromRole: role,
    topic,
    statement: (email.body || text).trim(),
    conflictsWith: asksWaiver ? firstConflictCode(request.reasonCodes) : "",
    confidence: "High",
  };
}

export function extractComments(request) {
  const comments = [];
  const application = commentFromApplication(request, comments.length + 1);
  if (application) comments.push(application);
  for (const email of request.emails ?? []) {
    comments.push(commentFromEmail(request, email, comments.length + 1));
  }
  for (const comment of comments) {
    if (!TOPICS.has(comment.topic)) comment.topic = "other";
  }
  return comments;
}

function checkSentence(check) {
  const code = check.reasonCode ? `${check.reasonCode}: ` : "";
  return `${code}${check.rule}: actual ${check.actual}, limit ${check.limit}.`;
}

function breachSentences(request) {
  const lines = [];
  const byCode = new Map((request.checks ?? []).filter((check) => check.reasonCode).map((check) => [check.reasonCode, check]));
  if (byCode.has("POL_DSCR")) {
    const check = byCode.get("POL_DSCR");
    lines.push(`Debt-service shortfall: actual ${check.actual} against limit ${check.limit}.`);
  }
  if (byCode.has("POL_EXPOSURE")) {
    const check = byCode.get("POL_EXPOSURE");
    lines.push(`Exposure breach: actual ${check.actual} against limit ${check.limit}.`);
  }
  return lines;
}

export function draftMemo(request, comments) {
  const headline = `${request.product} — ${request.policyOutcome} — ${request.caseId}`;
  const paragraphs = [
    `Policy ${request.policyVersion}. The policy outcome is ${request.policyOutcome}. This draft is advisory and does not replace that outcome.`,
  ];
  for (const check of request.checks ?? []) {
    if (check.result === "fail") paragraphs.push(checkSentence(check));
  }
  paragraphs.push(...breachSentences(request));
  if ((request.reasonCodes ?? []).includes("GATE_HIGH_VALUE")) {
    paragraphs.push("GATE_HIGH_VALUE applies because the facility is over the high-value line. The outcome word is unchanged. A checker is required.");
  }
  for (const comment of comments) {
    if (comment.conflictsWith) {
      paragraphs.push(`${comment.fromRole} asks to approve anyway. That comment conflicts with ${comment.conflictsWith}. It is not a waiver.`);
    } else {
      paragraphs.push(`${comment.fromRole}: ${comment.statement} This is context only and does not clear a rule.`);
    }
  }
  return {
    memoId: `memo-${request.caseId}`,
    headline,
    body: paragraphs.join("\n\n"),
    outcomeEchoed: request.policyOutcome,
    editable: "Yes",
  };
}

function scoreReasons(request, comments) {
  return failedPolicyCodes(request.reasonCodes).map((code) => {
    const asks = comments.some((comment) => comment.conflictsWith === code);
    const check = (request.checks ?? []).find((entry) => entry.reasonCode === code);
    const explanation = check
      ? `${check.rule}: actual ${check.actual}, limit ${check.limit}. The rule still failed.`
      : `${code} remains on the policy result.`;
    return {
      code,
      explanation,
      contextLabel: asks ? "Asks to waive" : "Context only",
    };
  });
}

function assertRequest(request) {
  if (!request || request.synthetic !== true) {
    throw new Error("The exception service accepts synthetic fixture requests only.");
  }
  const required = ["caseId", "product", "policyVersion", "policyOutcome", "reasonCodes", "requestedBuildId"];
  for (const field of required) {
    if (request[field] === undefined || request[field] === null || request[field] === "") {
      throw new Error(`Missing ${field}.`);
    }
  }
  if (!["Approve", "Decline", "Escalate"].includes(request.policyOutcome)) {
    throw new Error("Policy outcome must be Approve, Decline, or Escalate.");
  }
  if (request.product !== PRODUCT) {
    throw new Error("Product must be the SME working-capital facility.");
  }
}

/**
 * Builds the four returns. The decision payload copies the request outcome and reason codes.
 * Model prose cannot replace them. With no usable model draft, the fixture extraction is the response.
 */
export function composeResponse(request, { modelDraft = null, now = new Date(), fallbackUsed = false } = {}) {
  assertRequest(request);
  const comments = extractComments(request);
  const scored = scoreException(request.reasonCodes, comments);
  const memo = draftMemo(request, comments);
  const generatedAt = (now instanceof Date ? now : new Date(now)).toISOString();

  let modelInvocation = modelDraft ?? {
    invoked: false,
    model: GROK_MODEL_ID,
    reason: "No model draft was attached. The fixture response was used.",
  };
  if (modelInvocation.invoked && modelInvocation.raw) {
    modelInvocation = {
      ...modelInvocation,
      reason: `${modelInvocation.reason} The stored memo is the contract draft so the outcome and reason codes stay copied from the request.`,
    };
  }

  const decisionPayload = {
    caseId: request.caseId,
    product: request.product,
    policyVersion: request.policyVersion,
    policyOutcome: request.policyOutcome,
    reasonCodes: [...request.reasonCodes],
    exceptionScore: scored.score,
    exceptionBand: scored.band,
    commentIds: comments.map((comment) => comment.commentId),
    memoId: memo.memoId,
    modelName: GROK_MODEL_ID,
    repository: REPOSITORY,
    serviceBuildId: request.requestedBuildId,
    generatedAt,
    fallbackUsed: fallbackUsed ? "Yes" : "No",
  };

  if (decisionPayload.policyOutcome !== request.policyOutcome || !sameCodes(decisionPayload.reasonCodes, request.reasonCodes)) {
    throw new Error("Refusing to emit a payload whose outcome or reason codes differ from the request.");
  }
  if (memo.outcomeEchoed !== request.policyOutcome) {
    throw new Error("Refusing to echo a different outcome.");
  }

  return {
    structuredComments: comments,
    exceptionScore: {
      score: scored.score,
      band: scored.band,
      reasons: scoreReasons(request, comments),
    },
    memo,
    decisionPayload,
    modelInvocation,
  };
}

export function payloadMatchesRequest(request, response) {
  const payload = response?.decisionPayload;
  if (!payload) return false;
  return payload.policyOutcome === request.policyOutcome
    && sameCodes(payload.reasonCodes, request.reasonCodes)
    && payload.caseId === request.caseId;
}
