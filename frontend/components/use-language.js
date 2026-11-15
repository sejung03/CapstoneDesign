import {useEffect,useState} from 'react';
import {normalizeLocale} from '../i18n.mjs';
export function useLanguage(){
 const [locale,setLocale]=useState('ko');
 useEffect(()=>{try{setLocale(normalizeLocale(localStorage.getItem('medical-language')));}catch{}},[]);
 useEffect(()=>{document.documentElement.lang=locale;},[locale]);
 const change=value=>{const next=normalizeLocale(value);setLocale(next);try{localStorage.setItem('medical-language',next);}catch{}};
 return [locale,change];
}
