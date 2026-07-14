/**
 * The cookie jar: a plain in-memory store with the RFC 6265bis §5.7
 * replacement semantics (same name + domain + host-only flag + path
 * replaces, keeping the original creation order) and lazy expiry against
 * an injected clock. No I/O, no globals: a Jar is just a value.
 */
import type { JarLike, StoredCookie, StoreResult } from "./types.js";

export class Jar implements JarLike {
  private cookies: StoredCookie[] = [];

  /** Live (non-expired) cookies, oldest first. */
  list(now: number): StoredCookie[] {
    return this.cookies
      .filter((c) => c.expiryTime === null || c.expiryTime > now)
      .sort((a, b) => a.creationSeq - b.creationSeq);
  }

  /** All cookies including expired ones (for reporting deletions). */
  listAll(): StoredCookie[] {
    return [...this.cookies].sort((a, b) => a.creationSeq - b.creationSeq);
  }

  /**
   * Apply a store decision. Rejections are no-ops; deletions remove the
   * matching cookie; stores replace an identical-coordinates cookie while
   * preserving its position in the Cookie-header ordering.
   */
  apply(result: StoreResult): void {
    if (result.verdict !== "stored" || result.cookie === undefined) return;
    const incoming = result.cookie;
    const existingIndex = this.cookies.findIndex((c) =>
      c.name === incoming.name &&
      c.domain === incoming.domain &&
      c.hostOnly === incoming.hostOnly &&
      c.path === incoming.path &&
      c.partitionKey === incoming.partitionKey);

    if (result.deletion) {
      if (existingIndex >= 0) this.cookies.splice(existingIndex, 1);
      return;
    }
    if (existingIndex >= 0) {
      const existing = this.cookies[existingIndex];
      if (existing !== undefined) {
        // Replacement keeps the old creation order (RFC 6265bis §5.7).
        this.cookies[existingIndex] = { ...incoming, creationSeq: existing.creationSeq };
        return;
      }
    }
    this.cookies.push(incoming);
  }

  /** Number of live cookies. */
  size(now: number): number {
    return this.list(now).length;
  }
}
