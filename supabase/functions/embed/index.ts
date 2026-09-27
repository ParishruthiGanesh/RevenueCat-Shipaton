import { z } from 'zod';
import { corsHeaders, errorResponse, json, recordAiUsage, requireUser } from '../_shared/http.ts';

/**
 * embed — multimodal embeddings for visual instance matching and semantic search.
 *
 * Uses Voyage multimodal embeddings (Anthropic's recommended embeddings partner) so an object
 * crop and a text query live in the same vector space: "little black adapter for my monitor"
 * can retrieve the photo of the HDMI adapter. Optional: when VOYAGE_API_KEY is not configured
 * the app transparently falls back to its on-device embedding.
 */

const MODEL = Deno.env.get('PM_EMBED_MODEL') ?? 'voyage-multimodal-3';
export const EMBED_DIM = 1024;

const Req = z.object({
  inputType: z.enum(['query', 'document']),
  inputs: z
    .array(
      z.object({
        text: z.string().max(2000).optional(),
        image: z.object({ mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string() }).optional(),
      }),
    )
    .min(1)
    .max(16),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const key = Deno.env.get('VOYAGE_API_KEY');
  if (!key) return errorResponse(501, 'embeddings_disabled', 'Cloud embeddings are not configured.');
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const parsed = Req.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, 'invalid_request', 'Invalid embedding request.');

  const inputs = parsed.data.inputs.map((i) => ({
    content: [
      ...(i.text ? [{ type: 'text', text: i.text }] : []),
      ...(i.image ? [{ type: 'image_base64', image_base64: `data:${i.image.mediaType};base64,${i.image.data}` }] : []),
    ],
  }));
  if (inputs.some((i) => i.content.length === 0)) return errorResponse(400, 'invalid_request', 'Each input needs text or an image.');

  const res = await fetch('https://api.voyageai.com/v1/multimodalembeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, inputs, input_type: parsed.data.inputType }),
  });
  if (res.status === 429) return errorResponse(429, 'rate_limited', 'Try again in a moment.');
  if (!res.ok) return errorResponse(502, 'provider_error', `Embedding service error (${res.status}).`);
  const body = (await res.json()) as { data: { embedding: number[]; index: number }[]; model: string };
  const vectors = body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  if (vectors.some((v) => v.length !== EMBED_DIM)) return errorResponse(502, 'dimension_mismatch', `Expected ${EMBED_DIM}-d vectors.`);
  await recordAiUsage(auth.user.id, 'embed', { n: vectors.length, model: body.model });
  return json({ model: body.model, vectors });
});
