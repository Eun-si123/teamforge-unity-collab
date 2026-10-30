import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { readGuestFrame } from "./field-realtime-guest.mjs";

function frameFromChunks(chunks, end=false){
  const input=new PassThrough();
  const result=readGuestFrame(input);
  for(const chunk of chunks)input.write(chunk);
  if(end)input.end();
  return result;
}

test("guest control frame accepts a bounded JSON line across chunks and CRLF",async()=>{
  assert.deepEqual(await frameFromChunks(['{"mode":"auth','ority"}\r','\n']),{mode:"authority"});
  const exactly4096=JSON.stringify({padding:"x".repeat(4096-'{"padding":""}'.length)});
  assert.equal(Buffer.byteLength(exactly4096),4096);
  assert.equal((await frameFromChunks([exactly4096+'\n'])).padding.length,4082);
});

test("guest rejects oversized unterminated input before EOF or newline",async()=>{
  await assert.rejects(frameFromChunks([Buffer.alloc(4096,0x41),Buffer.alloc(1,0x42)]),{code:"field_frame_too_large"});
  await assert.rejects(frameFromChunks([Buffer.alloc(5000,0x41)]),{code:"field_frame_too_large"});
});

test("guest rejects malformed, missing and bundled control frames",async()=>{
  await assert.rejects(frameFromChunks(['{broken}\n']),{code:"invalid_field_frame"});
  await assert.rejects(frameFromChunks([],true),{code:"field_frame_missing"});
  await assert.rejects(frameFromChunks(['{}\n{}\n']),{code:"multiple_guest_frames"});
});

// A field Host keeps the SSH stdin pipe open while waiting for the Guest.
// Rejecting a bad frame must also close that pipe so the Guest process exits.
test("oversized frame exits while SSH stdin is still open",async()=>{
  const moduleUrl=new URL("./field-realtime-guest.mjs",import.meta.url).href;
  const script=`import {readGuestFrame} from ${JSON.stringify(moduleUrl)};`
    +`readGuestFrame(process.stdin).catch(e=>{console.log(e.code);process.exitCode=1;});`;
  const child=spawn(process.execPath,["--input-type=module","-e",script],
    {stdio:["pipe","pipe","pipe"]});
  let output="";
  child.stdout.on("data",chunk=>{output+=chunk.toString();});
  const exited=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error("guest_stdin_not_closed"));},2500);
    child.once("error",error=>{clearTimeout(timer);reject(error);});
    child.once("exit",code=>{clearTimeout(timer);resolve(code);});
  });
  child.stdin.write(Buffer.alloc(4097,0x41)); // Deliberately do not end stdin.
  assert.equal(await exited,1);
  assert.match(output,/field_frame_too_large/u);
});
