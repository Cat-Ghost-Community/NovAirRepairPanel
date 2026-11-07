import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionByToken, canUser } from "./auth";
import { pagePermission } from "./page-permissions";
import { activeBranch } from "./branch";
import {postgresIntegration} from './db/pg-integration-config';
import {postgresShellState} from './db/pg-shell';
import {hasPerm} from './perms-shared';

/** Called by each page on every navigation: shared layouts can be reused by Next.js. */
export async function requirePageAccess(pathname: string) {
  if(postgresIntegration()){
    const store=await cookies(),state=await postgresShellState(store.get('repaid_session')?.value,store.get('repaid_branch')?.value);
    if(!state.session)redirect('/login');if(!hasPerm(state.permissions,pagePermission(pathname)))notFound();return state.session;
  }
  const session = getSessionByToken((await cookies()).get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (activeBranch(session).branchId === -1) notFound();
  if (!canUser(session, pagePermission(pathname))) notFound();
  return session;
}
