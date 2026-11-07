const bounds=[5,20,50,100,250,1000,5000,Infinity],histogram=Array(bounds.length).fill(0) as number[];
let committed=0,rolledBack=0,maxMs=0,totalMs=0,contentionFailures=0;
export function recordWriteTransaction(ms:number,success:boolean,contended=false){if(success)committed++;else rolledBack++;if(contended)contentionFailures++;totalMs+=ms;maxMs=Math.max(maxMs,ms);histogram[bounds.findIndex(bound=>ms<=bound)]++;}
/** Process-local aggregate only: no query text, customer data or unbounded samples. */
export function databaseTransactionMetrics(){return {scope:'current_process_since_start',committed,rolledBack,contentionFailures,meanMs:committed+rolledBack?totalMs/(committed+rolledBack):0,maxMs,
 buckets:bounds.map((upperMs,index)=>({upperMs:Number.isFinite(upperMs)?upperMs:null,count:histogram[index]}))};}
