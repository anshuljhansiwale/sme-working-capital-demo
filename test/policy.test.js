import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCase, gateFlags } from "../src/policy.js";

function facts(overrides = {}) {
  return {
    completeness: "Complete",
    facility: {
      yearsTrading: 8,
      existingExposure: 0,
      facilityAmount: 180_000,
      tenorMonths: 12,
      purpose: "Stock and debtors",
      ...overrides.facility,
    },
    bureau: { band: "B", delinquencyCount: 0, fixtureReference: "synthetic-bureau://test", ...overrides.bureau },
    internalScore: overrides.internalScore ?? 760,
    debtServiceCover: overrides.debtServiceCover ?? 1.6,
    sanctionsFlag: overrides.sanctionsFlag ?? "clear",
    pullTime: "2026-10-31T12:00:00.000Z",
  };
}

test("a clean file at or under 250,000 approves in policy with no high-value gate", () => {
  const result = evaluateCase(facts());
  assert.equal(result.policyOutcome, "Approve");
  assert.deepEqual(result.reasonCodes, ["POL_IN_POLICY"]);
  assert.equal(result.policyVersion, "SME-WC-POL-2026.10");
  assert.equal(result.highValue, false);
  assert.equal(gateFlags(result.policyOutcome, 180_000).makerRequired, "No");
  assert.equal(gateFlags(result.policyOutcome, 180_000).checkerRequired, "No");
});

test("WC-1003 figures escalate on debt-service and exposure and add the high-value gate", () => {
  const result = evaluateCase(facts({
    facility: { yearsTrading: 6, existingExposure: 200_000, facilityAmount: 420_000, tenorMonths: 18, purpose: "Payroll and suppliers on contracted jobs" },
    bureau: { band: "C" },
    internalScore: 700,
    debtServiceCover: 1.05,
  }));
  assert.equal(result.policyOutcome, "Escalate");
  assert.deepEqual(result.reasonCodes, ["POL_DSCR", "POL_EXPOSURE", "GATE_HIGH_VALUE"]);
  assert.equal(result.highValue, true);
  const flags = gateFlags(result.policyOutcome, 420_000);
  assert.equal(flags.makerRequired, "Yes");
  assert.equal(flags.checkerRequired, "Yes");
});

test("WC-1004 figures decline on bureau band and internal score with no checker", () => {
  const result = evaluateCase(facts({
    facility: { yearsTrading: 4, existingExposure: 0, facilityAmount: 90_000, tenorMonths: 12, purpose: "Stock" },
    bureau: { band: "E" },
    internalScore: 540,
    debtServiceCover: 1.4,
  }));
  assert.equal(result.policyOutcome, "Decline");
  assert.deepEqual(result.reasonCodes, ["POL_BUREAU_BAND", "POL_INTERNAL_SCORE"]);
  const flags = gateFlags(result.policyOutcome, 90_000);
  assert.equal(flags.makerRequired, "Yes");
  assert.equal(flags.checkerRequired, "No");
});

test("high value does not turn a passing file into Escalate", () => {
  const result = evaluateCase(facts({ facility: { facilityAmount: 300_000 } }));
  assert.equal(result.policyOutcome, "Approve");
  assert.deepEqual(result.reasonCodes, ["POL_IN_POLICY", "GATE_HIGH_VALUE"]);
  assert.equal(gateFlags("Approve", 300_000).checkerRequired, "Yes");
  assert.equal(gateFlags("Approve", 250_000).checkerRequired, "No");
  assert.equal(gateFlags("Approve", 250_001).checkerRequired, "Yes");
});

test("a decline rule wins over an escalate rule and both codes remain", () => {
  const result = evaluateCase(facts({ internalScore: 500, debtServiceCover: 1.0 }));
  assert.equal(result.policyOutcome, "Decline");
  assert.ok(result.reasonCodes.includes("POL_INTERNAL_SCORE"));
  assert.ok(result.reasonCodes.includes("POL_DSCR"));
});

test("band edges match the demo thresholds", () => {
  const outcomes = [
    [facts({ facility: { yearsTrading: 2 } }), "Approve"],
    [facts({ facility: { yearsTrading: 1 } }), "Decline"],
    [facts({ bureau: { band: "D" } }), "Escalate"],
    [facts({ bureau: { band: "E" } }), "Decline"],
    [facts({ internalScore: 680 }), "Approve"],
    [facts({ internalScore: 679 }), "Escalate"],
    [facts({ internalScore: 620 }), "Escalate"],
    [facts({ internalScore: 619 }), "Decline"],
    [facts({ debtServiceCover: 1.25 }), "Approve"],
    [facts({ debtServiceCover: 1.249 }), "Escalate"],
    [facts({ facility: { existingExposure: 320_000, facilityAmount: 180_000 } }), "Approve"],
    [facts({ facility: { existingExposure: 320_001, facilityAmount: 180_000 } }), "Escalate"],
    [facts({ facility: { tenorMonths: 3 } }), "Approve"],
    [facts({ facility: { tenorMonths: 24 } }), "Approve"],
    [facts({ facility: { tenorMonths: 2 } }), "Escalate"],
    [facts({ facility: { tenorMonths: 25 } }), "Escalate"],
    [facts({ facility: { purpose: "Equipment purchase" } }), "Decline"],
    [facts({ sanctionsFlag: "flag" }), "Decline"],
  ];
  for (const [input, outcome] of outcomes) {
    assert.equal(evaluateCase(input).policyOutcome, outcome, JSON.stringify(input.facility));
  }
});

test("incomplete documents do not read the bureau fixture", () => {
  const input = { completeness: "Gaps" };
  Object.defineProperty(input, "bureau", { get() { throw new Error("bureau was read"); } });
  const result = evaluateCase(input);
  assert.equal(result.blocked, true);
  assert.equal(result.policyOutcome, undefined);
});
