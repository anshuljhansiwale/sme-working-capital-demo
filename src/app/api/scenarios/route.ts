import { NextResponse } from "next/server";
import {
  calculateWorkingCapital,
  defaultScenario,
  type WorkingCapitalInputs,
} from "@/lib/working-capital";

let savedScenario: WorkingCapitalInputs = { ...defaultScenario };

export async function GET() {
  const snapshot = calculateWorkingCapital(savedScenario);
  return NextResponse.json({ scenario: savedScenario, snapshot });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<WorkingCapitalInputs>;
  savedScenario = {
    cash: Number(body.cash ?? savedScenario.cash),
    accountsReceivable: Number(
      body.accountsReceivable ?? savedScenario.accountsReceivable,
    ),
    inventory: Number(body.inventory ?? savedScenario.inventory),
    accountsPayable: Number(
      body.accountsPayable ?? savedScenario.accountsPayable,
    ),
    shortTermDebt: Number(body.shortTermDebt ?? savedScenario.shortTermDebt),
  };
  const snapshot = calculateWorkingCapital(savedScenario);
  return NextResponse.json({ scenario: savedScenario, snapshot });
}
