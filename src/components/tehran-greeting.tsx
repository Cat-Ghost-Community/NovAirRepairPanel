'use client';
import {useEffect,useState} from 'react';
import {tehranGreeting} from '@/lib/tehran-greeting';
export function TehranGreeting({serverNow}:{serverNow:number}){
 const [label,setLabel]=useState(()=>tehranGreeting(serverNow));
 useEffect(()=>{const started=performance.now();const update=()=>setLabel(tehranGreeting(serverNow+performance.now()-started));update();const timer=setInterval(update,60000);return()=>clearInterval(timer);},[serverNow]);
 return <span data-testid="tehran-greeting">{label}</span>;
}
