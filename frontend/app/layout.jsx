import '../styles.css';
import '../ui.css';
import '../workspace.css';
export const metadata={title:'의료 안내 | 가까운 병원 찾기',description:'증상을 정리하고 가까운 병원과 약국을 찾습니다.',icons:{icon:'/favicon.svg'}};
export const viewport={width:'device-width',initialScale:1,colorScheme:'light dark'};
export default function RootLayout({children}){
 return <html lang="ko" data-theme="light" suppressHydrationWarning><head><link rel="preload" href="/fonts/SUIT-Variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /></head><body suppressHydrationWarning><a href="#main" className="skip-link">본문으로 이동</a>{children}</body></html>;
}
