/**
 * Knowledge Store — indexes audit logs, txs, wallets, docs for semantic search.
 *
 * In-memory store with cosine similarity search. For production:
 * migrate to pgvector with the same interface.
 */

import { EmbeddingsClient } from './embeddings';
import { logger } from '../../logger';

export interface KnowledgeChunk {
  id: string;
  source: 'audit' | 'transaction' | 'wallet' | 'vault' | 'policy' | 'doc';
  sourceId: string;
  timestamp: Date;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export class KnowledgeStore {
  private chunks: KnowledgeChunk[] = [];
  private indexed = new Set<string>(); // Track indexed sourceIds to avoid duplicates
  private embed: EmbeddingsClient;
  private maxSize: number;

  constructor(embed: EmbeddingsClient, maxSize = 50_000) {
    this.embed = embed;
    this.maxSize = maxSize;
  }

  /** Add a chunk and compute its embedding. */
  async add(chunk: Omit<KnowledgeChunk, 'embedding'>): Promise<void> {
    const key = `${chunk.source}:${chunk.sourceId}`;
    if (this.indexed.has(key)) return; // Already indexed
    try {
      const embedding = await this.embed.embed(chunk.content);
      this.chunks.push({ ...chunk, embedding });
      this.indexed.add(key);
      // Cap memory
      if (this.chunks.length > this.maxSize) {
        const removed = this.chunks.shift();
        if (removed) this.indexed.delete(`${removed.source}:${removed.sourceId}`);
      }
    } catch (err) {
      logger.warn('Failed to embed chunk', { error: err instanceof Error ? err.message : err, key });
    }
  }

  /** Bulk add (used by the indexer). */
  async addBatch(chunks: Omit<KnowledgeChunk, 'embedding'>[]): Promise<number> {
    let added = 0;
    for (const c of chunks) {
      await this.add(c);
      added++;
    }
    return added;
  }

  /**
   * Hybrid search: semantic similarity + keyword match.
   * Returns top K chunks.
   */
  async search(query: string, opts: {
    k?: number;
    source?: KnowledgeChunk['source'];
    since?: Date;
  } = {}): Promise<Array<KnowledgeChunk & { score: number }>> {
    const k = opts.k ?? 10;
    const qEmbedding = await this.embed.embed(query).catch(() => null);
    const qLower = query.toLowerCase();

    let candidates = this.chunks;
    if (opts.source) candidates = candidates.filter(c => c.source === opts.source);
    if (opts.since) candidates = candidates.filter(c => c.timestamp >= opts.since!);

    const scored = candidates.map(c => {
      let semanticScore = 0;
      if (qEmbedding && c.embedding) {
        semanticScore = EmbeddingsClient.cosineSim(qEmbedding, c.embedding);
      }
      // Simple keyword boost — if content contains query terms, add 0.1
      const keywordScore = c.content.toLowerCase().includes(qLower) ? 0.15 : 0;
      // Recency boost — more recent events weight higher
      const daysOld = (Date.now() - c.timestamp.getTime()) / 86_400_000;
      const recencyScore = Math.max(0, 0.05 - daysOld * 0.001);
      return { ...c, score: semanticScore + keywordScore + recencyScore };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  stats(): { total: number; bySource: Record<string, number>; oldest?: Date; newest?: Date } {
    const bySource: Record<string, number> = {};
    let oldest: Date | undefined;
    let newest: Date | undefined;
    for (const c of this.chunks) {
      bySource[c.source] = (bySource[c.source] || 0) + 1;
      if (!oldest || c.timestamp < oldest) oldest = c.timestamp;
      if (!newest || c.timestamp > newest) newest = c.timestamp;
    }
    return { total: this.chunks.length, bySource, oldest, newest };
  }
}
