import { ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import type { AppContext } from '../../context.js';
import { processClaim } from '../../donations.js';
import { failureEmbed, successEmbed, wallChoiceEmbed } from '../embeds.js';
import type { ClaimButtonInteraction, ClaimModalInteraction, ModalButtonInteraction, ReplyInteraction } from '../interaction-ports.js';

/** Public manual-claim entrypoint, including old donation cards. */
export const CLAIM_BUTTON_ID = 'donor:claim';
/** Legacy form ID remains routed so users receive restart advice. */
export const CLAIM_MODAL_ID = 'donor:claim-modal';
/** Explicit consent button IDs, distinct from /donate's link-producing choices. */
export const CLAIM_SHOW_ID = 'donor:claim-show';
/** Explicit private-wall choice before a claim form. */
export const CLAIM_HIDE_ID = 'donor:claim-hide';
const DONATION_INPUT_ID = 'donation_id';

/** Every /claim (including old command payloads) asks first; no input is consumed here. */
export async function handleClaim(interaction: ReplyInteraction, ctx: AppContext): Promise<void> {
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [wallChoiceEmbed(ctx.config.site, `${ctx.config.publicBaseUrl}/`)
      .setTitle('Before you link: the donor wall').setFooter({ text: 'Pick one to enter your receipt reference.' })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(CLAIM_SHOW_ID).setStyle(ButtonStyle.Primary).setLabel('Show me on the donor wall'),
      new ButtonBuilder().setCustomId(CLAIM_HIDE_ID).setStyle(ButtonStyle.Secondary).setLabel('Hide me from the donor wall'),
    )],
  });
}

/** Continue this donation card's fresh choice once; old/expired cards ask first. */
export async function handleClaimButton(interaction: ClaimButtonInteraction, ctx: AppContext): Promise<void> {
  const prefix = `${CLAIM_BUTTON_ID}:`;
  if (interaction.customId.startsWith(prefix) &&
      ctx.claimPrompts.consume(interaction.user.id, interaction.customId.slice(prefix.length))) {
    await showClaimModal(interaction, ctx);
    return;
  }
  await handleClaim(interaction, ctx);
}

/** Save the account-wide choice immediately, then acknowledge the button with a modal. */
export async function handleClaimChoice(interaction: ModalButtonInteraction, ctx: AppContext, hidden: boolean): Promise<void> {
  const { store } = ctx.donations;
  store.setHiddenFromWall(interaction.user.id, hidden);
  store.audit(hidden ? 'wall_hidden' : 'wall_shown', { discordUserId: interaction.user.id, detail: 'claim' });
  await showClaimModal(interaction, ctx);
}

async function showClaimModal(interaction: ModalButtonInteraction, ctx: AppContext): Promise<void> {
  const nonce = ctx.claimPrompts.open(interaction.user.id);
  const modal = new ModalBuilder()
    .setCustomId(`${CLAIM_MODAL_ID}:${nonce}`)
    .setTitle('Link your donation')
    .addLabelComponents(new LabelBuilder()
      .setLabel('JustGiving receipt reference')
      .setDescription('The reference on your JustGiving receipt email, e.g. 123456789/1.')
      .setTextInputComponent(new TextInputBuilder().setCustomId(DONATION_INPUT_ID)
        .setStyle(TextInputStyle.Short).setPlaceholder('123456789/1').setMinLength(1).setMaxLength(20).setRequired(true)));
  await interaction.showModal(modal);
}

/** Only a fresh, single-use consent form can reach verification. */
export async function handleClaimModal(interaction: ClaimModalInteraction, ctx: AppContext): Promise<void> {
  const prefix = `${CLAIM_MODAL_ID}:`;
  if (!interaction.customId.startsWith(prefix) ||
      !ctx.claimPrompts.consume(interaction.user.id, interaction.customId.slice(prefix.length))) {
    await interaction.reply({ content: 'This claim form has expired. Run /claim and choose Show or Hide again.', flags: MessageFlags.Ephemeral });
    return;
  }
  const operation = ctx.donations.operations.begin(interaction.user.id);
  try {
    // Track the acknowledgement too: forgetting while it is in flight invalidates this attempt.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const outcome = operation.isCurrent()
      ? await processClaim(interaction.fields.getTextInputValue(DONATION_INPUT_ID).trim(), interaction.user.id, ctx.donations, { operation })
      : { ok: false, reason: 'claim_cancelled' } as const;
    await interaction.editReply({
      embeds: [outcome.ok ? successEmbed(ctx.config.charity, outcome.role, outcome.donationId) : failureEmbed(outcome.reason)],
    });
  } finally {
    operation.finish();
  }
}
