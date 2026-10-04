# justgiving-discord-bot

Instructions for AI coding assistants (and a quick orientation for humans) working on this repository.

## What this is

A Discord bot plus a small website. Members who donate to a charity through JustGiving get a donor role, and appear on a public donor wall. Each community runs its own copy on Fly.io. Donations go straight to the charity via JustGiving; the bot never handles money.

- `/donate` asks whether to appear on the donor wall, then gives the member a personal JustGiving link carrying a short reference token.
- After donating, JustGiving redirects to `/justgiving/return`; the bot verifies the donation with the JustGiving API and adds the donor role.
- `/claim` is the manual fallback: always ask Show/Hide, then open the receipt form. A fresh /donate card's already-donated button reuses that flow's explicit Show/Hide choice once through a user-bound, ten-minute continuation and opens the receipt form directly. Old, expired, reused or forgotten cards ask again, as does the drive-ended button. Each form is user-bound, single-use and expires after ten minutes; old command arguments/modals must not bypass consent. The choice is account-wide and takes effect even if the form is cancelled. `/donor-status` asks before restoring a missing role, but read-only status and automatic processing do not prompt. Donors only see the reference on their JustGiving receipt (`123456789/1`, JustGiving's `donationRef`), which is not the donation ID, so `resolveClaimInput` finds the donation through `ReceiptDirectory` (`src/receipts.ts`), an in-memory index of the donations on the page. Never tell members to enter a "donation ID": they don't have one; `/donor-status` re-applies a missing role; `/donor-wall` hides or shows a donor; `/donor-forget` deletes a member's data.
- A daily re-check revokes donations that were refunded on JustGiving and removes the role.

See [README.md](README.md) for setup and settings. If someone asks you to help them set the bot up, follow [SETUP.md](SETUP.md).

## Stack and hosting

- Node.js 22+, TypeScript, discord.js v14 with zero gateway intents, Express, Astro (pages in `web/`, served through Express in middleware mode), SQLite (better-sqlite3), Vitest.
- One process runs the bot and the web server, on a single always-on Fly.io machine with a volume at `/data`. Never scale beyond one machine (SQLite and one gateway connection).
- Settings: `fly.toml`'s `[env]` block is the one settings file. Locally, `.env` holds the two secrets and overrides the web address and database path (`settingsFromEnvironment` in `src/config.ts`). On Fly the same values arrive as environment variables.

## Commands

```sh
npm install
npm run typecheck            # TypeScript, source and tests
npm test                     # Vitest unit tests (JustGiving and Discord are faked)
npm run check-config         # validate settings and test Discord/JustGiving access without printing secrets
npm run register-commands    # register slash commands with the Discord server
npm run dev                  # build web pages, run bot + web server locally
npm run preview:web          # web pages only, with sample data (no Discord login)
npm run announce -- <channel-id> [message-id]   # post or edit the drive announcement
```

Run `npm run typecheck` and `npm test` before every commit. CI runs both on pushes to `main`; the deploy workflow runs them again before deploying a `vX.Y.Z` tag.

## Rules

- **Nothing community-specific in code.** Names, colours, wording, IDs and addresses come from settings (`Config` / `SiteConfig`). New wording that a community might want to change belongs in a setting with a neutral default.
- **Every setting needs:** validation with a plain-English message in `loadConfig`, an entry in `fly.toml` with a comment, a row in the README's settings table, and a test.
- All donation acceptance rules live in `src/verification.ts` and must stay covered by `tests/verification.test.ts`.
- Tagged donations retain their token-owner and same-charity/page checks. Untagged manual claims require a resolved receipt matching fresh donation details and the exact configured page's paginated listing, plus accepted status, the existing donation-date cutoff and an unused canonical donation ID. Receipt possession is first-claimant redemption, not payer authentication. Never trust typed user IDs or query parameters as ownership/page proof.
- Don't store donor names, emails, amounts or addresses from JustGiving. Amounts for the top donors list are pulled from JustGiving and cached in memory for five minutes (`PageDirectory.getPublicAmounts`), never written to the database.
- `/donor-forget` deletes everything keyed by Discord user ID (`Store.forgetUser`), invalidates active user operations/forms and evicts profiles. Keep only `redeemed_donations(donation_id)` while donations remain redeemable; no user ID, receipt, token, amount or timestamp in that table. Do not call it anonymous or promise all copies are erased. Adding a user-keyed table requires deletion support. Existing role stays, but recovery/refund tracking stops. Already dispatched Discord requests/served copies cannot be recalled.
- Claim tokens are nullable only for receipt-only claims; do not generate fake tokens. Reserve marker and claim in one synchronous SQLite transaction, never across network awaits. Schema version 1 migrates legacy rows, including revoked claims, and canonicalises numeric IDs; collisions abort rather than selecting an owner. Old images/old snapshots can break anti-reuse or restore erased associations: follow [Receipt-redemption upgrades and restores](README.md#receipt-redemption-upgrades-and-restores).
- Keep zero gateway intents: roles and DMs go over REST by user ID.
- Web pages get data and settings only through `Astro.locals.web` (`src/web/api.ts`). Respect `/donor-wall` opt-outs everywhere. Amounts appear only in the top donors list, only when public on JustGiving, and only as each donor's total.
- Never make a donor wait on Discord: record the claim, then give the role (`processDonation` / `syncPendingRoles` in `src/donations.ts`). Roles not yet given are `role_state = 'pending'`.
- No JavaScript is sent to website visitors, and the Content-Security-Policy in `src/web/server.ts` forbids it. Keep pages server-rendered.
- Never run two copies of the bot with the same token.

## Secrets

`DISCORD_TOKEN` and `JUSTGIVING_APP_ID` live only in `.env` (local, git-ignored) and in Fly.io secrets (`fly secrets set`). Never commit them, print them, or paste them into chat or docs.
