/** Leading PostgreSQL command only; SQL strings/function bodies are deliberately not rewritten.
 * PostgreSQL accepts nested comments and empty statements before a real command. */
function leadingCommand(sql:string){
 let offset=0;
 while(offset<sql.length){
  if(/\s/.test(sql[offset])||sql[offset]===';'){offset++;continue;}
  if(sql.startsWith('--',offset)){offset+=2;while(offset<sql.length&&!['\r','\n'].includes(sql[offset]))offset++;continue;}
  if(sql.startsWith('/*',offset)){let depth=1;offset+=2;while(offset<sql.length&&depth){if(sql.startsWith('/*',offset)){depth++;offset+=2;}else if(sql.startsWith('*/',offset)){depth--;offset+=2;}else offset++;}if(depth)throw new Error('Unterminated PostgreSQL SQL comment');continue;}
  break;
 }
 return /^[A-Za-z_]+/.exec(sql.slice(offset))?.[0].toUpperCase()??'';
}
export function assertPostgresStatement(sql:string){
 for(const statement of postgresStatements(sql)){
  const command=leadingCommand(statement);
  if(['BEGIN','START','COMMIT','ROLLBACK','ABORT','SAVEPOINT','RELEASE','END','PREPARE','SET','RESET','DISCARD'].includes(command))throw new Error('Use the PostgreSQL transaction boundary and connection options instead of manual transaction or session SQL');
 }
}

/** Lexical boundaries only, not an untrusted-SQL sandbox. Preserve SQL bytes;
 * semicolons inside strings, identifiers, nested comments or dollar-quoted
 * procedure bodies are not statement separators. Validate every batch command.
 */
function postgresStatements(sql:string):string[]{
 const result:string[]=[];let start=0,index=0;
 while(index<sql.length){
  if(sql.startsWith('--',index)){index+=2;while(index<sql.length&&!['\r','\n'].includes(sql[index]))index++;continue;}
  if(sql.startsWith('/*',index)){
   let depth=1;index+=2;
   while(index<sql.length&&depth){if(sql.startsWith('/*',index)){depth++;index+=2;}else if(sql.startsWith('*/',index)){depth--;index+=2;}else index++;}
   if(depth)throw new Error('Unterminated PostgreSQL SQL comment');continue;
  }
  if(sql[index]==="'"||sql[index]==='"'){
   const quote=sql[index],escaped=quote==="'"&&index>0&&/[eE]/.test(sql[index-1])&&(index<2||!/[\w$\u0080-\uffff]/.test(sql[index-2]));
   index++;let closed=false;
   while(index<sql.length){
    if(escaped&&sql[index]==='\\'){index+=2;continue;}
    if(sql[index]===quote){if(sql[index+1]===quote){index+=2;continue;}index++;closed=true;break;}
    index++;
   }
   if(!closed)throw new Error('Unterminated PostgreSQL SQL quote');continue;
  }
  if(sql[index]==='$'&&(index===0||!/[\w$\u0080-\uffff]/.test(sql[index-1]))){
   const marker=/^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z_0-9\u0080-\uffff]*)?\$/.exec(sql.slice(index))?.[0];
   if(marker){const end=sql.indexOf(marker,index+marker.length);if(end<0)throw new Error('Unterminated PostgreSQL dollar quote');index=end+marker.length;continue;}
  }
  if(sql[index]===';'){result.push(sql.slice(start,index));start=index+1;}
  index++;
 }
 result.push(sql.slice(start));return result;
}
