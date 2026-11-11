import MedicalApp from './medical-app.jsx';
// Nonce-based CSP requires per-request rendering, including production builds.
export const dynamic='force-dynamic';
export default function Home(){return <MedicalApp />;}
