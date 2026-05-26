// Shared address-display helper. Used by the wallet button and the activity
// feed so a given address always renders with the same short form. The avatar
// itself is the deterministic <Identicon> (see components/ui/identicon.tsx).

/** "0x1a2b…5f9e" — head 6 + tail 4. */
export function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
