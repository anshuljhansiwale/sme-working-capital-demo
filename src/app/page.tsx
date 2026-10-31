"use client";

import { useMemo, useState } from "react";
import {
  calculateWorkingCapital,
  defaultScenario,
  formatCurrency,
  formatRatio,
  type WorkingCapitalInputs,
} from "@/lib/working-capital";

type FieldKey = keyof WorkingCapitalInputs;

const fields: { key: FieldKey; label: string; hint: string }[] = [
  { key: "cash", label: "Cash & equivalents", hint: "Liquid balances" },
  {
    key: "accountsReceivable",
    label: "Accounts receivable",
    hint: "Outstanding customer invoices",
  },
  { key: "inventory", label: "Inventory", hint: "Stock on hand" },
  {
    key: "accountsPayable",
    label: "Accounts payable",
    hint: "Supplier bills due",
  },
  {
    key: "shortTermDebt",
    label: "Short-term debt",
    hint: "Lines of credit due within 12 months",
  },
];

export default function Home() {
  const [inputs, setInputs] = useState<WorkingCapitalInputs>(defaultScenario);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const snapshot = useMemo(() => calculateWorkingCapital(inputs), [inputs]);

  async function saveScenario() {
    setLoading(true);
    setSavedMessage(null);
    try {
      const response = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs),
      });
      if (!response.ok) {
        throw new Error("Save failed");
      }
      const data = await response.json();
      setSavedMessage(
        `Saved working capital ${formatCurrency(data.snapshot.workingCapital)} to the demo API.`,
      );
    } catch {
      setSavedMessage("Could not save scenario. Check that the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
            SME Working Capital Demo
          </p>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">
            Model liquidity for a small business
          </h1>
          <p className="max-w-2xl text-slate-400">
            Adjust current assets and liabilities, then save a scenario through
            the API to verify the full stack end to end.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="mb-4 text-lg font-medium text-white">Inputs</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map(({ key, label, hint }) => (
                <label key={key} className="flex flex-col gap-2 text-sm">
                  <span className="font-medium text-slate-200">{label}</span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={inputs[key]}
                    onChange={(event) =>
                      setInputs((current) => ({
                        ...current,
                        [key]: Number(event.target.value) || 0,
                      }))
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none ring-emerald-500/40 focus:ring-2"
                  />
                  <span className="text-xs text-slate-500">{hint}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={saveScenario}
              disabled={loading}
              className="mt-6 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving…" : "Save scenario via API"}
            </button>
            {savedMessage ? (
              <p className="mt-3 text-sm text-emerald-300">{savedMessage}</p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
            <h2 className="mb-4 text-lg font-medium text-white">Snapshot</h2>
            <dl className="space-y-4">
              <Metric
                label="Working capital"
                value={formatCurrency(snapshot.workingCapital)}
                accent
              />
              <Metric
                label="Current assets"
                value={formatCurrency(snapshot.currentAssets)}
              />
              <Metric
                label="Current liabilities"
                value={formatCurrency(snapshot.currentLiabilities)}
              />
              <Metric
                label="Current ratio"
                value={formatRatio(snapshot.currentRatio)}
              />
              <Metric
                label="Quick ratio"
                value={formatRatio(snapshot.quickRatio)}
              />
            </dl>
          </section>
        </div>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 pb-3 last:border-none last:pb-0">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd
        className={`text-lg font-semibold ${accent ? "text-emerald-400" : "text-white"}`}
      >
        {value}
      </dd>
    </div>
  );
}
