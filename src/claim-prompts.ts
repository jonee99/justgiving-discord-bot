import { randomUUID } from 'node:crypto';

/** Single-use, user-bound claim continuations. A new choice replaces the previous one. */
export class ClaimPrompts {
  private readonly pending = new Map<string, { nonce: string; expiresAt: number }>();

  /** Issue a card/form continuation after an explicit Show/Hide choice; valid for ten minutes. */
  open(userId: string): string {
    const now = Date.now();
    for (const [id, prompt] of this.pending) {
      if (prompt.expiresAt <= now) this.pending.delete(id);
    }
    const nonce = randomUUID();
    this.pending.set(userId, { nonce, expiresAt: now + 10 * 60_000 });
    return nonce;
  }

  /** Consume only this user's latest unexpired continuation, never a legacy/stale ID. */
  consume(userId: string, nonce: string): boolean {
    const prompt = this.pending.get(userId);
    if (!prompt || prompt.nonce !== nonce) return false;
    this.pending.delete(userId);
    return prompt.expiresAt > Date.now();
  }

  /** Forget invalidates unsubmitted forms as well as persisted preferences. */
  forget(userId: string): void {
    this.pending.delete(userId);
  }
}
