import {handleApi} from '../../../lib/server-api.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request){return handleApi('config',request);}
export function HEAD(request){return handleApi('config',request);}
