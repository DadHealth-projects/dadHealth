// Operator only. Preview by default; never embed credentials or infer publisher identity.
import {readFile} from 'node:fs/promises';
const apply=process.argv.includes('--apply');
const publisherArg=process.argv.find(arg=>arg.startsWith('--publisher='));
const publisher=publisherArg?.slice('--publisher='.length);
if(!publisher||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(publisher)||process.argv.slice(2).some(arg=>arg!=='--apply'&&arg!==publisherArg))throw Error('Supply --publisher=<verified Auth UUID>; omit --apply for preview.');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw Error('Server environment is required.');
const prompts=JSON.parse(await readFile(new URL('../supabase/seeds/jamie-circle-prompts-20261119.json',import.meta.url),'utf8'));
const response=await fetch(url+'/rest/v1/rpc/'+(apply?'import_community_prompts':'preview_community_prompt_import'),{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_prompts:prompts,p_publisher_id:publisher})});
if(!response.ok)throw Error('Prompt mapping/import rejected. Check circle names, stable keys and existing content; no credentials are logged.');
console.log(JSON.stringify(await response.json(),null,2));
