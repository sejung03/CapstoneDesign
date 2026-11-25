import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOrigin, appOriginFrom, allowedOriginsFrom, isSameOrigin, appUrlInvalid} from '../lib/app-origin.mjs';

const req = (origin, site = 'same-origin') => new Request('https://x.example/api/care', {method: 'POST', headers: {...(origin ? {origin} : {}), 'sec-fetch-site': site}});

test('APP_URL written in common wrong ways is still read, and never throws', () => {
  assert.equal(parseOrigin('https://hear-o.vercel.app'), 'https://hear-o.vercel.app');
  assert.equal(parseOrigin('hear-o.vercel.app'), 'https://hear-o.vercel.app'); // https:// 빠짐
  assert.equal(parseOrigin(' "https://hear-o.vercel.app/" '), 'https://hear-o.vercel.app'); // 따옴표·공백·끝 슬래시
  assert.equal(parseOrigin('http://127.0.0.1:3080'), 'http://127.0.0.1:3080');
  for (const bad of ['', '   ', 'https://a.app, https://b.app', 'ftp://files.example', 'https://', undefined, null, 42]) assert.equal(parseOrigin(bad), null);
  assert.equal(appUrlInvalid({APP_URL: 'https://a.app, https://b.app'}), true);
  assert.equal(appUrlInvalid({APP_URL: 'hear-o.vercel.app'}), false);
  assert.equal(appUrlInvalid({}), false);
});

test('a broken APP_URL falls back to the Vercel deployment address instead of crashing', () => {
  const env = {APP_URL: 'not a url', VERCEL_URL: 'capstone-design-7ft5u5hz7-hear-o.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'capstone-design-hear-o.vercel.app'};
  assert.equal(appOriginFrom(env), 'https://capstone-design-hear-o.vercel.app');
  assert.equal(appOriginFrom({}), 'http://127.0.0.1:3080');
  assert.equal(isSameOrigin(req('https://capstone-design-7ft5u5hz7-hear-o.vercel.app'), env), true);
});

test('this deployment\'s own addresses are accepted; other sites and cross-site requests are not', () => {
  const env = {APP_URL: 'https://capstone-design-hear-o.vercel.app', VERCEL_URL: 'capstone-design-7ft5u5hz7-hear-o.vercel.app', VERCEL_BRANCH_URL: 'capstone-design-git-main-hear-o.vercel.app'};
  assert.deepEqual(allowedOriginsFrom(env).sort(), ['https://capstone-design-7ft5u5hz7-hear-o.vercel.app', 'https://capstone-design-git-main-hear-o.vercel.app', 'https://capstone-design-hear-o.vercel.app']);
  assert.equal(isSameOrigin(req('https://capstone-design-git-main-hear-o.vercel.app'), env), true);
  assert.equal(isSameOrigin(req('https://evil.example'), env), false);
  assert.equal(isSameOrigin(req('https://capstone-design-hear-o.vercel.app', 'cross-site'), env), false);
  assert.equal(isSameOrigin(req(null), env), false);
  assert.equal(isSameOrigin(req('http://127.0.0.1:3080'), {}), true); // 로컬 기본값
});
