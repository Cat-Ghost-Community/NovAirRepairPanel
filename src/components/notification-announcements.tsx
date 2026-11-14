'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {useToast} from './ui';

type Notice={id:number;title:string|null;body:string|null;link:string|null};
export function NotificationAnnouncements({userId,branch}:{userId:number;branch:number|null}){
 const toast=useToast(),router=useRouter();
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined,inFlight=false;const controller=new AbortController();
  async function poll(){
   if(!alive||inFlight)return;
   let browserEnabled=false;try{browserEnabled=localStorage.getItem('chat_browser_notify')==='1';}catch{/* In-app delivery remains available without browser storage. */}
   if(document.hidden&&!(browserEnabled&&'Notification' in window&&Notification.permission==='granted')){timer=setTimeout(()=>void poll(),15000);return;}
   inFlight=true;
   try{
    const response=await fetch('/api/notifications/deliveries',{method:'POST',signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw Error('Notification delivery unavailable');
    const data=await response.json() as {notifications:Notice[]};if(!alive)return;
    const notices=data.notifications.filter(notice=>!(notice.link?.startsWith('/chat?c=')&&!document.hidden&&location.pathname==='/chat'&&new URLSearchParams(location.search).get('c')===new URL(notice.link,location.origin).searchParams.get('c')));
    if(notices.length){
     const notice=notices[notices.length-1],body=notices.length===1?[notice.title,notice.body].filter(Boolean).join(': '):`${notices.length} اعلان جدید؛ فهرست اعلان‌ها را بررسی کنید.`;
     if(document.hidden&&browserEnabled&&'Notification' in window&&Notification.permission==='granted'){
      const notification=new Notification(notice.title??'اعلان جدید',{body,tag:'repaid-notice-'+notice.id});
      notification.onclick=()=>{window.focus();if(notice.link?.startsWith('/')&&!notice.link.startsWith('//'))router.push(notice.link);notification.close();};
     }else if(!document.hidden)toast(body,'info');
    }
    if(data.notifications.length)window.dispatchEvent(new Event('repaid:notifications'));
   }catch(cause){if(!controller.signal.aborted)console.warn('Notification announcements unavailable',cause instanceof Error?cause.message:'request failed');}
   finally{inFlight=false;if(alive)timer=setTimeout(()=>void poll(),15000);}
  }
  const wake=()=>{if(timer)clearTimeout(timer);void poll();};
  void poll();window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
  return()=>{alive=false;controller.abort();if(timer)clearTimeout(timer);window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
 },[userId,branch,toast,router]);
 return null;
}
