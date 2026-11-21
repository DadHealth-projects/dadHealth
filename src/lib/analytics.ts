"use client";

import { permittedProperties } from './analytics/contract';

export type AnalyticsConsentValue = 'granted' | 'denied';
export const ANALYTICS_CONSENT_KEY = 'dadhealth.analytics-consent';
export const ANALYTICS_SETTINGS_EVENT = 'dadhealth:open-cookie-settings';
const scopeKey = 'dadhealth.analytics.scopes.v1';
const revokedKey = 'dadhealth.analytics.revoked.v1';
type Scope = { owner: string | null; consent: string; secret: string; expiresAt?: string };
let owner: string | null = null;
let withdrawn = false, listening = false;
let pageviewCaptured = false;
const requests = new Set<AbortController>();
const pendingRevocations = new Map<string, Scope>();
let revocationRunning = false;
let credentialEpoch = 0;
let credentialBusy = false;
let credentialBlocked = false;
const liveScope = () => !credentialBlocked ? read(scopeKey).find(s => s.owner===owner && Date.parse(s.expiresAt ?? '')>Date.now()) : undefined;
async function prepareCredential(explicit = false) {
  if(!permitted() || credentialBusy) return;
  const acceptedOwner=owner, generation=credentialEpoch;
  const previous=read(scopeKey).find(s=>s.owner===owner);
  if(!explicit && (!previous || Date.parse(previous.expiresAt ?? '')<=Date.now() || !Number.isFinite(Date.parse(previous.expiresAt ?? '')))) { credentialBlocked=true; return; }
  if(!explicit && !credentialBlocked && Date.parse(previous!.expiresAt!)>Date.now()+86400000) return;
  credentialBusy=true;credentialBlocked=true;
  const controller=new AbortController();requests.add(controller);
  const timer=setTimeout(()=>controller.abort(),8000);
  let issued: Scope | undefined;
  try {
    const response=await fetch('/api/analytics/events',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(explicit
      ? {action:'grant',owner:acceptedOwner}
      : {action:'renew',owner:acceptedOwner,consent:previous!.consent,secret:previous!.secret})});
    if(!response.ok) return;
    const next=await response.json() as Scope;
    if(next.owner!==acceptedOwner || typeof next.consent!=='string' || typeof next.secret!=='string' || !(Date.parse(next.expiresAt ?? '')>Date.now())) return;
    issued=next;
    if(controller.signal.aborted || generation!==credentialEpoch || owner!==acceptedOwner || !permitted()) {
      pendingRevocations.set(next.consent,next);
      window.localStorage.setItem(revokedKey,JSON.stringify([...read(revokedKey),next]));
      void revokePending();return;
    }
    if (previous && previous.consent !== next.consent) {
      pendingRevocations.set(previous.consent,previous);
      window.localStorage.setItem(revokedKey,JSON.stringify([...pendingRevocations.values()]));
    }
    window.localStorage.setItem(scopeKey,JSON.stringify([...read(scopeKey).filter(s=>s.owner!==acceptedOwner),next]));
    void revokePending();
    credentialBlocked=false;
  } catch {
    // Keep a newly issued but unpersisted grant revocable even if storage failed.
    if (issued && issued.consent !== previous?.consent) {
      pendingRevocations.set(issued.consent,issued);
      void revokePending();
    }
  }
  finally {clearTimeout(timer);requests.delete(controller);credentialBusy=false;}
}
function read(key: string): Scope[] {
  try { const rows=JSON.parse(window.localStorage.getItem(key) ?? '[]'); return Array.isArray(rows)?rows:[]; } catch { return []; }
}
function permitted() {
  try { return !withdrawn && typeof window!=='undefined' && window.localStorage.getItem(ANALYTICS_CONSENT_KEY)==='granted'
    && process.env.NEXT_PUBLIC_ANALYTICS_ENABLED==='true'; } catch { return false; }
}
async function revokePending() {
  if (typeof window === 'undefined' || revocationRunning) return;

  for (const scope of read(revokedKey)) {
    if (scope && typeof scope.consent === 'string') {
      pendingRevocations.set(scope.consent, scope);
    }
  }

  revocationRunning = true;

  try {
    for (const scope of [...pendingRevocations.values()].slice(0, 200)) {
      try {
        const response = await fetch('/api/analytics/events', {
          method: 'POST',
          keepalive: true,
          signal: AbortSignal.timeout(8000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'withdraw', owner: scope.owner, consent: scope.consent, secret: scope.secret }),
        });

        if (!response.ok) continue;

        const result = await response.json();
        if (result?.withdrawn !== true) continue;

        // Remove the retired scope as well if an earlier removal failed.
        window.localStorage.setItem(
          scopeKey,
          JSON.stringify(read(scopeKey).filter(
            item => item?.consent !== scope.consent,
          )),
        );

        window.localStorage.setItem(
          revokedKey,
          JSON.stringify(read(revokedKey).filter(
            item => item?.consent !== scope.consent,
          )),
        );

        pendingRevocations.delete(scope.consent);
      } catch {
        // Retain the capability for a later recovery opportunity.
        break;
      }
    }
  } finally {
    revocationRunning = false;
  }
}
export function initAnalytics(confirmedConsent = false) {
  // No SDK automatic capture, page URL/referrer capture, person properties or
  // session recording. Optional manual events use the validated backend only.
  if (confirmedConsent) withdrawn = false;
  if (typeof window!=='undefined' && !listening) {
    listening = true;
    window.addEventListener('storage', event => {
  if (
    event.key === ANALYTICS_CONSENT_KEY &&
    event.newValue !== 'granted'
  ) {
    withdrawAnalyticsConsent();
  } else if (event.key === revokedKey) {
    void revokePending();
  }
});

window.addEventListener('online', () => {
  void revokePending();
  void prepareCredential();
});
  }
  void revokePending();

  void prepareCredential(confirmedConsent).then(() => {
    if (permitted() && liveScope() && !pageviewCaptured) {
      pageviewCaptured = true;
      trackEvent('$pageview');
    }
  });
}
export function trackEvent(event: string, properties: Record<string,unknown>={}) {
  if(!permitted() || !permittedProperties(event,properties)) return;
  try {
    const scope=liveScope();
    if(!scope) return;
    const controller=new AbortController();requests.add(controller);
    const timer=setTimeout(()=>controller.abort(),8000);
    void fetch('/api/analytics/events',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({action:'capture',owner:scope.owner,consent:scope.consent,secret:scope.secret,event:{version:1,id:crypto.randomUUID(),event,timestamp:new Date().toISOString(),properties}})
    }).catch(()=>undefined).finally(()=>{clearTimeout(timer);requests.delete(controller);});
  } catch { /* Optional telemetry never interrupts an action. */ }
}
export function identifyAnalyticsUser(userId: string, _properties: Record<string,unknown>={}) {
  // Ignore all person properties, including legacy email arguments.
  if(owner!==userId) requests.forEach(r=>r.abort());
  if(owner!==userId) credentialEpoch++;
  owner=userId;credentialBlocked=false;void prepareCredential();
}
export function resetAnalyticsUser() { requests.forEach(r=>r.abort()); owner=null;credentialEpoch++;credentialBlocked=false; }
export function withdrawAnalyticsConsent() {
  if(typeof window==='undefined') return;
  withdrawn = true;
  credentialEpoch++;credentialBlocked=true;
  pageviewCaptured = false;
requests.forEach(request => request.abort());

for (const scope of [...read(revokedKey), ...read(scopeKey)]) {
  if (scope && typeof scope.consent === 'string') {
    pendingRevocations.set(scope.consent, scope);
  }
}

try {
  window.localStorage.setItem(ANALYTICS_CONSENT_KEY, 'denied');
} catch {
  // In-memory capture remains disabled.
}

try {
  window.localStorage.setItem(
    revokedKey,
    JSON.stringify([...pendingRevocations.values()]),
  );
  window.localStorage.removeItem(scopeKey);
} catch {
  // In-memory capabilities can still be sent for revocation.
}

void revokePending();
  window.dataLayer=window.dataLayer??[];
  window.dataLayer.push({event:'analytics_consent_withdrawn',analytics_storage:'denied',ad_storage:'denied'});
  // Remove cookies from the previous analytics implementation as well.
  for(const cookie of document.cookie.split(';')) {
    const name=cookie.split('=')[0]?.trim();
    if(name && ['_ga','_gid','_gat','_gcl_','_dc_gtm_','AMP_TOKEN','ph_'].some(p=>name.startsWith(p))) {
      for(const domain of ['',window.location.hostname,'.dadhealth.co.uk']) document.cookie=`${name}=; Max-Age=0; path=/; SameSite=Lax${domain?`; domain=${domain}`:''}`;
    }
  }
  void revokePending();
}
declare global { interface Window { dataLayer?: Array<Record<string,unknown>>; } }

/** Snapshot consent for a direct authenticated persistence request. No network,
 * no arbitrary account-wide background consent, and no private properties. */

export const analyticsPersistenceFetch: typeof fetch = (input, init) => {
  let options = init;

  try {
    const request = typeof input === 'object' && 'headers' in input
      ? input
      : undefined;

    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

    if (
      configured &&
      url.origin === new URL(configured).origin &&
      url.pathname.startsWith('/rest/v1/') &&
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)
    ) {
      const headers = new Headers(request?.headers);

      new Headers(init?.headers).forEach((value, name) => {
        headers.set(name, value);
      });

      if (!headers.has('x-dadhealth-analytics')) {
        let scope: Scope | undefined;

        try {
          if (owner && permitted()) {
            scope = liveScope();
          }
        } catch {
          scope = undefined;
        }

        headers.set(
          'x-dadhealth-analytics',
          scope ? JSON.stringify(scope) : 'none',
        );
      }

      options = { ...init, headers };
    }
  } catch {
    // Optional instrumentation must not prevent the original request.
  }

  return fetch(input, options);
};
