import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import ts from 'typescript';import {readFileSync} from 'node:fs';import * as crypto from 'node:crypto';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/api/webhooks/resend/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,Date,require:id=>id==='node:crypto'?crypto:{}});
const secret='whsec_'+Buffer.alloc(32,7).toString('base64'),now=Date.now(),at=String(Math.floor(now/1000)),raw='{"type":"email.bounced","data":{"email_id":"fixture"}}';
const signature=crypto.createHmac('sha256',Buffer.alloc(32,7)).update(`fixture.${at}.${raw}`).digest('base64');
const headers=()=>new Headers({'svix-id':'fixture','svix-timestamp':at,'svix-signature':'v1,'+signature});
test('Resend callback verifies raw signature and timestamp',()=>assert.equal(exports.verifyResendSignature(raw,headers(),secret,now),true));
test('Resend callback rejects tampering, wrong key and expired replay',()=>{assert.equal(exports.verifyResendSignature(raw+' ',headers(),secret,now),false);assert.equal(exports.verifyResendSignature(raw,headers(),'whsec_'+Buffer.alloc(32,8).toString('base64'),now),false);assert.equal(exports.verifyResendSignature(raw,headers(),secret,now+301000),false);});
test('Resend callback supports signature rotation but not unknown versions',()=>{const h=headers();h.set('svix-signature','v1,invalid v1,'+signature);assert.equal(exports.verifyResendSignature(raw,h,secret,now),true);h.set('svix-signature','v2,'+signature);assert.equal(exports.verifyResendSignature(raw,h,secret,now),false);});

if(process.env.ITEM05_BROWSER_TEST==='1')test('browser preserves deletion access during export, cancellation and account changes',async()=>{
 const {chromium}=await import('playwright');const {createServer}=await import('node:http');
 const component=ts.transpileModule(readFileSync(new URL('../src/components/privacyrequest/PrivacyRequestConfirmation.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 const react=readFileSync(new URL('../node_modules/react/umd/react.development.js',import.meta.url),'utf8');
 const dom=readFileSync(new URL('../node_modules/react-dom/umd/react-dom.development.js',import.meta.url),'utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/react.js'||req.url==='/dom.js'?'text/javascript':'text/html');res.end(req.url==='/react.js'?react:req.url==='/dom.js'?dom:'<div id="root"></div><script src="/react.js"></script><script src="/dom.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(code=>{
  window.auth={user:{id:'owner-one',identities:[]},loading:false,openAuthModal(){}};window.saved={};window.requests=[];
  window.require=id=>id==='react'?window.React:id==='@/contexts/AuthContext'?{useAuth:()=>window.auth}:{supabase:{auth:{getSession:async()=>({data:{session:{user:window.auth.user,access_token:'fixture'}}})}}};
  window.exports={};window.fetch=async(path,init={})=>{
   window.requests.push(path);const body=init.body?JSON.parse(init.body):null;
   if(path.includes('/operations/')){const data=window.saved[path.split('/').pop()];return {ok:!!data,json:async()=>data||{reason:'operation_not_found'}};}
   if(path.endsWith('/privacy-verification'))return {ok:true,json:async()=>({confirmation:'fixture',destination:window.auth.user.id+'@example.invalid'})};
   const data={id:body.operationId,kind:path.endsWith('/delete')?'delete':'export',state:'queued',accountRemoved:false,cleanupCompleted:false};window.saved[data.id]=data;return {ok:true,json:async()=>data};
  };
  (0,eval)(code);window.root=ReactDOM.createRoot(document.getElementById('root'));
  window.renderPrivacy=()=>window.root.render(React.createElement(window.exports.default));window.renderPrivacy();
 },component);
 await page.getByRole('button',{name:'Export my data',exact:true}).click();
 await page.getByRole('button',{name:'Email my data',exact:true}).click();
 await page.getByText('Your request is being processed.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Delete my account',exact:true}).click();
 await page.getByRole('button',{name:'Keep my account',exact:true}).click();
 await page.getByRole('button',{name:'Export my data',exact:true}).click();
 await page.getByText('Your request is being processed.',{exact:true}).waitFor();
 await page.evaluate(()=>{window.auth={...window.auth,user:{id:'owner-two',identities:[]}};window.renderPrivacy();});
 await page.getByRole('button',{name:'Export my data',exact:true}).waitFor();
 assert.equal(await page.getByText('Your request is being processed.',{exact:true}).count(),0);
 assert.equal(await page.getByText('owner-one@example.invalid',{exact:false}).count(),0);
 await page.getByRole('button',{name:'Export my data',exact:true}).click();
 await page.getByText('Email my data to owner-two@example.invalid.',{exact:true}).waitFor();
 assert.equal(await page.getByText('owner-one@example.invalid',{exact:false}).count(),0);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
