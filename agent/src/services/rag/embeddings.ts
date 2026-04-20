/**
 * Embeddings Client — talks to Ollama's /api/embeddings endpoint.
 *
 * Uses nomic-embed-text by default (768-dim, fast, open-source).
 * Fully on-prem — same Ollama container as the chat LLM.
 */

import { config } from '../../config';
import { logger } from '../../logger';

const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

export class EmbeddingsClient {
  async embed(text: string): Promise<number[]> {
    // Ollama endpoint (works alongside OpenAI-compat chat endpoint)
    const baseUrl = config.llmUrl.replace(/\/v1$/, '');
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Embeddings failed: ${res.status}`);
    }
    const data = await res.json() as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't support batching natively — fire in parallel
    return Promise.all(texts.map(t => this.embed(t)));
  }

  /** Cosine similarity between two vectors. */
  static cosineSim(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  async health(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.embed('health check');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
    }
  }
}
