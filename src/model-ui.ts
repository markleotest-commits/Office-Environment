import type { Simulation } from './simulation';
import type { UI } from './ui';
import {
  MODEL_OPTIONS,
  PlanClient,
  ChatGPTPlanProvider,
  LocalModelHost,
  BrowserModelProvider,
} from './model-providers';
import type { PlanStatus } from './model-providers';
export function registerModelProviders(simulation: Simulation) {
  const client = new PlanClient(),
    local = new LocalModelHost();
  simulation.providers.register(new ChatGPTPlanProvider(client));
  simulation.providers.register(
    new BrowserModelProvider('qwen', 'Qwen2.5 0.5B', local),
  );
  simulation.providers.register(
    new BrowserModelProvider('smollm', 'SmolLM2 135M', local),
  );
  return { client, local };
}
export class ModelControls {
  private dialog: HTMLDialogElement;
  private planStatus: PlanStatus | null = null;
  private loading = new Set<string>();
  constructor(
    private sim: Simulation,
    private ui: UI,
    private client: PlanClient,
    private local: LocalModelHost,
  ) {
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'models-dialog';
    this.dialog.className = 'models-dialog';
    this.dialog.innerHTML = `
      <button id="models-close" class="model-close" aria-label="Close AI models">×</button>
      <div class="eyebrow">THE MINDS BEHIND THE FIRM</div><h2>Choose your agents’ models.</h2>
      <p>Connect GPT‑6.1‑sol through your ChatGPT plan, and run free models directly on this device. Office routines can use local rules. In trading mode, failed AI requests hold positions and are labeled.</p>
      <section class="model-card"><h3>GPT‑6.1‑sol</h3><p>Uses your included ChatGPT/Codex allowance. No API key or API billing is used. Keep app credit use off in ChatGPT settings to stay within included usage.</p>
        <div class="model-account"><label>ChatGPT account<select id="plan-account"><option value="new">Add a ChatGPT account</option></select></label><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage ↗</a></div>
        <p id="plan-status" class="model-status">Start the AI server to connect your plan.</p>
        <div class="model-buttons"><button id="plan-sign-in" class="solid-button">Continue with ChatGPT</button><button id="plan-refresh" class="outline-button">Check connection</button><button id="plan-sign-out" class="outline-button" hidden>Sign out</button></div>
      </section>
      <section class="model-card"><h3>Free on-device models</h3><p>Load once from Hugging Face and MLC, then use cached weights offline. Requires WebGPU and enough phone memory; together these models may need over 1 GB of GPU memory. You can assign one small model to both partners to reduce memory use.</p>
        <div class="local-model"><div><strong>Qwen2.5 0.5B</strong><span id="qwen-status" class="model-status">Not loaded</span></div><button id="load-qwen" class="outline-button">Load Qwen</button><button id="unload-qwen" class="text-button" hidden>Unload</button></div>
        <div class="local-model"><div><strong>SmolLM2 135M</strong><span id="smollm-status" class="model-status">Not loaded</span></div><button id="load-smollm" class="outline-button">Load SmolLM</button><button id="unload-smollm" class="text-button" hidden>Unload</button></div>
      </section>
      <section class="model-card"><h3>Assign one mind to each partner</h3><div class="model-roster">${sim.agents.map((a) => `<label>${a.name}<select data-model-agent="${a.id}" aria-label="Model for ${a.name}">${MODEL_OPTIONS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select></label>`).join('')}</div>
        <div class="model-buttons"><button id="assign-models" class="solid-button">Apply model choices</button><button id="suggest-roster" class="outline-button">GPT + Qwen + SmolLM</button></div><p id="model-assignment-status" class="model-status">Load or connect each selected model before applying.</p>
      </section>
      <p class="model-note">Selected models are saved with the world. On-device models must be loaded again after reopening the app; cached downloads are reused. The agent panel shows the source of its last decision and any fallback.</p>
    `;
    document.body.append(this.dialog);
    document.getElementById('models')!.addEventListener('click', () => {
      this.open();
    });
    this.el('models-close').addEventListener('click', () =>
      this.dialog.close(),
    );
    this.el('plan-sign-in').addEventListener('click', () =>
      this.planAction(async () => {
        await client.signIn(this.accountSelect().value);
      }),
    );
    this.el('plan-refresh').addEventListener('click', () => this.refresh());
    this.el('plan-account').addEventListener('change', () =>
      this.planAction(async () => {
        const id = this.accountSelect().value;
        if (id === 'new') return;
        await client.request('select', { accountId: id });
        await this.refresh();
      }),
    );
    this.el('plan-sign-out').addEventListener('click', () =>
      this.planAction(async () => {
        for (const a of sim.agents)
          if (sim.providers.providerFor(a.id).id === 'gpt61')
            sim.setProvider(a.id, 'rules');
        const result = await client.request('sign-out', {});
        ui.toast(result.message);
        await this.refresh();
        ui.render();
      }),
    );
    for (const id of ['qwen', 'smollm'] as const) {
      this.el(`load-${id}`).addEventListener('click', () =>
        this.action(async () => {
          this.loading.add(id);
          this.refreshLocal();
          try {
            await local.load(id);
          } finally {
            this.loading.delete(id);
            this.refreshLocal();
          }
        }),
      );
      this.el(`unload-${id}`).addEventListener('click', () =>
        this.action(async () => {
          for (const a of sim.agents)
            if (sim.providers.providerFor(a.id).id === id)
              sim.setProvider(a.id, 'rules');
          await local.unload(id);
          this.refreshLocal();
          ui.render();
        }),
      );
    }
    this.dialog
      .querySelectorAll('select[data-model-agent]')
      .forEach((s) => s.addEventListener('change', () => this.refreshApply()));
    this.el('suggest-roster').addEventListener('click', () => {
      ['gpt61', 'qwen', 'smollm'].forEach(
        (model, i) => (this.modelSelect(sim.agents[i].id).value = model),
      );
      this.refreshApply();
    });
    this.el('assign-models').addEventListener('click', () => {
      if (!this.choicesReady()) return;
      for (const a of sim.agents)
        sim.setProvider(a.id, this.modelSelect(a.id).value);
      const result = this.onSave();
      ui.toast(result ?? 'Model choices applied');
      ui.render();
      this.refreshApply();
    });
    local.onChange = () => this.refreshLocal();
    this.refreshLocal();
    this.syncChoices();
    if (new URLSearchParams(location.search).get('chatgpt') === 'connected') {
      history.replaceState(null, '', location.pathname);
      this.open();
    }
  }
  onSave: () => string | undefined = () => undefined;
  private el(id: string) {
    return this.dialog.querySelector<HTMLElement>(`#${id}`)!;
  }
  private accountSelect() {
    return this.el('plan-account') as HTMLSelectElement;
  }
  private modelSelect(id: string) {
    return this.dialog.querySelector<HTMLSelectElement>(
      `[data-model-agent="${id}"]`,
    )!;
  }
  private async action(task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      this.ui.toast(
        error instanceof Error ? error.message : 'Model operation failed',
      );
    }
  }
  private async planAction(task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      this.planStatus = null;
      this.client.available = false;
      this.el('plan-status').textContent =
        error instanceof Error ? error.message : 'ChatGPT connection failed';
      this.refreshApply();
    }
  }
  private syncChoices() {
    for (const a of this.sim.agents)
      this.modelSelect(a.id).value = this.sim.providers.providerFor(a.id).id;
    this.refreshApply();
  }
  private choicesReady() {
    return this.sim.agents.every((a) => {
      const id = this.modelSelect(a.id).value;
      return (
        id === 'rules' ||
        (id === 'gpt61' && this.planStatus?.available) ||
        this.local.ready(id)
      );
    });
  }
  private refreshApply() {
    (this.el('assign-models') as HTMLButtonElement).disabled =
      !this.choicesReady();
    this.el('model-assignment-status').textContent = this.choicesReady()
      ? 'Ready to apply. GPT uses your plan allowance; local models have no per-request charge.'
      : 'Connect or load the selected models first. Unavailable models are not silently substituted.';
  }
  private refreshLocal() {
    for (const id of ['qwen', 'smollm']) {
      this.el(`${id}-status`).textContent =
        this.local.messages.get(id) ?? 'Not loaded';
      (this.el(`load-${id}`) as HTMLButtonElement).disabled =
        this.loading.has(id) || this.local.ready(id);
      this.el(`unload-${id}`).hidden = !this.local.ready(id);
    }
    this.refreshApply();
  }
  private async refresh() {
    this.el('plan-status').textContent = 'Checking your local connection…';
    try {
      this.planStatus = await this.client.status();
      this.el('plan-status').textContent = this.planStatus.verified
        ? 'GPT‑6.1‑sol has completed a real decision through your ChatGPT plan.'
        : this.planStatus.message;
      const select = this.accountSelect();
      select.replaceChildren();
      for (const account of this.planStatus.accounts) {
        const option = new Option(account.label, account.id);
        select.add(option);
      }
      select.add(new Option('Add a ChatGPT account', 'new'));
      select.value = this.planStatus.active ?? 'new';
      this.el('plan-sign-out').hidden = !this.planStatus.connected;
      if (this.planStatus.connected) {
        try {
          const key = `fieldwork.plan-welcome.${this.planStatus.active}`;
          if (!localStorage.getItem(key)) {
            this.ui.toast(
              'You’re using your ChatGPT plan. Manage usage in ChatGPT settings; keep app credit use off for included usage only.',
            );
            localStorage.setItem(key, 'seen');
          }
        } catch {
          /* The connection works even when storage is disabled. */
        }
      }
    } catch (error) {
      this.planStatus = null;
      this.el('plan-status').textContent =
        error instanceof Error ? error.message : 'AI server unavailable';
    }
    this.refreshApply();
  }
  private open() {
    if (!this.dialog.open) this.dialog.showModal();
    this.syncChoices();
    void this.refresh();
  }
}
