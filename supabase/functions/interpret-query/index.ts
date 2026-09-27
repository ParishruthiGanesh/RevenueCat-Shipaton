import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { InterpretedQuery, InterpretRequest } from '../_shared/scene-schema.ts';
import { corsHeaders, errorResponse, json, recordAiUsage, requireUser } from '../_shared/http.ts';

/**
 * interpret-query — cloud fallback when the on-device parser is unsure.
 *
 * The model maps a question to a STRUCTURED intent only. It never sees the user's inventory
 * and never writes the answer; the app executes the intent against the local knowledge graph
 * and composes an evidence-grounded response deterministically.
 */

const MODEL = Deno.env.get('PM_QUERY_MODEL') ?? 'claude-opus-5';
const client = new Anthropic();

const SYSTEM = `Translate a question about the user's physical belongings into a structured query for a personal "where did I put it" memory app.

Intents:
- find: where an object is ("where's that black cable thing I use with the monitor" → subject "black cable thing used with the monitor")
- contents: what is inside/at a place
- history, usual, last_seen_time, was_ever_in, previous: questions about an object's past locations
- lent_list: things lent to people; inventory: counting or "do I own"; stale: not seen for a long time
- uncertain, changes (in a place over time), moves, storage, away (away from usual spot), misplaced, not_scanned
Keep the user's own words for subject/place. person = an owner or borrower name if mentioned. sinceDays = time window in days if mentioned, else null.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const parsed = InterpretRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, 'invalid_request', 'question is required');

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(InterpretedQuery) },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: parsed.data.question }],
    });
    if (response.stop_reason === 'refusal') return errorResponse(422, 'declined', 'Could not interpret that question.');
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const q = InterpretedQuery.safeParse(JSON.parse(text));
    if (!q.success) return errorResponse(502, 'bad_model_output', 'Could not interpret that question.');
    await recordAiUsage(auth.user.id, 'interpret', { model: response.model });
    return json({ query: q.data });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return errorResponse(429, 'rate_limited', 'Try again in a moment.');
    if (err instanceof Anthropic.APIError) return errorResponse(502, 'provider_error', `Service error (${err.status}).`);
    return errorResponse(500, 'internal', 'Unexpected error.');
  }
});
