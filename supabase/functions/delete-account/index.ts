import { adminClient, corsHeaders, errorResponse, json, requireUser } from '../_shared/http.ts';

/**
 * delete-account — "Erase everything". Removes all media objects, all rows (cascade from
 * auth.users) and the auth user itself. Irreversible; the app confirms twice before calling.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const admin = adminClient();
  const uid = auth.user.id;

  // Storage objects live under media/<uid>/… — list and remove in pages.
  for (;;) {
    const { data, error } = await admin.storage.from('media').list(uid, { limit: 1000 });
    if (error) return errorResponse(500, 'storage_error', error.message);
    if (!data?.length) break;
    const { error: rmErr } = await admin.storage.from('media').remove(data.map((f) => `${uid}/${f.name}`));
    if (rmErr) return errorResponse(500, 'storage_error', rmErr.message);
    if (data.length < 1000) break;
  }

  // All user tables reference auth.users(id) ON DELETE CASCADE.
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) return errorResponse(500, 'delete_failed', error.message);
  return json({ deleted: true });
});
