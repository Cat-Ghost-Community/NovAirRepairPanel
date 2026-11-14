import type {Session} from './auth';
import {effectivePermissions} from './auth';
import {hasPerm} from './perms-shared';
import {HttpError} from './http-error';

export function canManagePayroll(session:Session){
 const permissions=effectivePermissions(session.user.role,session.user.id);
 if(['!*','!payroll.*','!payroll.manage'].some(permission=>permissions.includes(permission)))return false;
 return hasPerm(permissions,'payroll.manage')||(hasPerm(permissions,'team.manage')&&hasPerm(permissions,'finance.manage'));
}
export function requirePayrollManager(session:Session){
 if(!canManagePayroll(session))throw new HttpError(403,'مجوز مدیریت دستمزد را ندارید.');
}
