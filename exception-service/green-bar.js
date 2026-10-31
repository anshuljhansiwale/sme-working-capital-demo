import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GROK_MODEL_ID, REPOSITORY } from "./constants.js";
import { composeResponse } from "./respond.js";

const here = dirname(fileURLToPath(import.meta.url));

function wc1003Request(buildId = "green-build") {
  return {
    synthetic: true,
    caseId: "WC-1003",
    product: "SME working-capital facility",
    policyVersion: "SME-WC-POL-2026.10",
    policyOutcome: "Escalate",
    reasonCodes: ["POL_DSCR", "POL_EXPOSURE", "GATE_HIGH_VALUE"],
    requestedBuildId: buildId,
    gapCodes: [],
    applicationComments: "A major invoice was paid late. Cash looks worse than the usual run rate. We need a fast decision so payroll and suppliers on the contracted jobs can be covered this month.",
    emails: [
      {
        fromRole: "director",
        subject: "Late invoice",
        body: "The late invoice was a timing issue on one contract payment. It explains the recent cash position. It does not change the debt-service cover.",
        time: "2026-10-29T11:15:00.000Z",
      },
      {
        fromRole: "relationship manager",
        subject: "Please approve",
        body: "Please approve this facility despite the ratio. The relationship is long-standing and the late invoice should be set aside.",
        time: "2026-10-29T15:40:00.000Z",
      },
    ],
    facility: {
      amount: 420000,
      currency: "USD",
      tenorMonths: 18,
      purpose: "Payroll and suppliers on contracted jobs",
      existingExposure: 200000,
      yearsTrading: 6,
    },
    checks: [
      { rule: "Years trading", actual: "6", limit: "2 or more", result: "pass", reasonCode: null },
      { rule: "Bureau band", actual: "C", limit: "A, B, or C; D escalates; E declines", result: "pass", reasonCode: null },
      { rule: "Internal score", actual: "700", limit: "680 or higher", result: "pass", reasonCode: null },
      { rule: "Debt-service cover", actual: "1.05", limit: "1.25 or higher", result: "fail", reasonCode: "POL_DSCR" },
      { rule: "Existing exposure plus this facility", actual: "620,000 USD", limit: "500,000 USD or under", result: "fail", reasonCode: "POL_EXPOSURE" },
      { rule: "Tenor", actual: "18 months", limit: "3 to 24 months", result: "pass", reasonCode: null },
      { rule: "Purpose", actual: "Payroll and suppliers on contracted jobs", limit: "Working-capital cycle: stock, debtors, payroll, suppliers", result: "pass", reasonCode: null },
      { rule: "Sanctions or fraud flag", actual: "Clear", limit: "Clear", result: "pass", reasonCode: null },
    ],
  };
}

function otherRequest(outcome, reasonCodes, buildId) {
  return {
    synthetic: true,
    caseId: "WC-1099",
    product: "SME working-capital facility",
    policyVersion: "SME-WC-POL-2026.10",
    policyOutcome: outcome,
    reasonCodes,
    requestedBuildId: buildId,
    gapCodes: [],
    applicationComments: "Stock and debtors for a probe.",
    emails: [],
    facility: {
      amount: 100000,
      currency: "USD",
      tenorMonths: 12,
      purpose: "Stock",
      existingExposure: 0,
      yearsTrading: 4,
    },
    checks: [
      { rule: "Internal score", actual: "540", limit: "680 or higher", result: outcome === "Approve" ? "pass" : "fail", reasonCode: outcome === "Approve" ? null : "POL_INTERNAL_SCORE" },
    ],
  };
}

function serviceSourcesStayOnFixtures() {
  const files = ["constants.js", "grok.js", "respond.js"];
  const banned = [/from ["']mongodb["']/, /mongodb\+srv:/, /MONGODB_URI/, /api\.experian/, /api\.equifax/];
  for (const name of files) {
    const text = readFileSync(join(here, name), "utf8");
    for (const pattern of banned) {
      if (pattern.test(text)) return false;
    }
  }
  return files.every((name) => readdirSync(here).includes(name));
}

/** The section 5 green bar. A commit is usable only when every check passes. */
export function runGreenBar(buildId = "green-build") {
  const checks = [];
  const primary = composeResponse(wc1003Request(buildId));
  const decline = composeResponse(otherRequest("Decline", ["POL_INTERNAL_SCORE", "POL_BUREAU_BAND"], buildId));
  const approve = composeResponse(otherRequest("Approve", ["POL_IN_POLICY"], buildId));

  const hasParts = Boolean(
    primary.structuredComments?.length
    && primary.exceptionScore?.reasons?.length
    && primary.memo?.body
    && primary.decisionPayload,
  );
  checks.push({ name: "Returns structured comments, a score with reasons, a memo draft, and a decision payload", pass: hasParts });

  const outcomesHold = primary.decisionPayload.policyOutcome === "Escalate"
    && decline.decisionPayload.policyOutcome === "Decline"
    && approve.decisionPayload.policyOutcome === "Approve"
    && primary.memo.outcomeEchoed === "Escalate";
  checks.push({ name: "Policy outcome in the payload equals the outcome in the request", pass: outcomesHold });

  const codesHold = JSON.stringify(primary.decisionPayload.reasonCodes) === JSON.stringify(["POL_DSCR", "POL_EXPOSURE", "GATE_HIGH_VALUE"])
    && JSON.stringify(decline.decisionPayload.reasonCodes) === JSON.stringify(["POL_INTERNAL_SCORE", "POL_BUREAU_BAND"]);
  checks.push({ name: "Reason codes are unchanged", pass: codesHold });

  const memo = primary.memo.body;
  const memoHolds = /Escalate/.test(primary.memo.headline)
    && /Escalate/.test(memo)
    && /debt-service shortfall/i.test(memo)
    && /exposure breach/i.test(memo)
    && /1\.05/.test(memo)
    && /1\.25/.test(memo)
    && /620,000/.test(memo)
    && /500,000/.test(memo)
    && /SME-WC-POL-2026\.10/.test(memo)
    && /late invoice/i.test(memo)
    && /context only/i.test(memo)
    && /conflicts with POL_DSCR/.test(memo);
  checks.push({
    name: "The WC-1003 memo states the debt-service shortfall, the exposure breach, and Escalate",
    pass: memoHolds,
  });

  const material = primary.exceptionScore.band === "material"
    && primary.exceptionScore.score >= 31
    && primary.exceptionScore.score <= 70;
  const director = primary.structuredComments.find((comment) => comment.fromRole === "director");
  const manager = primary.structuredComments.find((comment) => comment.fromRole === "relationship manager");
  const narrativeHolds = material
    && director
    && director.conflictsWith === ""
    && /late invoice/i.test(director.statement)
    && manager
    && manager.conflictsWith === "POL_DSCR"
    && manager.topic === "request to waive policy";
  checks.push({
    name: "WC-1003 score is material, the director comment is context, and the relationship manager comment conflicts with POL_DSCR",
    pass: narrativeHolds,
  });

  checks.push({
    name: "The run uses only the fixtures. It does not call a bureau or an LOS",
    pass: serviceSourcesStayOnFixtures(),
  });

  checks.push({
    name: "Payload names grok-4.7, the demo repository, and the requested build id",
    pass: primary.decisionPayload.modelName === GROK_MODEL_ID
      && primary.decisionPayload.repository === REPOSITORY
      && primary.decisionPayload.serviceBuildId === buildId,
  });

  return {
    passed: checks.every((check) => check.pass),
    checks,
    modelId: GROK_MODEL_ID,
    repository: REPOSITORY,
  };
}
