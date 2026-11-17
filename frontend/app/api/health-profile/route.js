import {verifiedAccount,sameOrigin} from '../../../lib/supabase/auth.js';
import {createHealthProfileHandler} from '../../../lib/health-profile-api.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handle=createHealthProfileHandler({resolveAccount:()=>verifiedAccount(),sameOrigin});
export const GET=handle;
export const PUT=handle;
export const DELETE=handle;
