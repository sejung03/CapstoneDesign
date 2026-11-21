import test from 'node:test';
import assert from 'node:assert/strict';
import {kakaoQueryParams} from '../lib/supabase/kakao-reauth.mjs';

test('only the next Kakao login after logout gets a browser reauthentication prompt',()=>{
 assert.deepEqual(kakaoQueryParams(undefined,'Chrome'),{scope:''});
 assert.deepEqual(kakaoQueryParams('1','Chrome'),{scope:'',prompt:'login'});
 assert.deepEqual(kakaoQueryParams('1','Mozilla/5.0 KAKAOTALK/26.1'),{scope:''});
});
