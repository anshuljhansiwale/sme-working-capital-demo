import assert from "node:assert/strict";
import test from "node:test";
import { buildFixtures } from "../src/fixtures.js";
import { copyDocuments } from "../src/required-documents.js";
import { addBusinessDays } from "../src/dates.js";

test("the four fixtures carry the document gaps from section 9", () => {
  const fixtures = Object.fromEntries(buildFixtures().map((fixture) => [fixture.caseId, fixture]));
  for (const id of ["WC-1001", "WC-1003", "WC-1004"]) {
    const result = copyDocuments(fixtures[id]);
    assert.equal(result.completeness, "Complete");
    assert.deepEqual(result.gapCodes, []);
    assert.equal(result.documents.length, 6);
  }
  const gaps = copyDocuments(fixtures["WC-1002"]);
  assert.equal(gaps.completeness, "Gaps");
  assert.deepEqual(gaps.gapCodes, ["GAP_BANK_STATEMENTS_6M", "GAP_AGED_DEBTORS_CREDITORS"]);
});

test("an email that promises bank statements does not clear a gap", () => {
  const fixture = buildFixtures().find((entry) => entry.caseId === "WC-1002");
  fixture.emails.push({
    fromRole: "director",
    subject: "Attached",
    body: "Bank statements are attached and the aged listing is enclosed.",
  });
  const result = copyDocuments(fixture);
  assert.deepEqual(result.gapCodes, ["GAP_BANK_STATEMENTS_6M", "GAP_AGED_DEBTORS_CREDITORS"]);
  assert.equal(result.documents.find((doc) => doc.gapCode === "GAP_BANK_STATEMENTS_6M").present, false);
});

test("the stated purpose is an application field, not a separate file", () => {
  const fixture = buildFixtures().find((entry) => entry.caseId === "WC-1001");
  const purpose = fixture.documents.find((doc) => doc.gapCode === "GAP_PURPOSE");
  assert.equal(purpose.present, true);
  assert.match(purpose.storeReference, /^application-field:/);
});

test("two business days skip the weekend", () => {
  assert.equal(addBusinessDays("2026-10-31T12:00:00.000Z", 2), "2026-11-03");
  assert.equal(addBusinessDays("2026-10-30T12:00:00.000Z", 2), "2026-11-03");
  assert.equal(addBusinessDays("2026-10-29T12:00:00.000Z", 2), "2026-11-02");
});
