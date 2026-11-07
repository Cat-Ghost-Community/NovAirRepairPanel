import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { financialCases } from "../src/lib/financial-cases";
const filename=process.argv[2];
if(!filename||filename.startsWith("--")) throw new Error("Usage: node --import tsx scripts/financial-cases.ts <database-path>");
const db=new DatabaseSync(path.resolve(filename),{readOnly:true});
try {db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");console.log(JSON.stringify({inspectionOnly:true,...financialCases(db)},null,2));} finally {db.close();}
