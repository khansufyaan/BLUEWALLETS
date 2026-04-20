/**
 * Whisper Client — on-prem speech-to-text.
 *
 * Uses whisper.cpp server (free, CPU-friendly, no API keys).
 * Default model: ggml-base.en.bin (~150MB, ~real-time on CPU).
 *
 * Server: https://github.com/ggerganov/whisper.cpp/tree/master/examples/server
 * Run: ./server -m models/ggml-base.en.bin -l en --port 8081
 */

import { logger } from '../logger';

export class WhisperClient {
  private url: string;

  constructor() {
    this.url = process.env.WHISPER_URL || 'http://whisper:8081';
  }

  /**
   * Transcribe audio to text.
   * Accepts WAV, MP3, M4A, OGG.
   */
  async transcribe(audioBuffer: Buffer, filename = 'audio.wav'): Promise<{ text: string; language?: string }> {
    const form = new FormData();
    form.append('file', new Blob([audioBuffer]), filename);
    form.append('temperature', '0');
    form.append('response_format', 'json');

    const res = await fetch(`${this.url}/inference`, {
      method: 'POST',
      body: form as any,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Whisper error ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json() as { text?: string; language?: string };
    return { text: (data.text || '').trim(), language: data.language };
  }

  async health(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.url}/`, { signal: AbortSignal.timeout(3000) });
      return { ok: res.ok || res.status === 404 }; // 404 is fine, server is up
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
    }
  }
}
