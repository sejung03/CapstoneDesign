import {createBehaviorService} from './service.js';
import {BehaviorValidationError, FavoriteLimitError, requireVerifiedUser} from './validation.js';

/**
 * Transport-agnostic REST handler with an injected trusted session verifier.
 * Do not mount with request-supplied user_id, development fake headers or a service-role client.
 * No route is installed until real auth is available; offline tests call this directly.
 */
export function createBehaviorApi({repository, resolveSession, expectedOrigin = null}) {
  if (typeof resolveSession !== 'function') throw new TypeError('resolveSession must be a server-side authenticated session resolver');
  const service = createBehaviorService({repository});
  const headers = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'};
  const json = (value, status = 200) => Response.json(value, {status, headers});

  async function body(request) {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new BehaviorValidationError('JSON content type required');
    const size = request.headers.get('content-length');
    if (size !== null && (Number.isNaN(Number(size)) || Number(size) > 4096)) throw new BehaviorValidationError('Request too large');
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > 4096) throw new BehaviorValidationError('Request too large');
    let data;
    try { data = JSON.parse(text); } catch { throw new BehaviorValidationError('Invalid JSON'); }
    return data;
  }
  return async function handleBehaviorRequest(request, action) {
    try {
      const session = await resolveSession(request); // server-authenticated, never from body
      requireVerifiedUser(session);
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
        const origin = request.headers.get('origin');
        const site = request.headers.get('sec-fetch-site');
        // Next may expose an internal hostname in request.url. The application
        // injects its configured public origin; never trust forwarded headers.
        if (!origin || origin !== (expectedOrigin ?? new URL(request.url).origin) || site === 'cross-site') return json({error: 'invalid_origin'}, 403);
      }
      if (action === 'settings' && request.method === 'GET') return json({settings: await service.getSettings(session)});
      if (action === 'settings' && request.method === 'PATCH') return json({settings: await service.saveSettings(session, await body(request))});
      if (action === 'favorites' && request.method === 'GET') return json({items: await service.getFavorites(session)});
      if (action === 'favorites' && request.method === 'PUT') return json({items: await service.saveFavorite(session, await body(request))});
      if (action === 'signal' && request.method === 'GET') return json({signal: await service.getPreferenceSignal(session)});
      if (action === 'statements' && request.method === 'GET') return json({statements: await service.getBehaviorStatements(session)});
      if (action === 'all' && request.method === 'DELETE') return json({deleted: await service.deleteAll(session)});
      if (action === 'facility-choice' && request.method === 'POST') return json(await service.recordFacilityChoice(session, await body(request)));
      if (action === 'department-choice' && request.method === 'POST') return json(await service.recordDepartmentChoice(session, await body(request)));
      if (action === 'choices' && request.method === 'GET') return json(await service.listChoices(session));
      if (action === 'choices' && request.method === 'DELETE') return json({deleted: await service.deleteChoices(session)});
      return json({error: 'method_not_allowed'}, 405);
    } catch (error) {
      if (error?.name === 'AuthenticationError') return json({error: 'authentication_required'}, 401);
      if (error instanceof FavoriteLimitError) return json({error: 'favorite_limit_20'}, 409);
      if (error instanceof BehaviorValidationError) return json({error: 'invalid_payload', message: error.message}, 400);
      // Do not leak database errors or user data.
      return json({error: 'internal_error'}, 500);
    }
  };
}
