import {sameOrigin} from '../../../../lib/supabase/auth.js';
import {forwardVoice} from '../../../../lib/voice-server.mjs';

export const runtime = 'nodejs';

export async function POST(request, {params}) {
  const {action} = await params;
  return forwardVoice(request, action, {sameOrigin});
}
