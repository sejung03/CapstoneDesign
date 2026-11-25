import '../styles.css';
import '../ui.css';
import '../workspace.css';
export const metadata={title:'HearO | 가까운 병원 찾기',description:'증상을 정리하고 가까운 병원과 약국을 찾습니다.',icons:{icon:[{url:'/favicon.ico',sizes:'any'},{url:'/brand-icon.png',type:'image/png',sizes:'512x512'}],apple:'/apple-icon.png'}};
export const viewport={width:'device-width',initialScale:1,colorScheme:'light dark'};
export default function RootLayout({children}){
 return <html lang="ko" data-theme="light" suppressHydrationWarning><head><link rel="preload" href="/fonts/SUIT-Variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /></head><body suppressHydrationWarning><a href="#main" className="skip-link">본문으로 이동</a>{children}</body></html>;
}
