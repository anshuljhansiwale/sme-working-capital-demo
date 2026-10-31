import assert from "node:assert/strict";
import test from "node:test";
import { workflowFor } from "../src/workflow.js";

function byId(steps) {
  return Object.fromEntries(steps.map((step) => [step.id, step]));
}

test("straight-through marks advisory, maker, and checker skipped", () => {
  const steps = byId(workflowFor({
    status: "Written back",
    completeness: "Complete",
    policyOutcome: "Approve",
    advisoryState: "Not required",
    makerRequired: "No",
    checkerRequired: "No",
    finalDecision: "Approve",
  }));
  assert.equal(steps.policy.state, "done");
  assert.equal(steps.policy.result, "Approve");
  assert.equal(steps.advisory.state, "skipped");
  assert.equal(steps.maker.state, "skipped");
  assert.equal(steps.checker.state, "skipped");
  assert.equal(steps.written.state, "done");
  assert.equal(steps.written.result, "Written back");
});

test("missing documents block policy instead of skipping it", () => {
  const steps = byId(workflowFor({
    status: "Awaiting documents",
    completeness: "Gaps",
    policyOutcome: null,
    makerRequired: null,
    checkerRequired: null,
  }));
  assert.equal(steps.documents.state, "current");
  assert.equal(steps.documents.result, "Gaps");
  assert.equal(steps.policy.state, "blocked");
  assert.equal(steps.policy.result, "Blocked");
  assert.equal(steps.advisory.state, "skipped");
  assert.equal(steps.written.state, "skipped");
});

test("an escalation waiting on the maker names that seat", () => {
  const steps = byId(workflowFor({
    status: "Pending maker",
    completeness: "Complete",
    policyOutcome: "Escalate",
    advisoryState: "returned",
    decisionPayload: { caseId: "WC-1003" },
    makerRequired: "Yes",
    checkerRequired: "Yes",
  }));
  assert.equal(steps.policy.result, "Escalate");
  assert.equal(steps.advisory.state, "done");
  assert.equal(steps.maker.state, "current");
  assert.equal(steps.maker.holder, "Maker seat");
  assert.equal(steps.checker.state, "waiting");
});
