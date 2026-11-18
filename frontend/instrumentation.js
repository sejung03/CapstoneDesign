// Next.js가 서버를 시작할 때 한 번 부른다(node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
// 11/18: 문진 LLM 예열. register는 서버 준비 전에 끝나야 하므로 기다리지 않고 시작만 한다.
// /api/care 경로 모듈은 첫 요청 때 로드되므로, 거기서 예열하면 첫 사용자 요청과 겹친다.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const {createRefStore, warmCareLlm} = await import('./lib/care-engine-server.mjs');
    const {supabaseConfig} = await import('./lib/supabase/config.js');
    const refStore = createRefStore({supabaseConfig: () => supabaseConfig()});
    // Supabase 데이터를 먼저 읽고(실패하면 시드 CSV) 같은 후보 목록으로 예열한다
    void refStore.warm().then(() => warmCareLlm({refStore}));
  } catch {
    // 예열 실패는 서비스에 영향이 없다(첫 요청이 조금 느릴 뿐)
  }
}
