/**
 * Browser HTTP adapter ONLY. Not automatically connected; routes stay unavailable
 * until a verified-user server session and DB repository are provided.
 * Never send accountId/user_id or Supabase secret keys in requests.
 */
export function createBehaviorClient({fetchImpl = fetch, base = '/api/behavior'} = {}) {
  const call = async (path, {method = 'GET', body, signal} = {}) => {
    const response = await fetchImpl(`${base}/${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', signal,
      ...(body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}),
    });
    if (!response.ok) {
      const err = new Error(`Behavior API ${response.status}`);
      err.status = response.status;
      throw err;
    }
    return response.json();
  };
  return Object.freeze({
    favorites: {
      list: async ({signal} = {}) => (await call('favorites', {signal})).items,
      set: async ({facility, favorite}, {signal} = {}) => {
        await call('favorites', {method: 'PUT', body: {facility, favorite}, signal});
      },
    },
    settings: {
      get: async ({signal} = {}) => (await call('settings', {signal})).settings,
      save: async (patch, {signal} = {}) => (await call('settings', {method: 'PATCH', body: patch, signal})).settings,
      disable: async ({signal} = {}) => (await call('settings', {method: 'PATCH', body: {personalization_enabled: false}, signal})).settings,
      deleteAll: async ({signal} = {}) => (await call('all', {method: 'DELETE', signal})).deleted,
    },
    // Counts only. The server decides whether to record (login, personalization, health storage consent).
    choices: Object.freeze({
      recordFacility: async (facility, {signal} = {}) => call('facility-choice', {method: 'POST', body: {facility}, signal}),
      recordDepartment: async (department, {signal} = {}) => call('department-choice', {method: 'POST', body: {department}, signal}),
      list: async ({signal} = {}) => call('choices', {signal}),
      clear: async ({signal} = {}) => (await call('choices', {method: 'DELETE', signal})).deleted,
    }),
    signal: async ({signal} = {}) => (await call('signal', {signal})).signal,
    statements: async ({signal} = {}) => (await call('statements', {signal})).statements,
  });
}
