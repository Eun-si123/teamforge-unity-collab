// Shared private-LAN preview protocol and exact source-E2E evidence contract.
// Does not alter or claim the packaged TeamForge application protocol.
import { isIP } from "node:net";
import { timingSafeEqual } from "node:crypto";

export const VERSION=1;
export const MODES=Object.freeze({
  authority:Object.freeze({
    unityTest:"EunSung.TeamForge.Tests.TeamForgeRealServerE2ETests.RealServer_RealObjectLockHandoffAndTransformAuthorityRoundTrip",
    peerScript:"ci-presence-peer.mjs",
    required:Object.freeze(["peer-ready.json","peer-saw-unity.json","peer-target.json",
      "peer-saw-unity-transform-before-takeover.json","peer-applied-transform.json",
      "peer-saw-unity-transform-after-takeover.json"]),
  }),
  contention:Object.freeze({
    unityTest:"EunSung.TeamForge.Tests.TeamForgeLockContentionE2ETests.RemoteLock_BlocksTransformAndHierarchyThrash_ThenRecoversCleanly",
    peerScript:"ci-lock-contention-peer.mjs",
    required:Object.freeze(["peer-ready.json","peer-target.json","peer-authoritative-transform.json",
      "peer-release.json","peer-saw-unity-recovery-transform.json"]),
  }),
});
export const MAX_MESSAGE=4096;

export function error(code){return Object.assign(new Error(code),{code});}
export function equalSecret(provided,expected){
  if(typeof provided!=="string"||typeof expected!=="string")return false;
  const a=Buffer.from(provided),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export function parsePairing(value){
  if(typeof value!=="string")throw error("invalid_pairing");
  const match=/^([0-9.]+):([0-9]{1,5}):([A-Za-z0-9_-]{43})$/u.exec(value.trim());
  if(!match||isIP(match[1])!==4||match[1].startsWith("127.")||match[1]==="0.0.0.0")
    throw error("invalid_pairing");
  const port=Number(match[2]);
  if(port<1||port>65535)throw error("invalid_pairing");
  return {address:match[1],port,token:match[3]};
}
export function validateMessage(raw){
  if(typeof raw!=="string"||Buffer.byteLength(raw)>MAX_MESSAGE)throw error("invalid_message");
  let parsed;
  try{parsed=JSON.parse(raw);}catch{throw error("invalid_message");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
    typeof parsed.type!=="string"||parsed.type.length>24)throw error("invalid_message");
  return parsed;
}
export function evidenceComplete(mode,files){
  if(!Object.hasOwn(MODES,mode)||!Array.isArray(files)||files.length>20)return false;
  const seen=new Set(files);
  if(seen.size!==files.length||files.some(f=>typeof f!=="string"||!/^[a-z0-9-]+\.json$/u.test(f)))return false;
  if(seen.has("unexpected-unity-transform-during-peer-lock.json"))return false;
  return MODES[mode].required.every(f=>seen.has(f));
}
export function readNunit(xml){
  if(typeof xml!=="string"||xml.length>5_000_000)throw error("invalid_unity_result");
  const match=/<test-run\b([^>]*)>/u.exec(xml);
  if(!match)throw error("unity_results_missing");
  const attrs=Object.fromEntries([...match[1].matchAll(/([a-zA-Z]+)="([^"]*)"/gu)].map(x=>[x[1],x[2]]));
  const counts=["total","passed","failed","skipped","inconclusive"].map(k=>Number(attrs[k]));
  if(attrs.result!=="Passed"||counts.some(c=>!Number.isInteger(c))||
     counts[0]!==1||counts[1]!==1||counts[2]!==0||counts[3]!==0||counts[4]!==0)
    throw error("unity_assertions_failed");
  return {passed:1,failed:0};
}
export function activeIpv4(interfaces){
  const found=Object.values(interfaces).flat().filter(Boolean)
    .filter(n=>n.family==="IPv4"&&!n.internal&&isIP(n.address)===4)
    .map(n=>n.address);
  return [...new Set(found)];
}
