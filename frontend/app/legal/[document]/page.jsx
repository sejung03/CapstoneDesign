import {notFound} from 'next/navigation';
import {normalizeLocale,phrase,languageTags} from '../../../i18n.mjs';
import {LegalDocumentBody,legalTitleKey} from '../../../components/legal-document.jsx';

export default async function LegalPage({params,searchParams}){
 const {document}=await params;
 if(!Object.hasOwn(legalTitleKey,document))notFound();
 const locale=normalizeLocale((await searchParams).lang),t=key=>phrase(locale,key);
 return <main id="main" lang={languageTags[locale]} className="legal-page">
   <a href="/">{t('Back to Medical Guide')}</a>
   <h1>{t(legalTitleKey[document])}</h1>
   <LegalDocumentBody document={document} locale={locale} />
 </main>;
}
