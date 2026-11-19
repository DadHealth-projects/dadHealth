"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/utils/supabaseClient';

type Pending = { id: string; owner: string; kind: 'export' | 'delete'; recovery: string };
type View = { state: string; accountRemoved: boolean; cleanupCompleted: boolean };
// No GET starts an operation. A recovery capability permits status only, never
// reading exported data or authorizing another destructive request.
export default function PrivacyRequestConfirmation() {
 const {user,loading,openAuthModal}=useAuth();
 if(loading)return <p role="status">Checking your sign-in…</p>;
 return <PrivacyRequestForOwner key={user?.id ?? 'signed-out'} owner={user?.id} apple={user?.identities?.some(i=>i.provider==='apple')===true} openAuthModal={openAuthModal}/>;
}
function PrivacyRequestForOwner({owner,apple,openAuthModal}:{owner?:string;apple:boolean;openAuthModal():void}) {
 const [pending,setPending]=useState<Pending|null>(null);
 const [confirmation,setConfirmation]=useState<string|null>(null);
 const [destination,setDestination]=useState<string|null>(null);
 const [status,setStatus]=useState<View|null>(null);
 const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
 const lock=useRef(false); const reading=useRef(false); const activeCalls=useRef(0); const alive=useRef(false); const request=useRef<AbortController|null>(null);
 const [download,setDownload]=useState<string|null>(null);
 const call=useCallback(async(path:string,body?:unknown,recovery?:string)=>{
  request.current?.abort();const controller=new AbortController();request.current=controller;
  activeCalls.current+=1;
  try {
  const response=await fetch('/api/account/'+path,{method:body?'POST':'GET',cache:'no-store',signal:controller.signal,
   headers:{...(body?{'Content-Type':'application/json'}:{}),...(recovery?{'X-Privacy-Recovery':recovery}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(controller.signal.aborted || request.current!==controller)throw Object.assign(Error('Request superseded'),{reason:'superseded'});if(!response.ok) throw Object.assign(Error(data.reason==='reauthentication_required'||response.status===401
   ?'Please sign in again to confirm your identity.':data.reason==='verified_email_required'
   ?'Please verify your account email first.':'We couldn’t confirm your request. Contact privacy support if this continues.'),{reason:data.reason});
  return data;
  } finally {activeCalls.current-=1;}
 },[]);
 const refresh=useCallback(async(op:Pending)=>{
  if(reading.current||lock.current||activeCalls.current>0)return;reading.current=true;
  try {const data=await call('operations/'+op.id,undefined,op.kind==='delete'?op.recovery:undefined);
   if(alive.current && data.id===op.id && data.kind===op.kind) { setStatus(data); setMessage(''); }
  }catch(error) {if((error as {reason?:string}).reason==='superseded')return;if(alive.current)setMessage('We couldn’t confirm your request yet. Reopen this page to check its saved status.');}
  finally{reading.current=false;}
 },[call]);
 useEffect(()=>{
  alive.current=true;
  const id=new URLSearchParams(window.location.search).get('download');
  if(id&&/^[0-9a-f-]{36}$/i.test(id))setDownload(id);
  try {const saved=JSON.parse(sessionStorage.getItem('dadhealth.privacy.operation')||'null');
   if(saved&&typeof saved.owner==='string'&&(owner===saved.owner||!owner&&saved.kind==='delete')&&/^[0-9a-f-]{36}$/i.test(saved.id)&&['delete','export'].includes(saved.kind)&&/^[\w-]{43}$/.test(saved.recovery)) {
    setPending(saved);void refresh(saved);
   }
  }catch{setMessage('Your saved request could not be checked. Contact privacy support.');}
  return()=>{alive.current=false;request.current?.abort();};
 },[refresh,owner]);
 useEffect(()=>{
  if(!pending||!status||busy||['completed','failed','cancelled','sent_for_delivery','delivery_failed','reconfirmation_required'].includes(status.state))return;
  let remaining=12;
  const check=()=>{if(document.visibilityState==='visible'&&remaining>0&&!reading.current&&!lock.current){remaining-=1;void refresh(pending);}};
  const timer=setInterval(check,5000);
  const foreground=()=>{if(document.visibilityState==='visible'){remaining=12;check();}};
  document.addEventListener('visibilitychange',foreground);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',foreground);};
 },[pending,status?.state,busy,refresh]);
 async function prepare(kind:'export'|'delete') {
  if(lock.current||!owner)return;lock.current=true;setBusy(true);setMessage('');setConfirmation(null);
  try {
   const bytes=crypto.getRandomValues(new Uint8Array(32));
   const stored = sessionStorage.getItem(`dadhealth.privacy.${owner}.${kind}`);
   const previous = stored ? JSON.parse(stored) as Pending : null;
   const op=(pending?.kind===kind ? pending : previous?.owner===owner && previous.kind===kind ? previous : null)??{id:crypto.randomUUID(),owner,kind,recovery:btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
   setStatus(null);setDestination(null);
   sessionStorage.setItem('dadhealth.privacy.operation',JSON.stringify(op));
   sessionStorage.setItem(`dadhealth.privacy.${owner}.${kind}`,JSON.stringify(op));setPending(op);
   try {
    const saved=await call('operations/'+op.id,undefined,kind==='delete'?op.recovery:undefined);
    if(alive.current&&saved.id===op.id&&saved.kind===kind) {
      setStatus(saved);
      if(saved.state!=='reconfirmation_required')return;
    }
   } catch(error) { if((error as {reason?:string}).reason!=='operation_not_found')throw error; }
   const data=await call('privacy-verification',{operationId:op.id,kind});
   if(typeof data.confirmation!=='string'||kind==='export'&&typeof data.destination!=='string')throw Error('Confirmation unavailable.');
   if(alive.current){setConfirmation(data.confirmation);setDestination(data.destination);}
  }catch(e){if(alive.current)setMessage(e instanceof Error?e.message:'Confirmation unavailable.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 async function submit(){
  if(lock.current||!pending||!confirmation)return;lock.current=true;setBusy(true);setMessage('');
  try{const data=await call(pending.kind,{operationId:pending.id,confirmation,recovery:pending.recovery});
   if(alive.current&&data.id===pending.id&&data.kind===pending.kind)setStatus(data);
  }catch{if(alive.current)setMessage('We couldn’t confirm your request yet.');}
  finally{setConfirmation(null);lock.current=false;if(alive.current){setBusy(false);void refresh(pending);}}
 }
 const button='min-h-12 rounded-xl bg-primary px-5 py-3 font-heading font-bold text-primary-foreground disabled:opacity-50';
 return <section className="mx-auto max-w-2xl space-y-5 px-6 py-12">
  <h1 className="font-heading text-3xl font-bold">Your data</h1>
  <p>Sign in with your existing account to confirm an export or deletion. An email address alone does not authorise either action.</p>
  <button className={button} onClick={openAuthModal}>{owner?'Confirm sign-in':'Sign in'}</button>
  {download?<a className={button} href={'/api/account/exports/'+download+'/download'}>Download my data</a>:null}
  <p>Exports contain saved check-ins, Journal, activity and account information. Photos are listed, not attached. Unsynced device drafts are not included. Keep your file safe.</p>
  <p>Deleting your account permanently removes personal information. Empty community placeholders may remain to preserve replies. Calendars you own are removed; invited-parent associations are removed.</p>
  <p>Deletion does not cancel subscriptions. Manage Apple subscriptions in Settings → your name → Subscriptions, Google Play subscriptions in Payments & subscriptions, or web subscriptions through your membership controls.</p>
  {owner ? <button className={button} disabled={busy} onClick={()=>{
    if(lock.current)return;lock.current=true;setBusy(true);
    void (async()=>{
      const session=await supabase.auth.getSession();
      if(!alive.current||session.data.session?.user.id!==owner)throw Error('account_changed');
      const response=await fetch('/api/native-subscriptions/manage',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.data.session.access_token}`},body:'{}'});
      const data=await response.json();
      const current=await supabase.auth.getSession();
      if(!response.ok||typeof data.url!=='string'||!data.url.startsWith('https://'))throw Error('management_unavailable');
      if(alive.current&&current.data.session?.user.id===owner)window.location.assign(data.url);
    })().catch(()=>{if(alive.current)setMessage('Membership management could not be opened. Account deletion remains available.');})
      .finally(()=>{lock.current=false;if(alive.current)setBusy(false);});
  }}>Manage subscription</button>:null}
  {status?<p role="status">{status.cleanupCompleted?'Your account and required cleanup are complete.':status.state==='failed'||status.state==='delivery_failed'?'Your request needs support attention.':status.state==='cancelled'?'This export was cancelled.':status.accountRemoved?'Your account has been removed. Required cleanup is still pending.':status.state==='sent_for_delivery'?'Your export has been sent for delivery.':status.state==='reconfirmation_required'?'Your email changed. Confirm your current address before sending.':'Your request is being processed.'}</p>:null}
  {message?<p role="status">{message}</p>:null}
  {owner ? <button className={button} disabled={busy} onClick={()=>{void call('privacy-verification',{action:'verify_email'}).then(data=>{if(alive.current)setMessage(data.state==='verified'?'Your account email is verified. Confirm your export again.':'Check your account email to verify it, then confirm your export again.');}).catch(()=>{if(alive.current)setMessage('Email verification could not be requested. Deletion remains available.');});}}>Verify account email</button>:null}
  {owner && apple && pending?.kind==='delete' ? <a className={button} href={'/api/account/privacy-verification?apple='+encodeURIComponent(pending.id)}>Confirm Apple identity for deletion</a>:null}

  {pending?.kind==='export'&&status&&['sent_for_delivery','delivery_failed','failed','cancelled'].includes(status.state)?
   <button className={button} onClick={()=>{sessionStorage.removeItem('dadhealth.privacy.operation');if(owner)sessionStorage.removeItem(`dadhealth.privacy.${owner}.export`);setPending(null);setStatus(null);setConfirmation(null);setDestination(null);}}>Request another export</button>:null}
  {owner && !confirmation && (pending?.kind!=='delete' || !status || status.state==='reconfirmation_required')?<div className="flex flex-wrap gap-3">
   <button className={button} disabled={busy} onClick={()=>void prepare('export')}>Export my data</button>
   <button className={button} disabled={busy} onClick={()=>void prepare('delete')}>Delete my account</button>
  </div>:null}
  {confirmation?<div className="space-y-3">
   <p>{pending?.kind==='export'?`Email my data to ${destination}.`:'This cannot be undone. Deleting your account does not cancel a paid subscription.'}</p>
   <button className={button} disabled={busy} onClick={()=>void submit()}>{pending?.kind==='export'?'Email my data':'Delete my account'}</button>
   <button className="min-h-12 px-5" disabled={busy} onClick={()=>{setConfirmation(null);setPending(null);setStatus(null);setDestination(null);}}>{pending?.kind==='delete'?'Keep my account':'Cancel'}</button>
  </div>:null}
  {busy?<p role="status">Processing your request…</p>:null}
  <p><a className="underline" href="/privacy-request">Privacy assistance, correction or other enquiries</a></p>
 </section>;
}
