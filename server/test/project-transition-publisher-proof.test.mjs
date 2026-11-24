import assert from "node:assert/strict";
import test from "node:test";
import {createDescriptor} from "../../project-peer/src/descriptor.mjs";
import {generateIdentity,signText} from "../../project-peer/src/identity.mjs";
import {ProjectTransitionQuiescence} from "../src/project-transition-quiescence.mjs";
import {ProjectTransitionPublisherProof} from "../src/project-transition-publisher-proof.mjs";

const projectId="fresh-proof-project";
const projectUuid="ae168a9b-854a-487d-9d38-9213953be8fa";
const manifestHash1="a".repeat(64),manifestHash2="b".repeat(64);

function fixture({delegated=false}={}) {
  const owner=generateIdentity("Test Owner");
  const publisher=delegated?generateIdentity("Test Publisher"):owner;
  const old=createDescriptor({projectId,projectUuid,baselineRevision:1,
    manifestHash:manifestHash1,unityVersion:"6000.3.21f1",ownerIdentity:owner});
  const candidate=createDescriptor({projectId,projectUuid,baselineRevision:2,
    manifestHash:manifestHash2,unityVersion:"6000.3.21f1",
    ownerIdentity:owner,publisherIdentity:publisher});
  const quiescence=new ProjectTransitionQuiescence();
  const frozen=quiescence.beginOfflineFreeze({projectId,connectedClientCount:0,
    sessionMemberCount:0,activeLockCount:0,approvedBaseline:old});
  assert.ok(frozen.ticket);
  const proofs=new ProjectTransitionPublisherProof(quiescence);
  return {owner,publisher,old,candidate,quiescence,ticket:frozen.ticket,proofs};
}

test("fresh Publisher possession proof is domain-separated, one-time and binds the actual signed M5 source",()=>{
  const f=fixture();
  const issued=f.proofs.issue({ticket:f.ticket,candidate:f.candidate,nowUnixMs:1_000_000});
  assert.match(issued.challengeId,/^[a-f0-9-]{36}$/u);
  assert.match(issued.payload,/teamforge-m4m5-publisher-possession-v1/u);
  assert.ok(issued.payload.includes(f.old.descriptorHash));
  assert.ok(issued.payload.includes(f.candidate.descriptorHash));
  assert.equal(issued.payload.includes(f.owner.privateKey),false);
  assert.deepEqual(f.proofs.issue({ticket:f.ticket,candidate:f.candidate,nowUnixMs:1_000_001}),
    {error:"project_transition_challenge_pending"});
  const signature=signText(f.publisher,issued.payload);
  const verified=f.proofs.consume({ticket:f.ticket,challengeId:issued.challengeId,
    signature,nowUnixMs:1_000_002});
  assert.equal(verified.verified,true);
  assert.equal(verified.candidateDescriptorHash,f.candidate.descriptorHash);
  assert.equal(verified.projectId,projectId);
  assert.equal(Object.hasOwn(verified,"commitPermitted"),false);
  assert.equal(f.proofs.matchesReceipt({ticket:f.ticket,receipt:verified,
    candidateDescriptorHash:f.candidate.descriptorHash,nowUnixMs:1_000_003}),true);
  assert.equal(f.proofs.matchesReceipt({ticket:f.ticket,receipt:{...verified},
    candidateDescriptorHash:f.candidate.descriptorHash,nowUnixMs:1_000_003}),false,
    "A copied result cannot authorize a later checkpoint transaction.");
  assert.equal(f.proofs.matchesReceipt({ticket:f.ticket,receipt:verified,
    candidateDescriptorHash:f.candidate.descriptorHash,nowUnixMs:1_100_000}),false);
  assert.deepEqual(f.proofs.issue({ticket:f.ticket,candidate:f.candidate,nowUnixMs:1_000_005}),
    {error:"project_transition_proof_already_verified"});
  assert.deepEqual(f.proofs.consume({ticket:f.ticket,challengeId:issued.challengeId,
    signature,nowUnixMs:1_000_003}),{error:"project_transition_challenge_missing"},
  "The same signature and challenge cannot be replayed.");
});

test("delegated Publisher proves its own Ed25519 private key; Owner key alone does not authorize that Publisher",()=>{
  const f=fixture({delegated:true});
  const first=f.proofs.issue({ticket:f.ticket,candidate:f.candidate,nowUnixMs:500_000});
  assert.equal(typeof first.payload,"string");
  const wrong=signText(f.owner,first.payload);
  assert.deepEqual(f.proofs.consume({ticket:f.ticket,challengeId:first.challengeId,
    signature:wrong,nowUnixMs:500_001}),{error:"project_transition_publisher_proof_invalid"});
  assert.deepEqual(f.proofs.consume({ticket:f.ticket,challengeId:first.challengeId,
    signature:signText(f.publisher,first.payload),nowUnixMs:500_002}),
    {error:"project_transition_challenge_missing"},
    "A wrong attempt consumes the entire challenge, preventing signature guessing.");
  const second=f.proofs.issue({ticket:f.ticket,candidate:f.candidate,nowUnixMs:500_003});
  assert.notEqual(first.challengeId,second.challengeId);
  assert.notEqual(first.payload,second.payload);
  assert.equal(f.proofs.consume({ticket:f.ticket,challengeId:second.challengeId,
    signature:signText(f.publisher,second.payload),nowUnixMs:500_004}).verified,true);
});

test("stale, malformed, revoked and cross-Project Publisher proofs fail closed",()=>{
  const f=fixture();
  const otherOwner=generateIdentity("Foreign Owner");
  const outsider=createDescriptor({projectId,projectUuid,baselineRevision:2,
    manifestHash:manifestHash2,unityVersion:"6000.3.21f1",ownerIdentity:otherOwner});
  const wrongRevision=createDescriptor({projectId,projectUuid,baselineRevision:3,
    manifestHash:manifestHash2,unityVersion:"6000.3.21f1",ownerIdentity:f.owner});
  for (const candidate of [outsider,wrongRevision,{...f.candidate,manifestHash:manifestHash1},
      {...f.candidate,baselineSignature:"AAAA"}, {...f.candidate,projectUuid:"different"}]) {
    assert.deepEqual(f.proofs.issue({ticket:f.ticket,candidate}),
      {error:"project_transition_candidate_invalid"});
  }
  const expiry=f.proofs.issue({ticket:f.ticket,candidate:f.candidate,nowUnixMs:70_000});
  const expired=f.proofs.consume({ticket:f.ticket,challengeId:expiry.challengeId,
    signature:signText(f.publisher,expiry.payload),nowUnixMs:100_001});
  assert.deepEqual(expired,{error:"project_transition_publisher_proof_invalid"});
  const retry=f.proofs.issue({ticket:f.ticket,candidate:f.candidate,nowUnixMs:100_002});
  assert.deepEqual(f.proofs.consume({ticket:{...f.ticket},challengeId:retry.challengeId,
    signature:signText(f.publisher,retry.payload),nowUnixMs:100_003}),
    {error:"project_transition_challenge_missing"});
  assert.equal(f.quiescence.release(f.ticket),true);
  assert.deepEqual(f.proofs.consume({ticket:f.ticket,challengeId:retry.challengeId,
    signature:signText(f.publisher,retry.payload),nowUnixMs:100_004}),
    {error:"project_transition_challenge_missing"});
  assert.equal(f.proofs.revoke(f.ticket),true,
    "Aborting a signed Project freeze revokes any pending challenge.");
});


test("Publisher challenge nonce expires, a replacement nonce is new and old signatures cannot sign it",()=>{
  const f=fixture();
  const first=f.proofs.issue({ticket:f.ticket,candidate:f.candidate,nowUnixMs:10_000});
  const second=f.proofs.issue({ticket:f.ticket,candidate:f.candidate,nowUnixMs:40_001});
  assert.ok(second.challengeId && first.challengeId!==second.challengeId);
  assert.notEqual(first.payload,second.payload);
  assert.deepEqual(f.proofs.consume({ticket:f.ticket,challengeId:second.challengeId,
    signature:signText(f.publisher,first.payload),nowUnixMs:40_002}),
    {error:"project_transition_publisher_proof_invalid"});
});
