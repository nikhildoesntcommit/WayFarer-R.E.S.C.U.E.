import { LLM } from '../constants';
import type { Finding } from '../types';

// Optional polish step (spec §10.3). Nothing here may block the app or throw to the caller: on any failure the
// rule-based template text simply stays on the card.

interface Chat {
  chat: { completions: { create: (a: unknown) => Promise<{ choices: { message: { content: string | null } }[] }> } };
}

let enginePromise: Promise<Chat | null> | null = null;
let engine: Chat | null = null;

export function llmSupported(): boolean {
  // build-time kill switch: VITE_DISABLE_LLM=1 npm run build  (the model is a ~2 GB first-use download)
  if ((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_DISABLE_LLM === '1') return false;
  if (typeof navigator === 'undefined' || !navigator.onLine) return false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem !== undefined && mem < LLM.minDeviceMemoryGB) return false;
  return 'gpu' in navigator; // WebLLM needs WebGPU
}

function loadEngine(): Promise<Chat | null> {
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        const webllm = await import('@mlc-ai/web-llm');
        const e = (await webllm.CreateMLCEngine(LLM.modelId)) as unknown as Chat;
        engine = e;
        return e;
      } catch {
        return null;
      }
    })();
  }
  return enginePromise;
}

const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', ''));

/** Accept the rewrite only if it kept every number of the original and stayed short. */
export function acceptable(original: string, rewritten: string): boolean {
  const text = rewritten.trim();
  if (text.length === 0 || text.length > original.length * 2 + 120) return false;
  const have = new Set(numbersIn(text));
  return numbersIn(original).every((n) => have.has(n));
}

export function buildPrompt(f: Finding): string {
  return (
    'You are analyzing the output of an evacuation simulation. Rewrite the following finding in clear, direct language for a school principal. ' +
    'Keep every number and every specific evidence reference. Do not add claims not present in the evidence. Maximum 2 sentences.\n\n' +
    `FINDING: ${f.message}\nEVIDENCE: ${JSON.stringify(f.evidence)}\nRECOMMENDATION: ${f.recommendation}\n\nRewritten finding:`
  );
}

/**
 * Returns polished text, or null (silently) if the model is unavailable, too slow (10 s) or garbled the numbers.
 * The model keeps loading in the background after a timeout, so a later call may succeed.
 */
export async function polishFinding(f: Finding): Promise<string | null> {
  try {
    if (!llmSupported()) return null;
    let e = engine;
    if (!e) {
      e = await Promise.race([loadEngine(), new Promise<null>((r) => setTimeout(() => r(null), LLM.loadTimeoutMs))]);
    }
    if (!e) return null;
    const res = await Promise.race([
      e.chat.completions.create({ messages: [{ role: 'user', content: buildPrompt(f) }], max_tokens: LLM.maxTokens, temperature: LLM.temperature }),
      new Promise<null>((r) => setTimeout(() => r(null), LLM.loadTimeoutMs)),
    ]);
    const text = res?.choices[0]?.message.content ?? '';
    return acceptable(f.message, text) ? text.trim() : null;
  } catch {
    return null;
  }
}
