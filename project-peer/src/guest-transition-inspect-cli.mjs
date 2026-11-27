#!/usr/bin/env node
// Stop this Guest's Unity Editor, launcher and competing writers first.
import {inspectGuestTransition} from "./guest-transition-inspection.mjs";
const args=process.argv.slice(2);
if(args.length!==7){
  process.stderr.write("Usage: node project-peer/src/guest-transition-inspect-cli.mjs <managed-root> <launcher-state-root> <project-id> <project-uuid> <transition-id> <previous-descriptor-hash> <candidate-descriptor-hash>\n");
  process.exitCode=2;
}else{
  const [managedRoot,stateRoot,projectId,projectUuid,transitionId,previousDescriptorHash,candidateDescriptorHash]=args;
  try{
    const report=await inspectGuestTransition({managedRoot,stateRoot,projectId,projectUuid,
      transitionId,previousDescriptorHash,candidateDescriptorHash});
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
    // This is an inspection result, not successful recovery.
    if(report.status!=="guest_saved_manifest_matches") process.exitCode=1;
  }catch{
    process.stderr.write("Guest transition inspection could not run. No repair was attempted.\n");
    process.exitCode=1;
  }
}
