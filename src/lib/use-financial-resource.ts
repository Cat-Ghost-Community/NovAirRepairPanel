"use client";
import {useEffect,useState} from 'react';
/** Debounced, abort-safe financial reads. Old identities never render new data. */
export function useFinancialResource<T>(url:string,refresh:number){
 const key=url+':'+refresh,[state,setState]=useState<{key:string;data?:T;error?:string}>({key:''});
 useEffect(()=>{if(!url)return;const controller=new AbortController(),timer=setTimeout(()=>{void(async()=>{try{const response=await fetch(url,{signal:controller.signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'اطلاعات دریافت نشد.');if(!controller.signal.aborted)setState({key,data});}catch(e){if(!controller.signal.aborted)setState({key,error:e instanceof Error?e.message:'اطلاعات دریافت نشد.'});}})();},180);return()=>{clearTimeout(timer);controller.abort();};},[url,key]);
 return {data:state.key===key?state.data:undefined,error:state.key===key?state.error:undefined,loading:!!url&&state.key!==key};
}
