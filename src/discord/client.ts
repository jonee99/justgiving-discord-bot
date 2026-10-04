import { Client, Events, MessageFlags, type Interaction } from 'discord.js';
import type { AppContext } from '../context.js';
import { CLAIM_BUTTON_ID, CLAIM_MODAL_ID, CLAIM_SHOW_ID, CLAIM_HIDE_ID, handleClaim, handleClaimButton, handleClaimChoice, handleClaimModal } from './commands/claim.js';
import { WALL_HIDE_ID, WALL_SHOW_ID, handleDonate, handleWallChoice } from './commands/donate.js';
import { FORGET_CANCEL_ID, FORGET_CONFIRM_ID, handleDonorForget, handleForgetChoice } from './commands/donor-forget.js';
import { handleDonorStatus, handleStatusChoice, STATUS_SHOW_ID, STATUS_HIDE_ID } from './commands/donor-status.js';
import { handleDonorWall } from './commands/donor-wall.js';
import { genericErrorEmbed } from './embeds.js';

/**
 * Zero gateway intents: slash commands, button clicks and modal submits arrive
 * regardless, and everything else (roles, DMs, permission checks) goes over REST by ID.
 */
export function createDiscordClient(): Client {
  return new Client({ intents: [] });
}

async function route(interaction: Interaction, ctx: AppContext): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'donate') return handleDonate(interaction, ctx);
    if (interaction.commandName === 'claim') return handleClaim(interaction, ctx);
    if (interaction.commandName === 'donor-status') return handleDonorStatus(interaction, ctx);
    if (interaction.commandName === 'donor-wall') return handleDonorWall(interaction, ctx);
    if (interaction.commandName === 'donor-forget') return handleDonorForget(interaction);
  } else if (interaction.isButton() && (interaction.customId === CLAIM_BUTTON_ID || interaction.customId.startsWith(`${CLAIM_BUTTON_ID}:`))) {
    return handleClaimButton(interaction, ctx);
  } else if (interaction.isButton() && (interaction.customId === CLAIM_SHOW_ID || interaction.customId === CLAIM_HIDE_ID)) {
    return handleClaimChoice(interaction, ctx, interaction.customId === CLAIM_HIDE_ID);
  } else if (interaction.isButton() && (interaction.customId === STATUS_SHOW_ID || interaction.customId === STATUS_HIDE_ID)) {
    return handleStatusChoice(interaction, ctx, interaction.customId === STATUS_HIDE_ID);
  } else if (interaction.isButton() && (interaction.customId === WALL_SHOW_ID || interaction.customId === WALL_HIDE_ID)) {
    return handleWallChoice(interaction, ctx, interaction.customId === WALL_HIDE_ID);
  } else if (interaction.isButton() && (interaction.customId === FORGET_CONFIRM_ID || interaction.customId === FORGET_CANCEL_ID)) {
    return handleForgetChoice(interaction, ctx, interaction.customId === FORGET_CONFIRM_ID);
  } else if (interaction.isModalSubmit() && (interaction.customId === CLAIM_MODAL_ID || interaction.customId.startsWith(`${CLAIM_MODAL_ID}:`))) {
    return handleClaimModal(interaction, ctx);
  }
}

export function registerInteractionHandler(client: Client, getContext: () => AppContext): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isRepliable()) return;

    const ctx = getContext();
    if (interaction.guildId !== ctx.config.guildId) {
      await interaction.reply({ content: 'This bot only works in its home server.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }

    try {
      await route(interaction, ctx);
    } catch (error) {
      console.error('Interaction failed:', error);
      const payload = { embeds: [genericErrorEmbed()] };
      const reply =
        interaction.deferred || interaction.replied
          ? interaction.editReply(payload)
          : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      await reply.catch(() => undefined);
    }
  });
}
