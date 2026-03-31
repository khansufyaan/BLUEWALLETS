declare module 'shamirs-secret-sharing' {
  /**
   * Split a secret Buffer into `shares` shares, requiring `threshold` shares to reconstruct.
   */
  export function split(secret: Buffer, options: { shares: number; threshold: number }): Buffer[];

  /**
   * Combine share Buffers to reconstruct the original secret.
   */
  export function combine(shares: Buffer[]): Buffer;
}
