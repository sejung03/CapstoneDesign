import {fileURLToPath} from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig={
 reactStrictMode:true,
 poweredByHeader:false,
 devIndicators:false,
 outputFileTracingRoot:fileURLToPath(new URL('../',import.meta.url)),
 outputFileTracingIncludes:{
  '/api/care':[
   '../care_engine/engine/*.mjs',
   '../care_engine/engine/rules/*.json',
   '../care_engine/llm/*.mjs',
   '../care_engine/llm/providers/*.mjs',
   '../care_engine/llm/prompts/*.mjs',
   '../data_pipeline/db/seed/v2.1-20261113/*.csv',
  ],
 },
};
export default nextConfig;
