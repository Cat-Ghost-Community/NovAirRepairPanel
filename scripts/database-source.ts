import fs from 'node:fs';

/** Maintenance must never manufacture a replacement for a lost live database.
 * This bounded header/presence check is read-only; full integrity is verified by
 * the existing snapshot and explicit doctor services. */
export function requireDatabaseSource(filename:string){
 const entry=fs.lstatSync(filename,{throwIfNoEntry:false});
 if(!entry?.isFile()||entry.isSymbolicLink()||entry.size<100)throw Error('Existing ordinary SQLite database required; no database will be created');
 const file=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
 try{const opened=fs.fstatSync(file),header=Buffer.alloc(16);if(opened.dev!==entry.dev||opened.ino!==entry.ino||fs.readSync(file,header,0,16,0)!==16||!header.equals(Buffer.from('SQLite format 3\0')))throw Error('Database source changed or has an invalid SQLite header');}
 finally{fs.closeSync(file);}
 return entry;
}
