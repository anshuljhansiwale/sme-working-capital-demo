# SME working-capital facility

Synthetic credit-decisioning demo. One webpage, four paths, one policy version (`SME-WC-POL-2026.10`). Policy decides. Grok only drafts an escalation memo.

The repository is public. This demo does not change that.

## Run

```bash
npm install
npm test
npm start
```

Open http://localhost:3000.

Cases and fixtures are MongoDB documents (`cases` and `fixtures` in `sme_working_capital`). With no `MONGODB_URI`, the process starts an ephemeral MongoDB for the session. Set `MONGODB_URI` to use another cluster. No other database is used.

## Grok

The exception service calls `https://api.x.ai/v1/chat/completions` with model id `grok-4.7`. That id is stored on the decision payload and on the audit lines once a build is selected.

If `XAI_API_KEY` is not set, the call is wired and not sent. The service returns a fixture response that matches the contract: the policy outcome and reason codes are copied, and the WC-1003 memo states Escalate, the debt-service shortfall, and the exposure breach. The page says so.

## What a reviewer can click

The path switcher stays on one page. Each path has its own sample data and its own audit lines.

1. **WC-1001 Bramble Forge Components Ltd.** Drop case file, Check documents, Run policy, Finalize decision, Simulate LOS write-back. Ends Written back, Approve, `LOS-DEMO-1001`. No maker, no checker, no model draft.
2. **WC-1002 Saltwharf Provisions Ltd.** Drop case file, Check documents, then Start policy. The chase is open, the SLA is two business days, and policy does not start. The bureau block is labeled unread. The director email does not fill either gap.
3. **WC-1003 Kiln & Yard Field Services Ltd.** Drop case file, Check documents, Run policy. Then either **Select the landed build** or **Use last green build** (optionally **Time box elapsed** first). Insert the late-invoice sentence, Maker confirms, switch to the Checker seat, Checker confirms, Simulate LOS write-back. The outcome stays Escalate. The model draft stays beside the edited memo. Reference `LOS-DEMO-1003`.
4. **WC-1004 Paperhill Packaging Ltd.** Rehearsal only. Drop case file through Run policy, Open the maker gate, Maker confirms, Simulate LOS write-back. Decline from the reason-code template. No checker. The exception service is not called.

**Simulated LOS webhook** is on the empty path, next to Drop case file. It creates the same case shape. The scripts use the file drop.

Reset this path clears that play so it can be received again. Reset does not edit an audit line.

The check-in strip names this repository, the pinned model, and the last green commit. The commit link opens that commit on GitHub. The green bar is the fixture check: outcome unchanged, reason codes unchanged, and the WC-1003 memo states the debt-service shortfall, the exposure breach, and Escalate.
