import type { InteractionDeferReplyOptions, InteractionEditReplyOptions, InteractionReplyOptions, InteractionUpdateOptions, ModalBuilder } from 'discord.js';

/** Narrow Discord response seam; discord.js owns transport, acknowledgements and IDs. */
export interface ReplyInteraction {
  readonly user: { readonly id: string };
  reply(options: InteractionReplyOptions): Promise<unknown>;
}

/** Replies that may wait for provider I/O after acknowledgement. */
export interface DeferredInteraction extends ReplyInteraction {
  deferReply(options: InteractionDeferReplyOptions): Promise<unknown>;
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
}

/** Button acknowledgement must be the modal itself, not a preceding defer. */
export interface ModalButtonInteraction extends ReplyInteraction {
  showModal(modal: ModalBuilder): Promise<unknown>;
}

/** Receipt buttons may carry a fresh, user-bound consent continuation. */
export interface ClaimButtonInteraction extends ModalButtonInteraction {
  readonly customId: string;
}

/** Only the form fields consumed by the manual claim handler. */
export interface ClaimModalInteraction extends DeferredInteraction {
  readonly customId: string;
  readonly fields: { getTextInputValue(id: string): string };
}

/** A donation-card button acknowledges before fetching provider metadata. */
export interface DonationButtonInteraction extends ReplyInteraction {
  deferUpdate(): Promise<unknown>;
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
}

/** Confirmation buttons replace the originating ephemeral message. */
export interface UpdateInteraction {
  readonly user: { readonly id: string };
  update(options: InteractionUpdateOptions): Promise<unknown>;
}
