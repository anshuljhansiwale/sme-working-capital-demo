import { SYNTHETIC_MARKER } from "./policy.js";
import { documentPresence } from "./required-documents.js";

const GAPS_1002 = ["GAP_BANK_STATEMENTS_6M", "GAP_AGED_DEBTORS_CREDITORS"];

function applicant(fields) {
  const { missing = [], ...rest } = fields;
  return {
    syntheticMarker: SYNTHETIC_MARKER,
    currency: "USD",
    sanctionsFlag: "clear",
    rehearsalOnly: false,
    emails: [],
    ...rest,
    documents: documentPresence(rest.caseId, missing),
  };
}

export function buildFixtures() {
  return [
    applicant({
      caseId: "WC-1001",
      legalName: "Bramble Forge Components Ltd",
      yearsTrading: 8,
      existingExposure: 0,
      facilityAmount: 180_000,
      tenorMonths: 12,
      purpose: "Stock and debtors",
      applicationComments: "Stock and debtors for the next production cycle.",
      internalScore: 760,
      debtServiceCover: 1.6,
      bureau: {
        band: "B",
        delinquencyCount: 0,
        delinquencyNote: "No delinquencies in twelve months",
        fixtureReference: "synthetic-bureau://WC-1001",
      },
    }),
    applicant({
      caseId: "WC-1002",
      legalName: "Saltwharf Provisions Ltd",
      yearsTrading: 5,
      existingExposure: 0,
      facilityAmount: 150_000,
      tenorMonths: 12,
      purpose: "Stock",
      applicationComments: "Stock for the wholesale book.",
      emails: [
        {
          fromRole: "director",
          subject: "Bank statements will follow",
          body: "Bank statements will follow next week. Please hold the file until then.",
          time: "2026-10-28T09:00:00.000Z",
        },
      ],
      missing: GAPS_1002,
      internalScore: 740,
      debtServiceCover: 1.4,
      bureau: {
        band: "B",
        delinquencyCount: 0,
        delinquencyNote: "No delinquencies in twelve months",
        fixtureReference: "synthetic-bureau://WC-1002",
      },
    }),
    applicant({
      caseId: "WC-1003",
      legalName: "Kiln & Yard Field Services Ltd",
      yearsTrading: 6,
      existingExposure: 200_000,
      facilityAmount: 420_000,
      tenorMonths: 18,
      purpose: "Payroll and suppliers on contracted jobs",
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
      internalScore: 700,
      debtServiceCover: 1.05,
      bureau: {
        band: "C",
        delinquencyCount: 0,
        delinquencyNote: "No delinquencies",
        fixtureReference: "synthetic-bureau://WC-1003",
      },
    }),
    applicant({
      caseId: "WC-1004",
      legalName: "Paperhill Packaging Ltd",
      yearsTrading: 4,
      existingExposure: 0,
      facilityAmount: 90_000,
      tenorMonths: 12,
      purpose: "Stock",
      applicationComments: "Stock for the next packing run.",
      internalScore: 540,
      debtServiceCover: 1.4,
      rehearsalOnly: true,
      bureau: {
        band: "E",
        delinquencyCount: 0,
        delinquencyNote: "Synthetic band E",
        fixtureReference: "synthetic-bureau://WC-1004",
      },
    }),
  ];
}

export const LIVE_CASE_IDS = ["WC-1001", "WC-1002", "WC-1003", "WC-1004"];
