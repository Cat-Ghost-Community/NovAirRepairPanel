import {HttpError} from './http-error';

export function requireReceptionCustomerName(customer:{first_name?:unknown;last_name?:unknown}){
 if(customer.first_name!=null&&typeof customer.first_name!=='string')throw new HttpError(400,'نام مشتری باید متن باشد.');
 if(typeof customer.last_name!=='string'||!customer.last_name.trim())throw new HttpError(400,'نام خانوادگی مشتری برای پذیرش الزامی است؛ اطلاعات مشتری را تکمیل کنید.');
}
