import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {session} from './field-realtime-two-pc.mjs';

test('SSH guest readiness timeout kills the child and rejects both waiters',
  {skip:process.platform==='win32'?'POSIX fake ssh fixture':false},async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tf-ssh-timeout-'));
    const originalPath=process.env.PATH;
    try{
      const ssh=path.join(dir,'ssh');
      fs.writeFileSync(ssh,'#!/bin/sh\nexec sleep 60\n',{mode:0o700});
      process.env.PATH=dir+path.delimiter+originalPath;
      const guest=session({ssh:'test@localhost',script:'unused'},'authority',
        {head:'a'.repeat(40),hostName:'host'},60);
      const result=await Promise.allSettled([guest.ready,guest.finish()]);
      assert.deepEqual(result.map(v=>v.status),['rejected','rejected']);
      assert.equal(result[0].reason.code,'guest_ready_timeout');
      assert.equal(result[1].reason.code,'guest_ready_timeout');
      if(guest.child.exitCode===null&&guest.child.signalCode===null)
        await once(guest.child,'close');
      assert.equal(guest.child.signalCode,'SIGTERM');
    }finally{
      process.env.PATH=originalPath;
      fs.rmSync(dir,{recursive:true,force:true});
    }
  });
