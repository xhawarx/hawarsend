/**
 * Parse a human-readable byte size string (e.g., "2GB", "500MB") into bytes.
 * Supports: B, KB, MB, GB, TB, PB.
 */
export function parseByteSize(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid byte size: "${value}". Use format like "2GB", "500MB", "1TB".`);
  }
  const num = parseFloat(match[1]!);
  const unit = match[2]!.toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
    PB: 1024 ** 5,
  };
  return Math.floor(num * multipliers[unit]!);
}
