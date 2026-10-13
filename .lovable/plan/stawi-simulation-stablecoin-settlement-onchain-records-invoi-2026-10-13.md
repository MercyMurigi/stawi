# Stawi simulation: stablecoin settlement, onchain records, invoice financing

Adds a self-contained, clearly labelled simulation layer on top of the current app. Existing screens, routes and the real payout-split flow stay untouched. Nothing here moves real money or touches a real blockchain.

## What the user gets

- **Simulation mode badge** in the co-op header.
- **Settlements** page: co-op settlement address (truncated + copy + QR), settlement history (tx signature, USDC, KES, rate), and a "Simulate buyer payment" dialog (USDC/USDT, "Solana (simulated)"). Animated stepper: Initiated -> Confirming 0/32 -> Settled onchain -> Converted to KES -> Available in pool, with before/after breakdown (rate default 129.0, 0.5% conversion fee, network fee, KES credited).
- **Financing** page: invoices with status (Draft, Issued, Financed, Paid, Overdue, Repaid), "Get advance" offer card (80% advance, 2.5% fee at 60 days scaled by 30/60/90 tenor, net in USDC and KES, Low/Medium/High risk badge), accept -> funds arrive from "Liquidity pool" with its own tx signature and unlock an early farmer payout. Dashboard: total financed, outstanding, fees earned, avg days to repay, utilisation bar.
- **Waterfall** on settlement: 1) repay advance + fee (financed only), 2) platform/network fees, 3) remainder to farmers by share (largest-remainder, integer KES cents). Stacked bar + table.
- **Payout Records** page: every anchored batch. Each run generates a manifest JSON, SHA-256 manifest hash, Merkle root of farmer allocations (farmer id hashed), simulated tx signature, slot, block time, memo; includes the lender repayment line.
- **Public receipt** page `/receipt/$txHash`: hash, root, signature, slot, "Finalized", Verify button (recomputes in the browser -> green "Record matches" / red "Tampered"), export JSON, printable view.
- **"Verify my payout"** per farmer: allocation, Merkle proof path, validation against the root.
- **Simulation panel** (floating toggle, bottom-right, stacked above Ask Stawi): presets (Happy path, Buyer pays late, Partial payment, FX drops 5%, Financed full cycle, Tamper demo), rate slider, confirmation speed, fast-forward 30 days, reset, and "Run full demo" with a narrated activity log.
- **Money flow** timeline + KPI cards on co-op Overview: USDC settled, KES paid out, farmers paid, avg payout time, total financed, records anchored.
- Seed: co-op "Kiambu Coffee Growers", 24 farmers, 2 buyers, 3 invoices (draft, issued, financed). State persists in the browser; Reset restores the seed.

## Acceptance

Create invoice -> get advance -> simulate USDC payment -> watch conversion -> waterfall repays advance -> all farmers paid -> open verifiable receipt, all in-app. Verify passes untouched, fails after tamper. Reset returns to seed.

## Technical details

- Routes inside the co-op shell: `/coop/settlements`, `/coop/financing`, `/coop/records` (spec's top-level paths would bypass the co-op layout and role gate). Public `/receipt/$txHash` at top level with its own head(). Nav entries added to `src/routes/coop.tsx`.
- `src/lib/chain.ts`: `ChainAdapter` interface (`submitSettlement`, `recordPayout`, `verifyRecord`) with a simulated implementation; base58-style addresses/signatures, slots, block times. Swap-ready for Solana devnet.
- `src/lib/merkle.ts`: SHA-256 via Web Crypto, canonical JSON, Merkle root + proofs.
- `src/lib/sim/store.ts`: zustand-free React context + reducer, persisted to localStorage (read in effect to avoid hydration mismatch); seed in `src/lib/sim/seed.ts`; waterfall/financing math in `src/lib/sim/money.ts` (integer cents, largest-remainder).
- Simulation data is separate from live API data so real invoices and payouts are never altered.
- `/receipt/$txHash` reads from local simulation state (same browser); shows a clear "record not found on this device" state otherwise.
- Components: `SimulationPanel`, `SettlementStepper`, `WaterfallChart`, `HashText` (truncate + copy), `MoneyFlowTimeline`; reuse existing shadcn UI, tokens, toasts.
- AGENTS.md: record the simulation-layer isolation rule.
