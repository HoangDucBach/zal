// Ponder's checkpoint string: 10 digits of block timestamp, 16 of chain id, 16 of block number, then the event
// position. Only the block is needed, for `asOf`.

export interface AsOf {
  readonly block: number;
  /** Unix seconds of that block. */
  readonly updatedAt: number;
}

export function asOfFromCheckpoint(checkpoint: string): AsOf {
  if (!/^\d{75}$/.test(checkpoint)) throw new Error(`Not a Ponder checkpoint: ${checkpoint}`);
  return { updatedAt: Number(checkpoint.slice(0, 10)), block: Number(checkpoint.slice(26, 42)) };
}
