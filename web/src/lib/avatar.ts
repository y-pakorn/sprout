// Shared address-display helpers. Used by the wallet button and the activity
// feed so a given address always renders with the same short form + avatar.

/** "0x1a2b…5f9e" — head 6 + tail 4. */
export function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Stable initial for the avatar — SuiNS first letter, else an address byte. */
export function avatarLetter(name: string | null | undefined, addr: string): string {
  if (name && name.length > 0) return name[0].toUpperCase();
  // 3rd char of the address (skip "0x") varies more than the leading chars.
  return (addr[2] ?? "?").toUpperCase();
}

/** Stable neutral/pillar tone for the avatar background (Amplemarket palette). */
const AVATAR_TONES = [
  "#272625", // surface charcoal
  "#10054d", // deep indigo
  "#2e2460", // midnight violet
  "#328efa", // intelligence blue
  "#e16540", // lead-gen red
];

export function avatarTone(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}
