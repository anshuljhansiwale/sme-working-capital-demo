# sme-working-capital-demo

Interactive demo for small-business **working capital** planning: adjust current assets and liabilities, view liquidity ratios, and persist scenarios through a Next.js API route.

## Development

```bash
bash scripts/cloud-agent-install.sh
npm run dev -- --hostname 0.0.0.0 --port 3000
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run start` | Serve production build |

Open [http://localhost:3000](http://localhost:3000), change balance-sheet inputs, and click **Save scenario via API** to exercise the stack end to end.
