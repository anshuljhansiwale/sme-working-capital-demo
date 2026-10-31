export type WorkingCapitalInputs = {
  cash: number;
  accountsReceivable: number;
  inventory: number;
  accountsPayable: number;
  shortTermDebt: number;
};

export type WorkingCapitalSnapshot = WorkingCapitalInputs & {
  currentAssets: number;
  currentLiabilities: number;
  workingCapital: number;
  currentRatio: number;
  quickRatio: number;
};

export function calculateWorkingCapital(
  inputs: WorkingCapitalInputs,
): WorkingCapitalSnapshot {
  const currentAssets =
    inputs.cash + inputs.accountsReceivable + inputs.inventory;
  const currentLiabilities = inputs.accountsPayable + inputs.shortTermDebt;
  const workingCapital = currentAssets - currentLiabilities;
  const currentRatio =
    currentLiabilities === 0 ? Infinity : currentAssets / currentLiabilities;
  const quickAssets = inputs.cash + inputs.accountsReceivable;
  const quickRatio =
    currentLiabilities === 0 ? Infinity : quickAssets / currentLiabilities;

  return {
    ...inputs,
    currentAssets,
    currentLiabilities,
    workingCapital,
    currentRatio,
    quickRatio,
  };
}

export const defaultScenario: WorkingCapitalInputs = {
  cash: 85000,
  accountsReceivable: 120000,
  inventory: 95000,
  accountsPayable: 78000,
  shortTermDebt: 45000,
};

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatRatio(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(2);
}
