// Local development reference implementation. Server side only.
// Node.js 24.15+ recommended (built-in node:sqlite module).
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export const SESSION_COOKIE='capstone_session';
export const PENDING_COOKIE='capstone_signup';
export const STATE_COOKIE='capstone_oauth_state';
export const cookieOptions={httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'};

let db;
function store(){
 if(db)return db;
 const directory=join(process.cwd(),'.local-data');mkdirSync(directory,{recursive:true});
 db=new DatabaseSync(join(directory,'auth.sqlite'));
 db.exec(`PRAGMA foreign_keys=ON;
 PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, kakao_id TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS consents(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL, item_id TEXT NOT NULL,
  agreed INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,policy_version,item_id)
 );
 CREATE TABLE IF NOT EXISTS pending_signups(
  token_hash TEXT PRIMARY KEY,kakao_id TEXT NOT NULL,expires_at INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
 );`);
 return db;
}
const hash=token=>createHash('sha256').update(token).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
export const sessionMaxAge=60*60*24*7;
export const pendingMaxAge=60*15;

export function compareState(left,right){
 if(typeof left!=='string'||typeof right!=='string'||left.length!==right.length||left.length<16)return false;
 return timingSafeEqual(Buffer.from(left),Buffer.from(right));
}
export function findUser(kakaoId){return store().prepare('SELECT id FROM users WHERE kakao_id=?').get(String(kakaoId));}
export function issuePending(kakaoId){
 const value=token(),expiresAt=Date.now()+pendingMaxAge*1000;
 store().prepare('INSERT INTO pending_signups(token_hash,kakao_id,expires_at) VALUES(?,?,?)').run(hash(value),String(kakaoId),expiresAt);
 return value;
}
export function lookupPending(value){
 if(!value)return null;
 const record=store().prepare('SELECT kakao_id,expires_at FROM pending_signups WHERE token_hash=?').get(hash(value));
 return record && record.expires_at>Date.now()?record:null;
}
export function registerUser(value,{policyVersion,decisions}){
 const pending=lookupPending(value);
 if(!pending)throw Error('signup_expired');
 const database=store(),now=Date.now();
 database.exec('BEGIN IMMEDIATE');
 try{
  let row=database.prepare('SELECT id FROM users WHERE kakao_id=?').get(pending.kakao_id);
  if(!row){
   const id=randomUUID();
   database.prepare('INSERT INTO users(id,kakao_id,created_at) VALUES(?,?,?)').run(id,pending.kakao_id,now);
   row={id};
   const insert=database.prepare('INSERT INTO consents(user_id,policy_version,item_id,agreed,recorded_at) VALUES(?,?,?,?,?)');
   for(const item of decisions)insert.run(id,policyVersion,item.id,item.agreed?1:0,now);
  }
  database.prepare('DELETE FROM pending_signups WHERE token_hash=?').run(hash(value));
  database.exec('COMMIT');
  return row.id;
 }catch(error){database.exec('ROLLBACK');throw error;}
}
export function issueSession(userId){
 const value=token();
 const database=store();
 database.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
 database.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(value),userId,Date.now()+sessionMaxAge*1000);
 return value;
}
export function lookupSession(value){
 if(!value)return null;
 const row=store().prepare('SELECT users.id AS accountId FROM sessions JOIN users ON sessions.user_id=users.id WHERE token_hash=? AND expires_at>?').get(hash(value),Date.now());
 return row||null;
}
export function revokeSession(value){if(value)store().prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(value));}
export function sameOrigin(request){
 const origin=request.headers.get('origin');
 const expected=new URL(process.env.KAKAO_REDIRECT_URI||'http://127.0.0.1:3080').origin;
 return origin===expected;
}
export function appUrl(path='/'){
 return new URL(path,new URL(process.env.KAKAO_REDIRECT_URI||'http://127.0.0.1:3080').origin);
}
