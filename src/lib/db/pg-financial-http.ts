import type {NextRequest} from 'next/server';
import {HttpError} from '../http-error';
import {isSameOriginMutation} from '../request-security';
import {readyApplicationPostgres} from './pg-application';
import {loadPostgresIdentity,requirePostgresIdentity} from './pg-app-auth';
import {postgresCookieBranch} from './pg-branch';
import {requestedPostgresBranch} from './pg-customers';
import {authorizePostgresScope} from './postgres-auth';

/** Request boundary only. Commands reauthorize under their transaction locks. */
export async function postgresFinancialRequest(req:NextRequest,permission:string|undefined){
 if(!isSameOriginMutation(req))throw new HttpError(403,'درخواست از منبع غیرمجاز رد شد.');
 const {database,schema}=await readyApplicationPostgres(),token=req.cookies.get('repaid_session')?.value;
 const identity=await loadPostgresIdentity(database,schema,token);if(!identity||!token)throw new HttpError(401,'نشست معتبر نیست.');
 const explicit=req.nextUrl.searchParams.get('branch_id');
 const branchId=explicit!=null?requestedPostgresBranch(explicit):await postgresCookieBranch(database,schema,identity.session,req.cookies.get('repaid_branch')?.value);
 const scope=permission?await authorizePostgresScope(database,schema,token,permission,branchId):await requirePostgresIdentity(database,schema,token,undefined,branchId);
 return {database,schema,token,branchId:scope.branchId,scope,permissions:identity.permissions};
}
