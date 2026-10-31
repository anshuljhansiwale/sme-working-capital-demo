export const REQUIRED_DOCUMENTS = [
  { type: "Business registration", gapCode: "GAP_REGISTRATION" },
  { type: "Financial statements, last two years", gapCode: "GAP_FINANCIALS" },
  { type: "Bank statements, last six months", gapCode: "GAP_BANK_STATEMENTS_6M" },
  { type: "Director identification", gapCode: "GAP_DIRECTOR_ID" },
  { type: "Aged debtors and creditors", gapCode: "GAP_AGED_DEBTORS_CREDITORS" },
  { type: "Stated working-capital purpose", gapCode: "GAP_PURPOSE" },
];

export function documentPresence(caseId, missingGapCodes = []) {
  const missing = new Set(missingGapCodes);
  return REQUIRED_DOCUMENTS.map((doc) => ({
    type: doc.type,
    required: true,
    present: !missing.has(doc.gapCode),
    storeReference: doc.gapCode === "GAP_PURPOSE"
      ? `application-field://${caseId}/purpose`
      : `synthetic-store://${caseId}/${doc.gapCode}`,
    gapCode: doc.gapCode,
  }));
}

/**
 * Copies presence off the fixture list. Emails and comments are not an input.
 * A missing required type is Gaps. This does not write status.
 */
export function copyDocuments(fixture) {
  const byCode = new Map((fixture.documents ?? []).map((doc) => [doc.gapCode, doc]));
  const documents = REQUIRED_DOCUMENTS.map((doc) => {
    const found = byCode.get(doc.gapCode);
    return {
      type: doc.type,
      required: true,
      present: Boolean(found?.present),
      storeReference: found?.storeReference
        ?? (doc.gapCode === "GAP_PURPOSE"
          ? `application-field://${fixture.caseId}/purpose`
          : `synthetic-store://${fixture.caseId}/${doc.gapCode}`),
      gapCode: doc.gapCode,
    };
  });
  const gapCodes = documents.filter((doc) => !doc.present).map((doc) => doc.gapCode);
  return {
    documents,
    completeness: gapCodes.length === 0 ? "Complete" : "Gaps",
    gapCodes,
  };
}
