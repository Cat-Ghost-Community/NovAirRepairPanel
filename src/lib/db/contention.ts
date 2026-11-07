/** Recognize only documented transient database states. Never replay a financial operation here. */
export function databaseContention(error:unknown){
 if(!error||typeof error!=='object')return false;const value=error as {code?:unknown;errcode?:unknown};
 if(value.code==='ERR_SQLITE_ERROR'&&Number.isSafeInteger(value.errcode))return ((value.errcode as number)&255)===5;
 return typeof value.code==='string'&&['40001','40P01','55P03'].includes(value.code);
}
