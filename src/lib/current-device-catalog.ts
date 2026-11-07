import {cache} from 'react';
import {postgresIntegration} from './db/pg-integration-config';
import {readyApplicationPostgres} from './db/pg-application';
import {readPostgresDeviceCatalog} from './db/pg-device-catalog';
import {getDb} from './db/schema';
import {readDeviceCatalog} from './device-catalog-store';
/** Request-local metadata reuse for protected server-rendered views. */
export const currentDeviceCatalog=cache(async()=>{if(postgresIntegration()){const {database,schema}=await readyApplicationPostgres();return readPostgresDeviceCatalog(database,schema);}return readDeviceCatalog(getDb());});
