/**
 * Whisper Client — on-prem speech-to-text.
 *
 * Uses openai-whisper-asr-webservice (free, CPU-friendly, no API keys).
 * Endpoint: POST /asr with multipart field "audio_file"
 * Default model: base.en (~150MB, ~real-time on CPU).
 *
 * Server: https://github.com/ahmetoner/whisper-asr-webservice
 */

import { logger } from '../logger';

export class WhisperClient {
  private url: string;

  constructor() {
    this.url = process.env.WHISPER_URL || 'http://whisper:9000';
  }

  /**
   * Transcribe audio to text.
   * Accepts WAV, MP3, M4A, OGG, WebM.
   */
  async transcribe(audioBuffer: Buffer, filename = 'audio.webm'): Promise<{ text: string; language?: string }> {
    const form = new FormData();
    // This ASR webservice expects the field name "audio_file"
    const mimeType = filename.endsWith('.webm') ? 'audio/webm'
                   : filename.endsWith('.mp3')  ? 'audio/mpeg'
                   : filename.endsWith('.m4a')  ? 'audio/mp4'
                   : filename.endsWith('.ogg')  ? 'audio/ogg'
                   :                              'audio/wav';
    form.append('audio_file', new Blob([audioBuffer], { type: mimeType }), filename);

    // Use query params for options
    const params = new URLSearchParams({
      output: 'json',
      task: 'transcribe',
    });

    const res = await fetch(`${this.url}/asr?${params}`, {
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
      const res = await fetch(`${this.url}/`, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
      // 200, 307 (redirect to swagger docs), or 404 — any of these mean server is up
      const ok = res.status === 200 || res.status === 307 || res.status === 404;
      return { ok, error: ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
    }
  }
}
