export type BoardView = "overview" | "board" | "list";
export function boardHref(query:Record<string,string|undefined>,changes:Record<string,string|null>,resetPage=true){
 const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value)params.set(key,value);
 for(const [key,value] of Object.entries(changes)){if(value===null||value==='')params.delete(key);else params.set(key,value);}
 if(resetPage)params.delete('page');
 return `/repairs/board${params.size?'?'+params.toString():''}`;
}
