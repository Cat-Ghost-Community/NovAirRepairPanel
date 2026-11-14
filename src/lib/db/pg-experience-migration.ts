import {postgresRelation} from './postgres-auth';
import {postgresCompanyChatGuardStatement} from './pg-chat-guards';
import {postgresCompanyChatNotificationStatements} from './pg-chat-notifications';

export function postgresExperienceStatements(schema:string){
 const q=(name:string)=>postgresRelation(schema,name);
 return [
  `ALTER TABLE ${q('customers')} ADD COLUMN salutation text CHECK(salutation IN ('mr','ms') OR salutation IS NULL)`,
  `CREATE TABLE ${q('notification_delivery_state')}(user_id bigint PRIMARY KEY REFERENCES ${q('users')}(id),baseline_id bigint NOT NULL CHECK(baseline_id>=0))`,
  `CREATE TABLE ${q('notification_deliveries')}(user_id bigint NOT NULL REFERENCES ${q('users')}(id),notification_id bigint NOT NULL REFERENCES ${q('notifications')}(id),delivered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,notification_id))`,
  postgresCompanyChatGuardStatement(schema),
  ...postgresCompanyChatNotificationStatements(schema),
 ];
}
