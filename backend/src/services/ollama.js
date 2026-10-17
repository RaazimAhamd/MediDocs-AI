import { AppError } from '../errors.js';
import { normalizeModelName } from '../utils/text.js';
import { isFiniteVector } from '../utils/vector.js';

/** True if `name` (e.g. "gemma3" or "gemma3:latest") is installed in Ollama. */
export function isInstalled(models, name) {
  const wanted = String(name).toLowerCase();
  return models.some((m) => {
    const installed = m.name.toLowerCase();
    if (installed === wanted) return true;
    if (!wanted.includes(':')) return installed.split(':')[0] === wanted;
    return normalizeModelName(installed) === normalizeModelName(wanted);
  });
}

/** True if the model is on the allow-list (by base name or full name) or is the configured default. */
export function isAllowedChatModel(name, allowedNames, defaultModel) {
  const n = String(name).toLowerCase();
  const base = n.split(':')[0];
  const allowed = allowedNames.map((a) => a.toLowerCase());
  if (defaultModel && normalizeModelName(defaultModel) === normalizeModelName(n)) return true;
  return allowed.includes(n) || allowed.includes(base);
}

/** Installed chat models the UI may offer (embedding models are never offered). */
export function selectableChatModels(models, allowedNames, defaultModel) {
  return models.filter((m) => isAllowedChatModel(m.name, allowedNames, defaultModel));
}

const CONNECTION_TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

export class OllamaClient {
  constructor({ baseUrl, embedTimeoutMs = 120000, chatTimeoutMs = 240000, fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl;
    this.embedTimeoutMs = embedTimeoutMs;
    this.chatTimeoutMs = chatTimeoutMs;
    this.fetch = fetchImpl;
  }

  async #request(path, { method = 'GET', body, timeoutMs, signal } = {}) {
    const signals = [AbortSignal.timeout(timeoutMs ?? this.embedTimeoutMs)];
    if (signal) signals.push(signal);

    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      if (signal?.aborted) throw AppError.clientClosed();
      if (
        err?.name === 'TimeoutError' ||
        err?.name === 'AbortError' ||
        CONNECTION_TIMEOUT_CODES.has(err?.cause?.code)
      ) {
        throw AppError.gatewayTimeout(
          'The local AI model took too long to respond. Try a smaller model, a shorter question, or wait for the model to finish loading.',
        );
      }
      throw AppError.serviceUnavailable(
        'Cannot reach Ollama. Make sure it is installed and running (try "ollama list" in a terminal).',
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const data = await response.json();
        detail = typeof data?.error === 'string' ? data.error : '';
      } catch {
        /* non-JSON error body */
      }
      if (response.status === 404 && /model/i.test(detail)) {
        throw AppError.badGateway(
          `Model not available in Ollama: ${detail}. Install it with "ollama pull <model>" and try again.`,
          'MODEL_NOT_FOUND',
        );
      }
      if (response.status === 404) {
        throw AppError.badGateway('This Ollama endpoint is not supported by your Ollama version.', 'OLLAMA_ENDPOINT_NOT_FOUND');
      }
      throw AppError.badGateway(`Ollama returned an error (HTTP ${response.status}).${detail ? ` ${detail}` : ''}`);
    }

    try {
      return await response.json();
    } catch {
      throw AppError.badGateway('Ollama returned an unreadable response.');
    }
  }

  async version() {
    const data = await this.#request('/api/version', { timeoutMs: 5000 });
    return data.version ?? 'unknown';
  }

  async listModels() {
    const data = await this.#request('/api/tags', { timeoutMs: 5000 });
    return (data.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size ?? 0,
      modifiedAt: m.modified_at ?? null,
    }));
  }

  /**
   * Embed texts. Uses the current POST /api/embed endpoint ({model, input: []} -> {embeddings}).
   * Falls back to the legacy POST /api/embeddings ({model, prompt} -> {embedding}) for Ollama < 0.3.
   */
  async embed(model, inputs, { signal } = {}) {
    if (!Array.isArray(inputs) || inputs.length === 0) return [];
    let vectors;
    try {
      const data = await this.#request('/api/embed', {
        method: 'POST',
        body: { model, input: inputs },
        timeoutMs: this.embedTimeoutMs,
        signal,
      });
      vectors = data.embeddings;
    } catch (err) {
      if (err.code !== 'OLLAMA_ENDPOINT_NOT_FOUND') throw err;
      vectors = [];
      for (const prompt of inputs) {
        const data = await this.#request('/api/embeddings', {
          method: 'POST',
          body: { model, prompt },
          timeoutMs: this.embedTimeoutMs,
          signal,
        });
        vectors.push(data.embedding);
      }
    }
    if (!Array.isArray(vectors) || vectors.length !== inputs.length || !vectors.every(isFiniteVector)) {
      throw AppError.badGateway('Ollama returned an unexpected embedding response.');
    }
    return vectors;
  }

  /** Non-streaming chat. Returns the assistant message text. */
  async chat(model, messages, { temperature = 0.1, numCtx = 4096, signal, timeoutMs } = {}) {
    const data = await this.#request('/api/chat', {
      method: 'POST',
      timeoutMs: timeoutMs ?? this.chatTimeoutMs,
      signal,
      body: {
        model,
        messages,
        stream: false,
        keep_alive: '5m',
        options: { temperature, num_ctx: numCtx },
      },
    });
    const content = data?.message?.content;
    if (typeof content !== 'string') {
      throw AppError.badGateway('Ollama returned an unexpected chat response.');
    }
    return content.trim();
  }
}
