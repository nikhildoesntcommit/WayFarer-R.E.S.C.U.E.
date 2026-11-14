import type { Summary } from './summary';

/**
 * Optional on-device language model that re-words the situation summary in plain language. It runs in the browser
 * (WebGPU), downloads about 0.4 GB once on request and is then cached for offline use. It is NOT fine-tuned: it is a small
 * general model held to the facts of this run by its instructions and by a number check, so it can never change a figure.
 */
export const NARRATOR = {
  modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  maxTokens: 220,
  temperature: 0.2,
} as const;

interface Chat {
  chat: { completions: { create: (a: unknown) => Promise<{ choices: { message: { content: string | null } }[] }> } };
}

let engine: Promise<Chat> | null = null;

/** Does this browser have a usable WebGPU adapter (not just the API object)? Never throws. */
export async function narratorSupported(): Promise<boolean> {
  try {
    if (import.meta.env.VITE_DISABLE_LLM === '1') return false;
    if (typeof navigator === 'undefined' || typeof window === 'undefined' || !window.isSecureContext) return false;
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    return !!gpu && (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

/** Numbers in a text, normalised (thousands separators removed), so two phrasings can be compared. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => String(Number(n.replace(/,/g, ''))));
}

/** A rewrite is accepted only if every number in it was in the facts, and it kept most of the facts' numbers. */
export function acceptable(facts: string, rewrite: string): boolean {
  const have = new Set(numbersIn(facts));
  const got = numbersIn(rewrite);
  if (rewrite.trim().length < 40) return false;
  if (got.some((n) => !have.has(n))) return false;
  const kept = [...have].filter((n) => got.includes(n)).length;
  return have.size === 0 || kept >= Math.ceil(have.size * 0.6);
}

export function factsOf(s: Summary): string {
  return [s.headline, ...s.points].join('\n');
}

export async function narrate(s: Summary, onProgress?: (text: string) => void): Promise<string | null> {
  if (!(await narratorSupported())) return null;
  const facts = factsOf(s);
  engine ??= (async () => {
    const webllm = await import('@mlc-ai/web-llm');
    return (await webllm.CreateMLCEngine(NARRATOR.modelId, { initProgressCallback: (p: { text: string }) => onProgress?.(p.text) })) as unknown as Chat;
  })();
  try {
    const e = await engine;
    const r = await e.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'You explain the results of an evacuation simulation to a non-expert. Use ONLY the facts given. Never add, change, round or invent a number or a place. Do not claim the building is safe or certified. Write at most five short sentences in plain English.',
        },
        { role: 'user', content: `Facts:\n${facts}\n\nExplain what this means for the people in the building or region.` },
      ],
      max_tokens: NARRATOR.maxTokens,
      temperature: NARRATOR.temperature,
    });
    const text = r.choices[0]?.message.content?.trim() ?? '';
    return acceptable(facts, text) ? text : null;
  } catch {
    engine = null;
    return null;
  }
}
