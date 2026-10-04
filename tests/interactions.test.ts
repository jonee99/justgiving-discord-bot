import { GuildMemberFlags, MessageFlags, type APIInteractionGuildMember, type InteractionDeferReplyOptions, type InteractionEditReplyOptions, type InteractionReplyOptions, type InteractionUpdateOptions, type ModalBuilder } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageDirectory } from '../src/pages.js';
import { ClaimPrompts } from '../src/claim-prompts.js';
import type { AppContext } from '../src/context.js';
import type { Store } from '../src/db.js';
import { CLAIM_MODAL_ID, handleClaim, handleClaimButton, handleClaimChoice, handleClaimModal } from '../src/discord/commands/claim.js';
import { handleWallChoice } from '../src/discord/commands/donate.js';
import { handleForgetChoice } from '../src/discord/commands/donor-forget.js';
import { handleDonorStatus, handleStatusChoice } from '../src/discord/commands/donor-status.js';
import { commandDefinitions } from '../src/discord/definitions.js';
import { USER_A, USER_B, charity, deferred, donation, setup, site } from './helpers.js';

class Interaction {
  readonly events: { kind: string; payload: unknown }[] = [];
  readonly user: { id: string };
  member: APIInteractionGuildMember | null = null;
  customId = CLAIM_MODAL_ID;
  input = '123456789/1';
  modal: ModalBuilder | null = null;
  readonly fields = { getTextInputValue: () => this.input };
  // Stale registered commands must not read/bypass consent with this option.
  readonly options = { getString: () => { throw new Error('Old slash option was consumed'); } };
  constructor(userId = USER_A) { this.user = { id: userId }; }
  async reply(payload: InteractionReplyOptions) { this.events.push({ kind: 'reply', payload }); }
  async deferReply(payload: InteractionDeferReplyOptions) { this.events.push({ kind: 'defer', payload }); }
  async deferUpdate() { this.events.push({ kind: 'deferUpdate', payload: null }); }
  async editReply(payload: InteractionEditReplyOptions) { this.events.push({ kind: 'edit', payload }); }
  async update(payload: InteractionUpdateOptions) { this.events.push({ kind: 'update', payload }); }
  async showModal(modal: ModalBuilder) {
    this.modal = modal;
    this.customId = modal.toJSON().custom_id;
    this.events.push({ kind: 'modal', payload: modal.toJSON() });
  }
  get text() { return JSON.stringify(this.events); }
}

const stores: Store[] = [];
function fixture() {
  const f = setup((t) => ({
    donations: { '100': donation('100', t.a, 'Accepted', 'C1', null, '123456789') },
    pages: { 'page-one': ['100'] },
  }));
  stores.push(f.store);
  const ctx: AppContext = {
    claimPrompts: new ClaimPrompts(),
    config: {
      discordToken: 'fixture', guildId: '100000000000000000', charity, site,
      justGivingAppId: 'fixture', justGivingApiBase: 'https://api.test',
      publicBaseUrl: 'https://donate.test', port: 0, databasePath: ':memory:',
      sendDmOnSuccess: false, inviteUrl: 'https://discord.gg/example', driveEndsAt: null,
    },
    donations: f.deps, pages: new PageDirectory(f.deps.justGiving, charity), profiles: { getMany: async () => new Map(), forget: () => undefined },
  };
  return { ...f, ctx };
}
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});

describe('manual claim consent', () => {
  it('registers /claim with no input option', () => {
    expect(commandDefinitions.find((c) => c.name === 'claim')?.options ?? []).toEqual([]);
  });

  it.each([handleClaim, handleClaimButton])('always asks first, including repeat users and after the deadline', async (entry) => {
    const { ctx, store, discord } = fixture();
    ctx.config.driveEndsAt = new Date(0);
    store.setHiddenFromWall(USER_A, false);
    for (let attempt = 0; attempt < 2; attempt++) {
      const interaction = new Interaction();
      await entry(interaction, ctx);
      expect(interaction.events.map((e) => e.kind)).toEqual(['reply']);
      expect(interaction.text).toContain('donor:claim-show');
      expect(interaction.text).toContain('donor:claim-hide');
      expect(interaction.text).toContain('all your linked donations');
      expect(interaction.events[0]?.payload).toMatchObject({ flags: MessageFlags.Ephemeral });
      expect(interaction.modal).toBeNull();
    }
    expect(discord.calls).toEqual([]);
  });

  it.each([true, false])('saves choice %s, shows modal as first response, then claims', async (hidden) => {
    const { ctx, store, discord } = fixture();
    const interaction = new Interaction();
    await handleClaimChoice(interaction, ctx, hidden);
    expect(interaction.events.map((e) => e.kind)).toEqual(['modal']);
    expect(store.isHiddenFromWall(USER_A)).toBe(hidden);
    expect(interaction.modal?.toJSON().title).toBe('Link your donation');
    await handleClaimModal(interaction, ctx);
    expect(interaction.events.map((e) => e.kind)).toEqual(['modal', 'defer', 'edit']);
    expect(store.getClaim('100')?.discordUserId).toBe(USER_A);
    expect(discord.calls).toHaveLength(1);
    await handleClaimModal(interaction, ctx);
    expect(interaction.text).toContain('expired');
    expect(discord.calls).toHaveLength(1);
  });

  it('keeps the explicit account-wide preference when cancelled or verification fails', async () => {
    const { ctx, store } = fixture();
    const cancelled = new Interaction();
    await handleClaimChoice(cancelled, ctx, true);
    expect(store.isHiddenFromWall(USER_A)).toBe(true);
    const failed = new Interaction();
    failed.input = 'not a receipt';
    await handleClaimChoice(failed, ctx, false);
    await handleClaimModal(failed, ctx);
    expect(store.isHiddenFromWall(USER_A)).toBe(false);
    expect(store.getClaim('100')).toBeNull();
    await handleClaimModal(cancelled, ctx);
    expect(cancelled.text).toContain('expired');
  });

  it('rejects legacy, other-user, expired and forgotten forms without provider/role writes', async () => {
    vi.useFakeTimers();
    const { ctx, store, discord } = fixture();
    const legacy = new Interaction();
    await handleClaimModal(legacy, ctx);
    expect(legacy.text).toContain('expired');

    const owner = new Interaction();
    await handleClaimChoice(owner, ctx, true);
    const other = new Interaction(USER_B);
    other.customId = owner.customId;
    await handleClaimModal(other, ctx);
    expect(other.text).toContain('expired');
    vi.advanceTimersByTime(10 * 60_000);
    await handleClaimModal(owner, ctx);
    expect(owner.text).toContain('expired');

    const forgotten = new Interaction();
    await handleClaimChoice(forgotten, ctx, true);
    await handleForgetChoice(new Interaction(), ctx, true);
    await handleClaimModal(forgotten, ctx);
    expect(forgotten.text).toContain('expired');
    expect(store.getClaimsForUser(USER_A)).toEqual([]);
    expect(discord.calls).toEqual([]);
  });
});

describe('claim from the donation card', () => {
  async function donateChoice(ctx: AppContext, hidden: boolean): Promise<string> {
    const card = new Interaction();
    await handleWallChoice(card, ctx, hidden);
    // Click the actual custom ID emitted by the Discord builder, as the client would.
    const customId = /"custom_id":"(donor:claim[^"]*)"/.exec(card.text)?.[1];
    if (!customId) throw new Error('Donation card has no receipt button');
    return customId;
  }

  it.each([true, false])('reuses choice %s and opens the receipt form without asking twice', async (hidden) => {
    const { ctx, store, discord } = fixture();
    const receipt = new Interaction();
    receipt.customId = await donateChoice(ctx, hidden);
    await handleClaimButton(receipt, ctx);
    expect(receipt.events.map((e) => e.kind)).toEqual(['modal']);
    expect(receipt.modal?.toJSON().title).toBe('Link your donation');
    expect(store.isHiddenFromWall(USER_A)).toBe(hidden);
    await handleClaimModal(receipt, ctx);
    expect(store.getClaim('100')?.discordUserId).toBe(USER_A);
    expect(discord.calls).toHaveLength(1);
  });

  it('does not overwrite a later visibility preference when continuing the card', async () => {
    const { ctx, store } = fixture();
    const receipt = new Interaction();
    receipt.customId = await donateChoice(ctx, false);
    store.setHiddenFromWall(USER_A, true);
    await handleClaimButton(receipt, ctx);
    expect(receipt.events.map((e) => e.kind)).toEqual(['modal']);
    expect(store.isHiddenFromWall(USER_A)).toBe(true);
  });

  it('does not reuse a donation-card choice for another attempt', async () => {
    const { ctx } = fixture();
    const customId = await donateChoice(ctx, true);
    const first = new Interaction();
    first.customId = customId;
    await handleClaimButton(first, ctx);
    expect(first.events.map((e) => e.kind)).toEqual(['modal']);
    const retry = new Interaction();
    retry.customId = customId;
    await handleClaimButton(retry, ctx);
    expect(retry.events.map((e) => e.kind)).toEqual(['reply']);
    expect(retry.text).toContain('donor:claim-show');
  });

  it.each(['expired', 'forgotten', 'other-user', 'replaced'])('asks again for a %s continuation', async (reason) => {
    vi.useFakeTimers();
    const { ctx, store, discord } = fixture();
    const customId = await donateChoice(ctx, true);
    if (reason === 'expired') vi.advanceTimersByTime(10 * 60_000);
    if (reason === 'forgotten') await handleForgetChoice(new Interaction(), ctx, true);
    if (reason === 'replaced') await handleClaimChoice(new Interaction(), ctx, false);
    const receipt = new Interaction(reason === 'other-user' ? USER_B : USER_A);
    receipt.customId = customId;
    await handleClaimButton(receipt, ctx);
    expect(receipt.events.map((e) => e.kind)).toEqual(['reply']);
    expect(receipt.text).toContain('donor:claim-show');
    expect(receipt.modal).toBeNull();
    expect(store.getClaim('100')).toBeNull();
    expect(discord.calls).toEqual([]);
  });
});

describe('forget during manual work', () => {
  it('cannot recreate a personal token after forgetting during /donate metadata lookup', async () => {
    const { ctx, store, tokens } = fixture();
    const started = deferred<void>();
    const ready = deferred<Awaited<ReturnType<PageDirectory['getPage']>>>();
    // A real PageDirectory retains ownership of provider metadata/cache behavior.
    ctx.pages = new PageDirectory({ ...ctx.donations.justGiving, getPage: async () => {
      started.resolve(undefined);
      const page = await ready.promise;
      if (!page) throw new Error('Missing fixture page');
      return page;
    } }, charity);
    const interaction = new Interaction();
    const linking = handleWallChoice(interaction, ctx, true);
    await started.promise;
    await handleForgetChoice(new Interaction(), ctx, true);
    ready.resolve({ pageId: '111', charityId: 'C1', charityName: 'Charity One' });
    await linking;
    expect(store.getTokenOwner(tokens.a)).toBeNull();
    expect(interaction.text).toContain('unlinked');
    expect(interaction.text).not.toContain('link.justgiving.com');
  });

  it('invalidates a receipt lookup in flight and requires a new consent form', async () => {
    const { ctx, store, discord, tokens } = fixture();
    const started = deferred<void>();
    const result = deferred<string | null>();
    ctx.donations.receipts = { find: async () => { started.resolve(undefined); return result.promise; } };
    const interaction = new Interaction();
    await handleClaimChoice(interaction, ctx, true);
    const claiming = handleClaimModal(interaction, ctx);
    await started.promise;
    await handleForgetChoice(new Interaction(), ctx, true);
    result.resolve('100');
    await claiming;
    expect(store.getClaimsForUser(USER_A)).toEqual([]);
    expect(store.getTokenOwner(tokens.a)).toBeNull();
    expect(discord.calls).toEqual([]);
    expect(interaction.text).toContain('cancelled');
    expect(store.hasRedeemedDonation('100')).toBe(false);
    const fresh = new Interaction();
    await handleClaim(fresh, ctx);
    expect(fresh.text).toContain('donor:claim-show');
  });

  it('does not re-create a claim while fresh provider verification is awaiting', async () => {
    const { ctx, store, discord } = fixture();
    await ctx.donations.receipts.find('123456789');
    const started = deferred<void>();
    const result = deferred<ReturnType<typeof donation> | null>();
    ctx.donations.justGiving = { ...ctx.donations.justGiving, getDonation: async () => { started.resolve(undefined); return result.promise; } };
    const interaction = new Interaction();
    await handleClaimChoice(interaction, ctx, false);
    const claiming = handleClaimModal(interaction, ctx);
    await started.promise;
    await handleForgetChoice(new Interaction(), ctx, true);
    result.resolve(donation('100', null, 'Accepted', 'C1', null, '123456789'));
    await claiming;
    expect(store.getClaim('100')).toBeNull();
    expect(store.hasRedeemedDonation('100')).toBe(false);
    expect(discord.calls).toEqual([]);
  });

  it('keeps a consumed ID after forgetting, and suppresses late thank-you work', async () => {
    const { ctx, store, discord } = fixture();
    const started = deferred<void>();
    const result = deferred<'added'>();
    ctx.donations.discord = { ...ctx.donations.discord, addRole: async () => { started.resolve(undefined); return result.promise; } };
    const interaction = new Interaction();
    await handleClaimChoice(interaction, ctx, false);
    const claiming = handleClaimModal(interaction, ctx);
    await started.promise;
    expect(store.hasRedeemedDonation('100')).toBe(true);
    const forgotten = new Interaction();
    await handleForgetChoice(forgotten, ctx, true);
    result.resolve('added');
    await claiming;
    expect(store.getClaim('100')).toBeNull();
    expect(store.hasRedeemedDonation('100')).toBe(true);
    expect(discord.dms).toEqual([]);
    expect(forgotten.text).toContain('used donation IDs');
    expect(forgotten.text).not.toContain('no longer holds anything');
    expect(interaction.text).toContain('cancelled');
  });

  it('does not write a restoration audit after forgetting during a role request', async () => {
    const { ctx, store, tokens } = fixture();
    const audits: string[] = [];
    ctx.donations.store = { ...store, audit: (event, entry) => { audits.push(event); store.audit(event, entry); } };
    store.insertClaim({ donationId: '100', discordUserId: USER_A, token: tokens.a, pageShortName: 'page-one', source: 'claim' });
    const started = deferred<void>();
    const result = deferred<'added'>();
    ctx.donations.discord = { ...ctx.donations.discord, addRole: async () => { started.resolve(undefined); return result.promise; } };
    const interaction = new Interaction();
    const restoring = handleStatusChoice(interaction, ctx, true);
    await started.promise;
    await handleForgetChoice(new Interaction(), ctx, true);
    audits.length = 0;
    result.resolve('added');
    await restoring;
    expect(audits).toEqual([]);
    expect(store.getClaimsForUser(USER_A)).toEqual([]);
    expect(store.isHiddenFromWall(USER_A)).toBe(false);
    expect(interaction.text).toContain('cannot be recalled');
  });
});

describe('role restoration consent', () => {
  it('does not ask on read-only status; asks before restoring and rechecks the claim', async () => {
    const { ctx, store, tokens, discord } = fixture();
    const noClaims = new Interaction();
    await handleDonorStatus(noClaims, ctx);
    expect(noClaims.text).not.toContain('donor:status-show');
    store.insertClaim({ donationId: '100', discordUserId: USER_A, token: tokens.a, pageShortName: 'page-one', source: 'claim' });
    const active = new Interaction();
    active.member = { user: { id: USER_A, username: 'Fixture', discriminator: '0', avatar: null, global_name: null }, roles: [charity.roleId], joined_at: '2026-01-01T00:00:00Z', deaf: false, mute: false, flags: GuildMemberFlags.CompletedOnboarding, permissions: '0' };
    await handleDonorStatus(active, ctx);
    expect(active.text).not.toContain('donor:status-show');
    const missing = new Interaction();
    await handleDonorStatus(missing, ctx);
    expect(missing.text).toContain('donor:status-show');
    expect(discord.calls).toEqual([]);
    await handleStatusChoice(new Interaction(), ctx, true);
    expect(store.isHiddenFromWall(USER_A)).toBe(true);
    expect(discord.calls).toHaveLength(1);
    store.forgetUser(USER_A);
    await handleStatusChoice(new Interaction(), ctx, false);
    expect(discord.calls).toHaveLength(1);
  });
});
