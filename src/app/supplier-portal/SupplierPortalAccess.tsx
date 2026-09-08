'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PortalAction, PortalSubmission, SupplierPortalView } from '@/lib/supplier-portal/types';
import { SupplierPortalContent } from '@/components/supplier-portal/SupplierPortalContent';
import styles from '@/components/supplier-portal/supplier-portal-public.module.css';

const endpoint = '/api/public/supplier-portal';
async function read(response: Response): Promise<SupplierPortalView> {
 const data = await response.json().catch(()=>null);
 if(!response.ok || !data || typeof data.portalId !== 'string' || !data.portalId || !Array.isArray(data.orders) || !Array.isArray(data.forecasts)) throw new Error(data?.detail ?? 'Unable to open the supplier workspace. Ask the restaurant for a current link.');
 return data;
}
export function SupplierPortalAccess() {
 const [view,setView]=useState<SupplierPortalView|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const feedback = useRef<HTMLParagraphElement>(null);
 useEffect(() => { if(error || notice) feedback.current?.focus(); }, [error, notice]);
 const load=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch(endpoint,{cache:'no-store',credentials:'same-origin',signal});
  if(response.status===410 || response.status===401) setView(null);
  const result=await read(response); setView(result);
 },[]);
 useEffect(()=>{
  // Another private link can navigate only the fragment without remounting React.
  // Restart the page to cancel old requests and exchange the new grant in isolation.
  const openChangedLink=()=>{if(new URLSearchParams(window.location.hash.slice(1)).has('token'))window.location.reload();};
  window.addEventListener('hashchange',openChangedLink);
  const token=new URLSearchParams(window.location.hash.slice(1)).get('token');
  window.history.replaceState(null,'','/supplier-portal');
  const controller=new AbortController();
  void(async()=>{
   if(token){
    const response=await fetch(`${endpoint}/access`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store',credentials:'same-origin',signal:controller.signal});
    if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.detail ?? 'This private link is unavailable. Ask the restaurant for a new link.');}
   }
   await load(controller.signal);
  })().catch(e=>{if(!controller.signal.aborted){setView(null);setError((e as Error).message);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>{window.removeEventListener('hashchange',openChangedLink);controller.abort();};
 },[load]);
 async function refresh(){setBusy(true);setError('');setNotice('');try{await load();setNotice('Latest records loaded.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function submit(action:PortalAction){
  if(!view)return;
  const submission:PortalSubmission={...action,portalId:view.portalId};
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(submission),cache:'no-store',credentials:'same-origin'});
   if(response.status===410 || response.status===401)setView(null);
   if(response.status===409){await load();throw new Error('The record changed. Review the latest details and submit your response again.');}
   setView(await read(response));setNotice('Your response is saved and visible to the restaurant.');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <>
  {loading && <p className={styles.empty} role="status">Opening your orders…</p>}
  {error && <p className={styles.error} ref={feedback} tabIndex={-1} role="alert">{error}</p>}
  {notice && <p className={styles.notice} ref={feedback} tabIndex={-1} role="status">{notice}</p>}
  {view && <><div className={styles.toolbar}><button className={styles.refresh} disabled={busy} onClick={refresh}>{busy?'Please wait…':'Refresh records'}</button></div><SupplierPortalContent view={view} busy={busy} onSubmit={submit}/></>}
  {!loading && !view && <section className={styles.intro}><p className={styles.eyebrow}>Your supplier page</p><h1>Your connection to the restaurant.</h1><p>Open the private link sent by your restaurant to view order status, respond to delivery records and see shared ingredient estimates.</p><p className={styles.help}>No supplier account is required. The restaurant can replace or revoke access at any time.</p></section>}
 </>;
}
