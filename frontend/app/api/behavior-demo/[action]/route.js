import {createBehaviorDemoHandler} from '../../../../lib/behavior/demo-server.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Never expose test accounts/data outside Next.js development mode.
const handle = createBehaviorDemoHandler({enabled: process.env.NODE_ENV === 'development'});
export async function GET(req, context){return handle(req,(await context.params).action);}
export async function POST(req, context){return handle(req,(await context.params).action);}
export async function PUT(req, context){return handle(req,(await context.params).action);}
export async function PATCH(req, context){return handle(req,(await context.params).action);}
export async function DELETE(req, context){return handle(req,(await context.params).action);}
