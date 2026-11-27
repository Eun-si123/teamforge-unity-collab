#!/usr/bin/env node
// Verified local worker, stdin only. Never return key material or raw errors.
import {signGuestParticipantProof} from "./guest-participant-identity.mjs";
import path from "node:path";
import {fileURLToPath} from "node:url";
try{
  const chunks=[];let length=0;
  for await(const chunk of process.stdin){
    length+=chunk.length;if(length>32768) throw Error();
    chunks.push(chunk);
  }
  const input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
  if(Object.keys(input).sort().join(",")!=="challenge,context,local") throw Error();
  const proof=await signGuestParticipantProof({...input,forbiddenRoots:[path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..")]});
  process.stdout.write(JSON.stringify(proof)+"\n");
}catch{
  process.stderr.write("Participant proof unavailable. No key was replaced.\n");
  process.exitCode=1;
}
