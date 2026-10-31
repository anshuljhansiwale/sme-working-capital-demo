import assert from "node:assert/strict";
import test from "node:test";
import { composeResponse } from "../exception-service/respond.js";
import { closeDb, getDb } from "../src/db.js";
import { buildFixtures } from "../src/fixtures.js";
import { CONTEXT_SENTENCE } from "../src/memos.js";
import {
  checkDocuments,
  confirmChecker,
  confirmMaker,
  finalizeStraightThrough,
  intake,
  openMaker,
  resetCase,
  selectBuild,
  startPolicy,
  timeBoxElapsed,
  writeBack,
} from "../src/orchestrator.js";
import { documentPresence } from "../src/required-documents.js";
import { createApp } from "../src/server.js";

const clock = { now: () => new Date("2026-10-31T15:00:00.000Z") };
const build = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  green: true,
  repository: "https://github.com/anshuljhansiwale/sme-working-capital-demo",
};

function inOrder(actual, expected) {
  let index = 0;
  for (const event of actual) {
    if (event === expected[index]) index += 1;
  }
  return index === expected.length;
}

async function seed() {
  const db = await getDb();
  await db.collection("cases").deleteMany({});
  for (const fixture of buildFixtures()) {
    await db.collection("fixtures").replaceOne({ caseId: fixture.caseId }, fixture, { upsert: true });
  }
  return db;
}

async function throughPolicy(db, caseId, source = "file-drop") {
  await intake(db, caseId, source, clock);
  await checkDocuments(db, caseId, clock);
  return startPolicy(db, caseId, clock);
}

test.after(async () => {
  await closeDb();
});

test("WC-1001 is a straight-through Approve with no person and no model", async () => {
  const db = await seed();
  let calls = 0;
  const callService = () => {
    calls += 1;
    throw new Error("the exception service must not be called");
  };
  await intake(db, "WC-1001", "file-drop", clock);
  await checkDocuments(db, "WC-1001", clock);
  const policy = await startPolicy(db, "WC-1001", clock);
  assert.equal(policy.blocked, false);
  assert.equal(policy.case.policyOutcome, "Approve");
  assert.deepEqual(policy.case.reasonCodes, ["POL_IN_POLICY"]);
  assert.equal(policy.case.policyVersion, "SME-WC-POL-2026.10");
  assert.equal(policy.case.bureauSnapshot.band, "B");
  assert.equal(policy.case.internalScore, 760);
  const finalCase = await finalizeStraightThrough(db, "WC-1001", clock);
  assert.equal(finalCase.finalDecision, "Approve");
  assert.equal(finalCase.makerRequired, "No");
  assert.equal(finalCase.checkerRequired, "No");
  assert.equal(finalCase.modelMemo, null);
  assert.match(finalCase.finalMemo, /POL_IN_POLICY/);
  const written = await writeBack(db, "WC-1001", clock);
  assert.equal(written.status, "Written back");
  assert.equal(written.losReference, "LOS-DEMO-1001");
  assert.equal(calls, 0);
  const stored = await db.collection("cases").findOne({ caseId: "WC-1001" });
  assert.equal(stored.workflow, undefined);
  assert.equal(stored.finalDecision, "Approve");
  assert.ok(inOrder(stored.auditLines.map((line) => line.eventType), [
    "CASE_RECEIVED",
    "STATUS_CHANGED",
    "BOT_STARTED",
    "BOT_COMPLETED",
    "DOCUMENTS_CHECKED",
    "STATUS_CHANGED",
    "BOT_STARTED",
    "POLICY_VERSION_RECORDED",
    "BOT_COMPLETED",
    "POLICY_EVALUATED",
    "ADVISORY_NOT_REQUIRED",
    "GATE_NOT_REQUIRED",
    "DECISION_FINAL",
    "LOS_WRITEBACK",
    "STATUS_CHANGED",
  ]));
  assert.equal(stored.auditLines[0].detail.includes("file drop"), true);
  assert.equal(stored.auditLines.at(-1).eventType, "STATUS_CHANGED");
  assert.equal(stored.auditLines.at(-1).statusAfter, "Written back");
  await assert.rejects(() => selectBuild(db, "WC-1001", { mode: "landed", clock, callService, build }), /build is selected only/);
});

test("WC-1002 stops on the chase and does not read the bureau fixture", async () => {
  const db = await seed();
  await intake(db, "WC-1002", "file-drop", clock);
  const checked = await checkDocuments(db, "WC-1002", clock);
  assert.equal(checked.status, "Awaiting documents");
  assert.equal(checked.completeness, "Gaps");
  assert.deepEqual(checked.gapCodes, ["GAP_BANK_STATEMENTS_6M", "GAP_AGED_DEBTORS_CREDITORS"]);
  assert.equal(checked.chaseState, "Open");
  assert.equal(checked.slaDue, "2026-11-03");
  assert.match(checked.chaseText, /Saltwharf Provisions Ltd/);
  assert.match(checked.chaseText, /Bank statements, last six months/);
  assert.match(checked.chaseText, /Aged debtors and creditors/);
  assert.match(checked.chaseText, /2026-11-03/);
  assert.equal(checked.emails[0].fromRole, "director");
  assert.equal(checked.policyOutcome, null);
  assert.equal(checked.bureauSnapshot, null);
  const blocked = await startPolicy(db, "WC-1002", clock);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.case.bureauSnapshot, null);
  assert.equal(blocked.case.internalScore, null);
  assert.equal(blocked.case.status, "Awaiting documents");
  const types = blocked.case.auditLines.map((line) => line.eventType);
  assert.ok(types.includes("GAPS_FOUND"));
  assert.ok(types.includes("CHASE_OPENED"));
  assert.ok(types.includes("SLA_SET"));
  assert.ok(types.includes("GATE_BLOCKED"));
  assert.ok(types.includes("RISK_BLOCKED_INCOMPLETE"));
  assert.equal(types.includes("POLICY_EVALUATED"), false);
  assert.match(blocked.case.auditLines.at(-1).detail, /bureau fixture was not read/);
  const fixture = await db.collection("fixtures").findOne({ caseId: "WC-1002" });
  assert.equal(fixture.bureau.band, "B");
  assert.equal(fixture.internalScore, 740);
  const names = (await db.listCollections().toArray()).map((entry) => entry.name).sort();
  assert.deepEqual(names, ["cases", "fixtures"]);
});

test("WC-1003 keeps Escalate, stores the model draft, and requires both seats", async () => {
  const db = await seed();
  const policy = await throughPolicy(db, "WC-1003");
  assert.equal(policy.case.policyOutcome, "Escalate");
  assert.deepEqual(policy.case.reasonCodes, ["POL_DSCR", "POL_EXPOSURE", "GATE_HIGH_VALUE"]);
  const advised = await selectBuild(db, "WC-1003", {
    mode: "landed",
    clock,
    build,
    callService: (request) => composeResponse(request),
  });
  assert.equal(advised.status, "Pending maker");
  assert.equal(advised.finalDecision, null);
  assert.equal(advised.decisionPayload.policyOutcome, "Escalate");
  assert.deepEqual(advised.decisionPayload.reasonCodes, ["POL_DSCR", "POL_EXPOSURE", "GATE_HIGH_VALUE"]);
  assert.equal(advised.decisionPayload.modelName, "grok-4.7");
  assert.equal(advised.decisionPayload.fallbackUsed, "No");
  assert.equal(advised.decisionPayload.serviceBuildId, build.commit);
  assert.equal(advised.exceptionScore.band, "material");
  assert.match(advised.modelMemo.body, /debt-service shortfall/i);
  assert.match(advised.modelMemo.body, /exposure breach/i);
  assert.match(advised.modelMemo.body, /Escalate/);
  const director = advised.structuredComments.find((comment) => comment.fromRole === "director");
  const manager = advised.structuredComments.find((comment) => comment.fromRole === "relationship manager");
  assert.equal(director.conflictsWith, "");
  assert.equal(manager.conflictsWith, "POL_DSCR");
  assert.equal(advised.modelName, "grok-4.7");
  const modelBody = advised.modelMemo.body;
  const edited = `${advised.modelMemo.headline}\n\n${modelBody}\n\n${CONTEXT_SENTENCE}`;
  const made = await confirmMaker(db, "WC-1003", { seat: "maker", finalMemo: edited, outcome: "Approve" }, clock);
  assert.equal(made.status, "Pending checker");
  assert.equal(made.policyOutcome, "Escalate");
  assert.equal(made.modelMemo.body, modelBody);
  assert.match(made.finalMemo, /not a waiver of the debt-service rule/);
  await assert.rejects(() => writeBack(db, "WC-1003", clock), /checker/);
  const checked = await confirmChecker(db, "WC-1003", { seat: "checker", outcome: "Approve" }, clock);
  assert.equal(checked.finalDecision, "Escalate");
  assert.equal(checked.status, "Decision final");
  const written = await writeBack(db, "WC-1003", clock);
  assert.equal(written.losReference, "LOS-DEMO-1003");
  assert.equal(written.status, "Written back");
  const types = written.auditLines.map((line) => line.eventType);
  assert.ok(inOrder(types, [
    "CHECKIN_LANDED",
    "SERVICE_BUILD_SELECTED",
    "ADVISORY_REQUESTED",
    "ADVISORY_RETURNED",
    "MODEL_DRAFT_STORED",
    "MEMO_EDITED",
    "MAKER_CONFIRMED",
    "CHECKER_CONFIRMED",
    "GATE_PASSED",
    "DECISION_FINAL",
    "LOS_WRITEBACK",
  ]));
  const returned = written.auditLines.find((line) => line.eventType === "ADVISORY_RETURNED");
  assert.equal(returned.modelName, "grok-4.7");
  assert.equal(returned.serviceBuildId, build.commit);
  assert.equal(written.auditLines[0].detail, written.auditLines[0].detail);
});

test("a mismatched payload is rejected and the last green commit is used", async () => {
  const db = await seed();
  await throughPolicy(db, "WC-1003");
  let calls = 0;
  const advised = await selectBuild(db, "WC-1003", {
    mode: "landed",
    clock,
    build,
    callService: (request) => {
      calls += 1;
      if (calls === 1) {
        return {
          decisionPayload: { caseId: request.caseId, policyOutcome: "Approve", reasonCodes: ["POL_IN_POLICY"] },
          memo: { outcomeEchoed: "Approve", memoId: "bad", headline: "Approve", body: "Approve anyway" },
        };
      }
      return composeResponse(request);
    },
  });
  assert.equal(calls, 2);
  assert.equal(advised.policyOutcome, "Escalate");
  assert.equal(advised.decisionPayload.policyOutcome, "Escalate");
  assert.equal(advised.decisionPayload.fallbackUsed, "Yes");
  assert.ok(advised.auditLines.some((line) => line.eventType === "ADVISORY_CONFLICT"));
  assert.ok(advised.auditLines.some((line) => line.eventType === "FALLBACK_BUILD_USED" && line.detail.includes(build.commit)));
});

test("the presenter can expire the time box and use the last green build", async () => {
  const db = await seed();
  await throughPolicy(db, "WC-1003");
  const expired = await timeBoxElapsed(db, "WC-1003", clock, build);
  assert.ok(expired.auditLines.some((line) => line.eventType === "CHECKIN_FAILED" && line.detail.includes(build.commit)));
  await assert.rejects(
    () => selectBuild(db, "WC-1003", { mode: "landed", clock, build, callService: (request) => composeResponse(request) }),
    /time box already expired/,
  );
  const advised = await selectBuild(db, "WC-1003", {
    mode: "last-green",
    clock,
    build,
    callService: (request) => composeResponse(request),
  });
  assert.equal(advised.advisoryState, "fallback");
  assert.equal(advised.decisionPayload.fallbackUsed, "Yes");
  assert.match(advised.auditLines.find((line) => line.eventType === "FALLBACK_BUILD_USED").detail, /Attempted commit none/);
});

test("WC-1004 decline uses the reason-code memo and the maker only", async () => {
  const db = await seed();
  const policy = await throughPolicy(db, "WC-1004");
  assert.equal(policy.case.policyOutcome, "Decline");
  assert.deepEqual(policy.case.reasonCodes, ["POL_BUREAU_BAND", "POL_INTERNAL_SCORE"]);
  assert.equal(policy.case.checkerRequired, "No");
  const opened = await openMaker(db, "WC-1004", clock);
  assert.equal(opened.status, "Pending maker");
  assert.match(opened.templateMemo, /POL_BUREAU_BAND/);
  assert.match(opened.templateMemo, /POL_INTERNAL_SCORE/);
  assert.equal(opened.modelMemo, null);
  assert.equal(opened.advisoryState, "Not required");
  const made = await confirmMaker(db, "WC-1004", { seat: "maker", finalMemo: opened.templateMemo }, clock);
  assert.equal(made.makerAction.edited, false);
  assert.equal(made.finalDecision, "Decline");
  assert.equal(made.checkerAction, null);
  const written = await writeBack(db, "WC-1004", clock);
  assert.equal(written.losReference, "LOS-DEMO-1004");
  assert.equal(written.decisionPayload, null);
  await assert.rejects(() => confirmChecker(db, "WC-1004", { seat: "checker" }, clock), /Pending checker/);
});

test("a high-value Approve keeps the outcome and requires both seats", async () => {
  const db = await seed();
  await db.collection("fixtures").insertOne({
    caseId: "WC-1099",
    legalName: "Northline Assay Ltd",
    yearsTrading: 9,
    existingExposure: 0,
    facilityAmount: 300_000,
    tenorMonths: 12,
    purpose: "Stock and debtors",
    applicationComments: "Stock and debtors for the assay benches.",
    emails: [],
    documents: documentPresence("WC-1099", []),
    bureau: { band: "A", delinquencyCount: 0, delinquencyNote: "None", fixtureReference: "synthetic-bureau://WC-1099" },
    internalScore: 800,
    debtServiceCover: 2,
    sanctionsFlag: "clear",
  });
  const policy = await throughPolicy(db, "WC-1099");
  assert.equal(policy.case.policyOutcome, "Approve");
  assert.deepEqual(policy.case.reasonCodes, ["POL_IN_POLICY", "GATE_HIGH_VALUE"]);
  assert.equal(policy.case.makerRequired, "Yes");
  assert.equal(policy.case.checkerRequired, "Yes");
  const opened = await openMaker(db, "WC-1099", clock);
  assert.match(opened.templateMemo, /GATE_HIGH_VALUE/);
  assert.equal(opened.modelMemo, null);
  const made = await confirmMaker(db, "WC-1099", { seat: "maker", finalMemo: opened.templateMemo }, clock);
  assert.equal(made.status, "Pending checker");
  const checked = await confirmChecker(db, "WC-1099", { seat: "checker" }, clock);
  assert.equal(checked.finalDecision, "Approve");
  const written = await writeBack(db, "WC-1099", clock);
  assert.equal(written.losReference, "LOS-DEMO-1099");
});

test("a simulated webhook creates the same case shape as a file drop", async () => {
  const db = await seed();
  const dropped = await intake(db, "WC-1001", "file-drop", clock);
  await resetCase(db, "WC-1001");
  const hooked = await intake(db, "WC-1001", "simulated-los-webhook", clock);
  assert.equal(hooked.product, dropped.product);
  assert.equal(hooked.legalName, dropped.legalName);
  assert.equal(hooked.facilityAmount, dropped.facilityAmount);
  assert.equal(hooked.syntheticMarker, dropped.syntheticMarker);
  assert.equal(hooked.source, "simulated-los-webhook");
  assert.match(hooked.auditLines[0].detail, /simulated LOS webhook/);
  assert.equal(hooked.bureauSnapshot, null);
});

test("the webpage routes play WC-1001 through write-back", async () => {
  const db = await seed();
  const { app } = await createApp({ checkGitHub: false });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const state = await fetch(`${base}/api/state`).then((response) => response.json());
    assert.deepEqual(state.fixtures.map((fixture) => fixture.caseId), ["WC-1001", "WC-1002", "WC-1003", "WC-1004"]);
    assert.equal(state.fixtures.find((fixture) => fixture.caseId === "WC-1001").bureau, undefined);
    assert.equal(state.fixtures.find((fixture) => fixture.caseId === "WC-1002").bureau.band, "B");
    assert.equal(state.build.modelId, "grok-4.7");
    assert.equal(state.build.green, true);
    const post = (path, body) => fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      return payload;
    });
    await post("/api/cases/WC-1001/intake", { source: "file-drop" });
    await post("/api/cases/WC-1001/check-documents");
    await post("/api/cases/WC-1001/start-policy");
    await post("/api/cases/WC-1001/finalize");
    const written = await post("/api/cases/WC-1001/write-back");
    assert.equal(written.case.status, "Written back");
    assert.equal(written.case.losReference, "LOS-DEMO-1001");
    const page = await fetch(`${base}/`).then((response) => response.text());
    assert.match(page, /SME working-capital facility/);
    const names = (await db.listCollections().toArray()).map((entry) => entry.name).filter((name) => !name.startsWith("system")).sort();
    assert.deepEqual(names, ["cases", "fixtures"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
