import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getAdminSession, isSameOrigin } from '../../../lib/admin/auth';
import { createCmsClient, triggerCmsDeployment, writeCmsActivity } from '../../../lib/cms/server';
import { aboutSettingsSchema, settingsMutationSchema, siteSettingsSchema } from '../../../lib/cms/settings-schemas';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });

async function authorize(request: Request, cookies: Parameters<typeof getAdminSession>[1]) {
  const session = await getAdminSession(request, cookies);
  if (!session.ok) return { ok: false as const, response: json({ error: 'Admin authorization is required.' }, session.status) };
  const client = createCmsClient();
  if (!client) return { ok: false as const, response: json({ error: 'CMS database access is not configured.' }, 503) };
  return { ok: true as const, session, client };
}

function flattenValidationError(error: { issues: readonly { path: PropertyKey[]; message: string }[] }) {
  const formErrors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === undefined) formErrors.push(issue.message);
    else (fieldErrors[String(field)] ??= []).push(issue.message);
  }
  return { formErrors, fieldErrors };
}

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;
  const key = url.searchParams.get('key');
  if (key && key !== 'about' && key !== 'site') return json({ error: 'Unsupported settings key.' }, 400);

  let query = owner.client.from('cms_settings').select('key,value,updated_at');
  if (key) query = query.eq('key', key);
  const { data, error } = await query;
  if (error) {
    console.error('CMS settings query failed:', error.message);
    return json({ error: 'Could not load site settings.' }, 503);
  }
  return json({ settings: Object.fromEntries((data ?? []).map((item) => [item.key, item.value])) });
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request, new URL(request.url).origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;
  if (!import.meta.env.VERCEL_DEPLOY_HOOK_URL) {
    return json({ error: 'Public settings cannot be updated until a Vercel deploy hook is configured.' }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }
  const input = settingsMutationSchema.safeParse(body);
  if (!input.success) return json({ error: 'Settings payload is invalid.', fields: z.flattenError(input.error) }, 400);
  const validator = input.data.key === 'about' ? aboutSettingsSchema : siteSettingsSchema;
  const parsed = validator.safeParse(input.data.value);
  if (!parsed.success) return json({ error: 'One or more settings are invalid.', fields: flattenValidationError(parsed.error) }, 400);

  const { error } = await owner.client.from('cms_settings').upsert({
    key: input.data.key,
    value: parsed.data,
    updated_by: owner.session.user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error('CMS settings save failed:', error.message);
    return json({ error: 'Could not save these settings.' }, 503);
  }
  await writeCmsActivity(owner.client, {
    actorId: owner.session.user.id,
    action: `updated_${input.data.key}`,
  });

  if (!await triggerCmsDeployment()) {
    return json({ warning: 'Settings were saved, but the public site deployment could not be triggered.' }, 502);
  }
  return json({ saved: true });
};
