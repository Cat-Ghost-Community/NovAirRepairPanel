import {HttpError} from './http-error';

export function requireReceptionCustomerName(customer:{first_name?:unknown;last_name?:unknown}){
 if(typeof customer.first_name!=='string'||!customer.first_name.trim())throw new HttpError(400,'نام مشتری برای پذیرش الزامی است.');
 if(typeof customer.last_name!=='string'||!customer.last_name.trim())throw new HttpError(400,'نام خانوادگی مشتری برای پذیرش الزامی است؛ اطلاعات مشتری را تکمیل کنید.');
}
