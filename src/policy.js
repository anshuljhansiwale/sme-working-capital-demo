import { PRODUCT } from "../exception-service/constants.js";

export const POLICY_VERSION = "SME-WC-POL-2026.10";
export const CURRENCY = "USD";
export const HIGH_VALUE_ABOVE = 250_000;
export const EXPOSURE_CAP = 500_000;
export const DSCR_MINIMUM = 1.25;
export const SCORE_APPROVE = 680;
export const SCORE_DECLINE_BELOW = 620;
export const TENOR_MIN = 3;
export const TENOR_MAX = 24;
export const SLA_BUSINESS_DAYS = 2;
export const TRADING_YEARS_MIN = 2;

export const SYNTHETIC_MARKER =
  "Synthetic demonstration record. This is not a customer. No live bureau and no live loan origination system.";

export { PRODUCT };

const WORKING_CAPITAL = ["stock", "debtor", "payroll", "supplier", "working capital", "working-capital"];
const NON_WORKING_CAPITAL = ["acquisition", "equipment"];

export function formatMoney(amount, currency = CURRENCY) {
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
  return `${formatted} ${currency}`;
}

export function formatCover(value) {
  return Number(value).toFixed(2);
}

function purposeEffect(purpose) {
  const text = String(purpose ?? "").toLowerCase();
  if (NON_WORKING_CAPITAL.some((word) => text.includes(word))) return "decline";
  if (WORKING_CAPITAL.some((word) => text.includes(word))) return "pass";
  return "decline";
}

function bureauEffect(band) {
  const value = String(band ?? "").toUpperCase();
  if (value === "A" || value === "B" || value === "C") return "pass";
  if (value === "D") return "escalate";
  if (value === "E") return "decline";
  return "decline";
}

function scoreEffect(score) {
  if (score >= SCORE_APPROVE) return "pass";
  if (score >= SCORE_DECLINE_BELOW) return "escalate";
  return "decline";
}

function check(rule, actual, limit, effect, reasonCode) {
  return {
    rule,
    actual,
    limit,
    result: effect === "pass" ? "pass" : "fail",
    effect,
    reasonCode: effect === "pass" ? null : reasonCode,
  };
}

/**
 * Deterministic policy SME-WC-POL-2026.10.
 * Reads bureau, score, and debt-service cover only when completeness is Complete.
 * Does not set status, the final decision, or a memo.
 */
export function evaluateCase(input) {
  if (input.completeness !== "Complete") return { blocked: true };
  const { facility, bureau, internalScore, debtServiceCover, sanctionsFlag, pullTime } = input;

  const totalExposure = facility.existingExposure + facility.facilityAmount;
  const checks = [
    check(
      "Years trading",
      String(facility.yearsTrading),
      `${TRADING_YEARS_MIN} or more`,
      facility.yearsTrading >= TRADING_YEARS_MIN ? "pass" : "decline",
      "POL_TRADING_HISTORY",
    ),
    check(
      "Bureau band",
      String(bureau.band).toUpperCase(),
      "A, B, or C; D escalates; E declines",
      bureauEffect(bureau.band),
      "POL_BUREAU_BAND",
    ),
    check(
      "Internal score",
      String(internalScore),
      `${SCORE_APPROVE} or higher; ${SCORE_DECLINE_BELOW} to ${SCORE_APPROVE - 1} escalates; under ${SCORE_DECLINE_BELOW} declines`,
      scoreEffect(internalScore),
      "POL_INTERNAL_SCORE",
    ),
    check(
      "Debt-service cover",
      formatCover(debtServiceCover),
      `${formatCover(DSCR_MINIMUM)} or higher`,
      debtServiceCover >= DSCR_MINIMUM ? "pass" : "escalate",
      "POL_DSCR",
    ),
    check(
      "Existing exposure plus this facility",
      formatMoney(totalExposure),
      `${formatMoney(EXPOSURE_CAP)} or under`,
      totalExposure <= EXPOSURE_CAP ? "pass" : "escalate",
      "POL_EXPOSURE",
    ),
    check(
      "Tenor",
      `${facility.tenorMonths} months`,
      `${TENOR_MIN} to ${TENOR_MAX} months`,
      facility.tenorMonths >= TENOR_MIN && facility.tenorMonths <= TENOR_MAX ? "pass" : "escalate",
      "POL_TENOR",
    ),
    check(
      "Purpose",
      facility.purpose,
      "Working-capital cycle: stock, debtors, payroll, suppliers",
      purposeEffect(facility.purpose),
      "POL_PURPOSE",
    ),
    check(
      "Sanctions or fraud flag",
      sanctionsFlag === "clear" ? "Clear" : "Flag present",
      "Clear",
      sanctionsFlag === "clear" ? "pass" : "decline",
      "POL_SANCTIONS",
    ),
  ];

  let policyOutcome = "Approve";
  if (checks.some((entry) => entry.effect === "decline")) policyOutcome = "Decline";
  else if (checks.some((entry) => entry.effect === "escalate")) policyOutcome = "Escalate";

  const reasonCodes = policyOutcome === "Approve"
    ? ["POL_IN_POLICY"]
    : checks.filter((entry) => entry.result === "fail").map((entry) => entry.reasonCode);

  const highValue = facility.facilityAmount > HIGH_VALUE_ABOVE;
  if (highValue) reasonCodes.push("GATE_HIGH_VALUE");

  return {
    blocked: false,
    policyVersion: POLICY_VERSION,
    bureauSnapshot: {
      band: String(bureau.band).toUpperCase(),
      delinquencyCount: bureau.delinquencyCount,
      delinquencyNote: bureau.delinquencyNote ?? null,
      fixtureReference: bureau.fixtureReference,
      pullTime,
    },
    internalScore,
    debtServiceCover,
    policyChecks: checks,
    policyOutcome,
    reasonCodes,
    highValue,
  };
}

/** Routing flags. They do not change the outcome word. */
export function gateFlags(policyOutcome, facilityAmount) {
  const highValue = facilityAmount > HIGH_VALUE_ABOVE;
  const maker = policyOutcome === "Decline"
    || policyOutcome === "Escalate"
    || (policyOutcome === "Approve" && highValue);
  return {
    highValue,
    makerRequired: maker ? "Yes" : "No",
    checkerRequired: highValue ? "Yes" : "No",
  };
}
