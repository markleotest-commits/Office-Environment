import type { AIProvider } from './ai-provider';
import type { Observation } from './types';
import {
  parseModelAction,
  compactObservation,
  MODEL_INSTRUCTIONS,
  ACTION_SCHEMA,
} from '../shared/model-protocol.mjs';
import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm';
export const MODEL_OPTIONS = [
  { id: 'rules', label: 'Local rules', kind: 'simulated' },
  { id: 'gpt61', label: 'GPT‑6.1‑sol · ChatGPT plan', kind: 'model' },
  { id: 'qwen', label: 'Qwen2.5 0.5B · on device', kind: 'model' },
  { id: 'smollm', label: 'SmolLM2 135M · on device', kind: 'model' },
] as const;
export type PlanStatus = {
  connected: boolean;
  available: boolean;
  verified: boolean;
  model: string;
  message: string;
  active: string | null;
  accounts: { id: string; label: string }[];
};
export class PlanClient {
  private csrf = '';
  available = false;
  private async fetchLocal(url: URL, options: RequestInit) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (error instanceof TypeError)
        throw new Error(
          'Cannot reach the AI server on this phone. In Termux, run cd ~/Office-Environment && npm run start:ai and keep it running, then tap Check connection.',
        );
      throw error;
    }
  }
  private async session() {
    const res = await this.fetchLocal(new URL('./api/session', location.href), {
      cache: 'no-store',
    });
    if (
      !res.ok ||
      !res.headers.get('content-type')?.includes('application/json')
    )
      throw new Error(
        'Start the AI server with npm run start:ai, then reopen this page.',
      );
    this.csrf = (await res.json()).csrf;
    if (typeof this.csrf !== 'string')
      throw new Error('Invalid local server session.');
  }
  async request(path: string, data?: unknown, signal?: AbortSignal) {
    if (!this.csrf) await this.session();
    const res = await this.fetchLocal(
      new URL(`./api/plan/${path}`, location.href),
      {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          'X-Fieldwork-CSRF': this.csrf,
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal,
        cache: 'no-store',
      },
    );
    if (!res.headers.get('content-type')?.includes('application/json'))
      throw new Error(
        'The AI bridge is unavailable. Use npm run start:ai instead of npm run preview, then reopen this page.',
      );
    const result = await res.json();
    if (!res.ok) {
      if (res.status === 401) this.csrf = '';
      throw new Error(result.error ?? 'Model bridge unavailable.');
    }
    return result;
  }
  async status(): Promise<PlanStatus> {
    const status = await this.request('status');
    this.available = status.available;
    return status;
  }
  async signIn(accountId: string) {
    const { url } = await this.request('sign-in', { accountId });
    const target = new URL(url);
    if (target.origin !== 'https://auth.openai.com')
      throw new Error('Invalid sign-in URL.');
    location.assign(url);
  }
}
export class ChatGPTPlanProvider implements AIProvider {
  readonly id = 'gpt61';
  readonly label = 'GPT‑6.1‑sol';
  readonly mode = 'model';
  readonly timeoutMs = 60000;
  constructor(private client: PlanClient) {}
  async decide(o: Observation, signal: AbortSignal) {
    const result = await this.client.request(
      'decide',
      { observation: o },
      signal,
    );
    return result.action;
  }
}
type LocalSlot = {
  worker: Worker;
  engine: WebWorkerMLCEngine;
  modelId: string;
};
export class LocalModelHost {
  private slots = new Map<string, LocalSlot>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly messages = new Map<string, string>();
  onChange: () => void = () => {};
  ready(id: string) {
    return this.slots.has(id);
  }
  private setMessage(id: string, text: string) {
    this.messages.set(id, text);
    this.onChange();
  }
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }
  async load(id: 'qwen' | 'smollm') {
    if (this.ready(id)) return;
    try {
      await this.exclusive(async () => {
        if (this.ready(id)) return;
        if (!navigator.gpu)
          throw new Error(
            'This browser does not provide WebGPU. Try current Android Chrome on a supported phone.',
          );
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter)
          throw new Error('No compatible WebGPU adapter is available.');
        const f16 = adapter.features.has('shader-f16');
        const modelId =
          id === 'qwen'
            ? `Qwen2.5-0.5B-Instruct-q4f${f16 ? '16' : '32'}_1-MLC`
            : `SmolLM2-135M-Instruct-q0f${f16 ? '16' : '32'}-MLC`;
        this.setMessage(id, 'Preparing model download…');
        const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
        const worker = new Worker(
          new URL('./model.worker.ts', import.meta.url),
          { type: 'module' },
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        let workerError: (event: ErrorEvent) => void = () => {};
        const unavailable = new Promise<never>((_, reject) => {
          workerError = () =>
            reject(
              new Error(
                'Model worker could not start. Reload the app and try again.',
              ),
            );
          worker.addEventListener('error', workerError, { once: true });
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'Model download took too long. Check your connection and retry; cached files are reused.',
                ),
              ),
            10 * 60 * 1000,
          );
        });
        try {
          const engine = await Promise.race([
            CreateWebWorkerMLCEngine(
              worker,
              modelId,
              {
                logLevel: 'ERROR',
                initProgressCallback: (p) =>
                  this.setMessage(
                    id,
                    `${Math.round(p.progress * 100)}% · ${p.text}`,
                  ),
              },
              { context_window_size: 2048 },
            ),
            unavailable,
          ]);
          this.slots.set(id, { worker, engine, modelId });
          this.setMessage(id, 'Ready · free on-device model');
        } catch (error) {
          worker.terminate();
          throw error;
        } finally {
          clearTimeout(timer);
          worker.removeEventListener('error', workerError);
        }
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Model could not load. Check WebGPU, memory, storage, and your connection.';
      this.setMessage(id, message);
      throw new Error(message);
    }
  }
  async unload(id: string) {
    await this.exclusive(async () => {
      const slot = this.slots.get(id);
      if (slot) {
        try {
          await slot.engine.unload();
        } finally {
          slot.worker.terminate();
          this.slots.delete(id);
        }
      }
      this.setMessage(id, 'Unloaded · GPU memory released');
    });
  }
  async decide(id: string, o: Observation, signal: AbortSignal) {
    return this.exclusive(async () => {
      if (signal.aborted) throw new Error('Decision cancelled');
      const slot = this.slots.get(id);
      if (!slot)
        throw new Error(
          'Local model is not loaded. Open AI models and load it first.',
        );
      let abort!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => {
          // Terminating the worker releases a stuck device and keeps the queue usable.
          slot.engine.interruptGenerate();
          slot.worker.terminate();
          this.slots.delete(id);
          this.setMessage(
            id,
            'Generation cancelled. Load this model again to resume.',
          );
          reject(new Error('Local model decision cancelled'));
        };
        signal.addEventListener('abort', abort, { once: true });
      });
      try {
        const response = await Promise.race([
          slot.engine.chat.completions.create({
            model: slot.modelId,
            messages: [
              { role: 'system', content: MODEL_INSTRUCTIONS },
              { role: 'user', content: JSON.stringify(compactObservation(o)) },
            ],
            max_tokens: 160,
            temperature: 0.4,
            stream: false,
            response_format: {
              type: 'json_object',
              schema: JSON.stringify(ACTION_SCHEMA),
            },
          }),
          cancelled,
        ]);
        return parseModelAction(response.choices[0]?.message.content ?? '');
      } finally {
        signal.removeEventListener('abort', abort);
      }
    });
  }
}
export class BrowserModelProvider implements AIProvider {
  readonly mode = 'model';
  readonly timeoutMs = 90000;
  constructor(
    readonly id: 'qwen' | 'smollm',
    readonly label: string,
    private host: LocalModelHost,
  ) {}
  decide(o: Observation, signal: AbortSignal) {
    return this.host.decide(this.id, o, signal);
  }
}
