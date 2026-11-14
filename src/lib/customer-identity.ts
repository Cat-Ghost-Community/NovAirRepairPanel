import {HttpError} from './http-error';

export const CUSTOMER_TITLES={mr:'آقا',ms:'خانم'} as const;
export function customerSalutation(value:unknown):keyof typeof CUSTOMER_TITLES|null{
 if(value==null||value==='')return null;
 if(value!=='mr'&&value!=='ms')throw new HttpError(400,'عنوان مشتری معتبر نیست.');
 return value;
}
export function customerDisplayName(customer:{salutation?:unknown;first_name?:unknown;last_name?:unknown;company?:unknown}){
 const title=customer.salutation==='mr'||customer.salutation==='ms'?CUSTOMER_TITLES[customer.salutation]:'';
 return [title,customer.first_name,customer.last_name].filter((value):value is string=>typeof value==='string').map(value=>value.trim()).filter(Boolean).join(' ')||String(customer.company??'');
}
