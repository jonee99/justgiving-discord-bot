import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
} from 'discord.js';
import type { UserOperation } from '../../user-operations.js';
import type { AppContext } from '../../context.js';
import { buildDonateLink, buildExitUrl } from '../../justgiving.js';
import { donateEmbed, driveEndedEmbed, failureEmbed, notOpenEmbed, wallChoiceEmbed } from '../embeds.js';
import type { DonationButtonInteraction } from '../interaction-ports.js';
import { CLAIM_BUTTON_ID } from './claim.js';

/** The two answers to "appear on the donor wall?", asked on every /donate before the link is shown. */
export const WALL_SHOW_ID = 'donor:wall-show';
export const WALL_HIDE_ID = 'donor:wall-hide';

export function wallChoiceButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(WALL_SHOW_ID).setStyle(ButtonStyle.Primary).setLabel('Show me on the donor wall'),
    new ButtonBuilder().setCustomId(WALL_HIDE_ID).setStyle(ButtonStyle.Secondary).setLabel('Hide me from the donor wall'),
  );
}

function claimButton(customId: string): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setStyle(ButtonStyle.Secondary).setLabel("I've already donated");
}

/** Step 1: /donate asks the donor wall question (unless donations are closed). */
export async function handleDonate(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { charity, site, publicBaseUrl, driveEndsAt } = ctx.config;

  if (driveEndsAt && Date.now() >= driveEndsAt.getTime()) {
    await interaction.editReply({
      embeds: [driveEndedEmbed(site)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(claimButton(CLAIM_BUTTON_ID))],
    });
    return;
  }

  if (!charity.pageShortName) {
    await interaction.editReply({ embeds: [notOpenEmbed()] });
    return;
  }

  await interaction.editReply({ embeds: [wallChoiceEmbed(site, `${publicBaseUrl}/`)], components: [wallChoiceButtons()] });
}

/** Step 2: the donor answered, so save the choice and swap the question for the donate card. */
export async function handleWallChoice(interaction: DonationButtonInteraction, ctx: AppContext, hidden: boolean): Promise<void> {
  const operation = ctx.donations.operations.begin(interaction.user.id);
  try {
    await interaction.deferUpdate();
    if (!operation.isCurrent()) {
      await interaction.editReply({ content: 'Your data was unlinked. Run /donate again.', embeds: [], components: [] });
      return;
    }
    const { store } = ctx.donations;
    store.setHiddenFromWall(interaction.user.id, hidden);
    store.audit(hidden ? 'wall_hidden' : 'wall_shown', { discordUserId: interaction.user.id, detail: 'donate' });
    await interaction.editReply(await donateCard(interaction.user.id, hidden, ctx, operation));
  } finally {
    operation.finish();
  }
}

async function donateCard(discordUserId: string, hidden: boolean, ctx: AppContext, operation: UserOperation): Promise<InteractionEditReplyOptions> {
  const { charity, site, publicBaseUrl, driveEndsAt } = ctx.config;
  const page = await ctx.pages.getPage();
  if (!operation.isCurrent()) return { content: 'Your data was unlinked. Run /donate again.', embeds: [], components: [] };
  if (!page) {
    return {
      embeds: [failureEmbed('api_error').setDescription("JustGiving isn't responding right now. Try /donate again in a few minutes.")],
      components: [],
    };
  }

  const token = ctx.donations.store.getOrCreateToken(discordUserId);
  const donate = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setEmoji('💖')
    .setLabel(`Donate to ${charity.name}`)
    .setURL(buildDonateLink(page.pageId, token, buildExitUrl(publicBaseUrl, token)));

  return {
    embeds: [donateEmbed({ charity, site, endsAt: driveEndsAt, wallUrl: `${publicBaseUrl}/`, hiddenFromWall: hidden })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(donate,
      claimButton(`${CLAIM_BUTTON_ID}:${ctx.claimPrompts.open(discordUserId)}`))],
  };
}
