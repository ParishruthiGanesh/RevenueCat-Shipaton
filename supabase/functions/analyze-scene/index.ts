import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AnalyzeRequest, clampAnalysis, SceneAnalysis, type AnalyzeRequestT } from '../_shared/scene-schema.ts';
import { checkAiAllowance, FREE_AI_SCANS_PER_MONTH, corsHeaders, errorResponse, json, recordAiUsage, requireUser } from '../_shared/http.ts';

/**
 * analyze-scene — the perception stage of the pipeline.
 *
 * Frames → Claude vision with a strict structured-output schema → validated SceneAnalysis.
 * Images are processed in memory and never stored server-side by this function.
 * The model proposes; the app shows everything for user confirmation before saving.
 */

const MODEL = Deno.env.get('PM_VISION_MODEL') ?? 'claude-opus-5';
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the function's secrets

const SYSTEM = `You are the perception stage of Physical Memory, an app that helps people remember where they put their belongings.

You receive 1–8 photos of a real place (a drawer, shelf, box, desk, bag, room…) and sometimes what the user said while taking them. Describe what is physically visible as structured data.

Rules:
- Report only what you can actually see. Never invent objects, brands, rooms or text that are not visible.
- Prefer specific everyday names a person would search for ("USB-C to HDMI adapter", "blue document pouch", "AirPods case"), not vague ones ("device", "item").
- Brand only when a logo or name is clearly legible. Otherwise null.
- The same physical object seen in several frames is ONE object. Choose the frame where it is clearest.
- Model containment explicitly. Places are the room, furniture (fixture) and compartments (container: drawer, shelf level, box, cabinet section). Objects sit INSIDE / ON_TOP_OF / UNDER / NEXT_TO / ATTACHED_TO a place or another object (e.g. passport INSIDE blue pouch INSIDE top drawer PART OF black dresser IN bedroom).
- Only include a room or furniture place if it is visible or clearly implied by the frames or the user's words. When the user names a place that matches one of their known places, reuse that exact name.
- Mark "primary" true for the object(s) the user is deliberately showing or talking about.
- Sensitive items (passports, IDs, bank cards, medication, legal/medical/financial papers): set sensitive=true and NEVER transcribe any text, numbers or names printed on them.
- If a person is visible, set peoplePresent=true. Do not describe people, and never list them as objects.
- Bounding boxes are normalised to the chosen frame (0..1). Give your best tight box; null if the object is not clearly localisable.
- Confidence is your honest probability the label is right. Use low values when unsure — the user will confirm.`;

function userPrompt(r: AnalyzeRequestT): string {
  const lines = [`Capture mode: ${r.mode === 'remember' ? 'REMEMBER — the user is showing where they are putting something' : r.mode === 'box' ? 'STORAGE BOX — list everything visible in the box being packed' : `AREA SCAN — list every distinct object visible${r.scanTarget ? ` in this ${r.scanTarget}` : ''}`}.`];
  if (r.utterance) lines.push(`The user said: "${r.utterance.replace(/"/g, "'")}"`);
  if (r.knownPlaces?.length) lines.push(`The user's known places: ${r.knownPlaces.join('; ')}.`);
  if (r.sensitiveMode) lines.push('Sensitive mode is ON: do not transcribe any visible text at all.');
  lines.push(`There are ${r.frames.length} frame(s), indexed from 0 in the order given.`);
  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'POST only.');

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let body: AnalyzeRequestT;
  try {
    const parsed = AnalyzeRequest.safeParse(await req.json());
    if (!parsed.success) return errorResponse(400, 'invalid_request', parsed.error.issues.map((i) => i.message).join('; '));
    body = parsed.data;
  } catch {
    return errorResponse(400, 'invalid_json', 'Body must be JSON.');
  }

  const allowance = await checkAiAllowance(auth.user.id);
  if (!allowance.allowed) return errorResponse(402, 'ai_limit_reached', 'You have used this month’s free AI scans.');

  const started = Date.now();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: zodOutputFormat(SceneAnalysis) },
      // Server-side refusal fallback: a declined request is re-run on Anthropic's recommended model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...body.frames.flatMap((f, i) => [
              { type: 'text' as const, text: `Frame ${i}:` },
              { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mediaType, data: f.data } },
            ]),
            { type: 'text' as const, text: userPrompt(body) },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') return errorResponse(422, 'declined', 'This capture could not be analysed. You can still label it manually.');
    if (response.stop_reason === 'max_tokens') return errorResponse(502, 'truncated', 'The analysis was too long. Try fewer frames.');

    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const result = SceneAnalysis.safeParse(JSON.parse(text));
    if (!result.success) return errorResponse(502, 'bad_model_output', 'The analysis could not be validated.');
    const analysis = clampAnalysis(result.data, body.frames.length);

    await recordAiUsage(auth.user.id, 'scene', {
      mode: body.mode,
      frames: body.frames.length,
      objects: analysis.objects.length,
      ms: Date.now() - started,
      model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    return json({ analysis, model: response.model, remainingFree: allowance.pro ? null : Math.max(0, FREE_AI_SCANS_PER_MONTH - allowance.used - 1) });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return errorResponse(429, 'rate_limited', 'Too many requests — try again in a moment.');
    if (err instanceof Anthropic.BadRequestError) return errorResponse(400, 'provider_rejected', 'The images could not be processed.');
    if (err instanceof Anthropic.APIConnectionError) return errorResponse(503, 'provider_unreachable', 'The vision service is unreachable.');
    if (err instanceof Anthropic.APIError) return errorResponse(502, 'provider_error', `Vision service error (${err.status}).`);
    if (err instanceof SyntaxError) return errorResponse(502, 'bad_model_output', 'The analysis was not valid JSON.');
    console.error(err);
    return errorResponse(500, 'internal', 'Unexpected error.');
  }
});
