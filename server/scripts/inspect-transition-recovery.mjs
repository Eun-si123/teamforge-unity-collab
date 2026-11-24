#!/usr/bin/env node
// OFFLINE, local, strictly read-only SQLite snapshot + signed managed source
// inspection. Does not contact any Coordinator/Editor/peer or change a
// publication, Active revision, saved Session or transition journal.
import path from "node:path";
import {openDurableSessionStore} from "../src/durable-session-store.mjs";
import {inspectPendingProjectTransitions} from "../src/project-transition-recovery.mjs";

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || args.some(arg=>typeof arg!=="string" || !arg || !path.isAbsolute(arg))) {
    process.stderr.write("Usage: node server/scripts/inspect-transition-recovery.mjs <absolute-durable-db-path> <absolute-managed-project-root>\n");
    process.exitCode=2;
    return;
  }
  const [filePath,managedRoot]=args;
  let store;
  try {
    store=openDurableSessionStore({filePath,readOnly:true});
    const reports=await inspectPendingProjectTransitions({store,managedRoot});
    store.close();
    store=null;
    process.stdout.write(JSON.stringify({
      schemaVersion:1,mode:"offline_read_only_snapshot",pendingTransitionCount:reports.length,
      editorResumePermitted:false,automaticRepairPermitted:false,reports,
    },null,2)+"\n");
  } catch(error) {
    // Avoid leaking absolute managed paths, credentials or local SQLite error
    // strings when this diagnostic is pasted into a support issue.
    const code=typeof error?.code==="string" && /^[A-Z_]+$/u.test(error.code)
      ? error.code : "INSPECTION_UNAVAILABLE";
    process.stderr.write(`Transition inspection could not open a consistent verified read-only snapshot (${code}). No repair was attempted.\n`);
    process.exitCode=1;
  } finally {
    try {store?.close();}
    catch {
      process.stderr.write("The read-only diagnostic snapshot could not be closed safely.\n");
      process.exitCode=1;
    }
  }
}
await main();
