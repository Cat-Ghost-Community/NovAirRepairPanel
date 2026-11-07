"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/icon";

/** Native semantics, 40px hit target and a visible mixed-selection state. */
export function Checkbox({checked,indeterminate=false,disabled=false,label,onCheckedChange,children,className=""}:{
  checked:boolean;indeterminate?:boolean;disabled?:boolean;label:string;
  onCheckedChange:(checked:boolean,shiftKey:boolean)=>void;children?:React.ReactNode;className?:string;
}){
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(input.current)input.current.indeterminate=indeterminate;},[indeterminate]);
 return <label className={`inline-flex min-h-10 min-w-10 select-none items-center gap-1.5 rounded-lg ${disabled?'cursor-not-allowed opacity-50':'cursor-pointer'} ${className}`}>
  <span className="relative grid h-10 w-10 shrink-0 place-items-center">
   <input ref={input} type="checkbox" checked={checked} disabled={disabled} aria-label={label} aria-checked={indeterminate?'mixed':checked}
    onChange={event=>onCheckedChange(event.target.checked,!!(event.nativeEvent as MouseEvent).shiftKey)}
    className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
   <span aria-hidden className={`pointer-events-none grid h-5 w-5 place-items-center rounded-md border-2 transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-brand-500 ${checked||indeterminate?'border-brand-600 bg-brand-600 text-white':'border-zinc-300 bg-white peer-hover:border-brand-500 dark:border-zinc-600 dark:bg-zinc-900'}`}>
    {(checked||indeterminate)&&<Icon name={indeterminate?'minus':'check'} size={14} strokeWidth={3} />}
   </span>
  </span>{children}
 </label>;
}
