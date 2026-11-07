/** Existing documents are immutable; these settings format newly issued numbers. */
export function validDocumentAffix(value:string){return /^[\p{L}\p{N}_.-]{0,32}$/u.test(value);}
export function documentNumber(key:string,fallbackPrefix:string,value:number,pad=4,settings:Record<string,string>={}){
 const kind=key==='ticket'?'ticket':key==='invoice'||key.startsWith('invoice:')?'invoice':null;
 const prefix=kind?(settings[kind+'_prefix']??fallbackPrefix):fallbackPrefix;
 const suffix=kind?(settings[kind+'_suffix']??''):'';
 return prefix+String(value).padStart(pad,'0')+suffix;
}
