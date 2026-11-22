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

test('SSH guest rejects duplicate machine identity frames before readiness',
  {skip:process.platform==='win32'?'POSIX fake ssh fixture':false},async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tf-ssh-duplicate-'));
    const originalPath=process.env.PATH;
    try{
      const machine=JSON.stringify({name:'guest-pc',head:'a'.repeat(40),mode:'authority'});
      fs.writeFileSync(path.join(dir,'ssh'),
        '#!/bin/sh\nprintf "%s\\n" '+JSON.stringify('TF_FIELD_MACHINE '+machine)+' '+JSON.stringify('TF_FIELD_MACHINE '+machine)+'\n',
        {mode:0o700});
      process.env.PATH=dir+path.delimiter+originalPath;
      const guest=session({ssh:'test@localhost',script:'unused'},'authority',
        {head:'a'.repeat(40),hostName:'host'},1000);
      const result=await Promise.allSettled([guest.ready,guest.finish()]);
      assert.deepEqual(result.map(v=>v.status),['rejected','rejected']);
      assert.equal(result[0].reason.code,'duplicate_guest_machine');
      assert.equal(result[1].reason.code,'duplicate_guest_machine');
    }finally{
      process.env.PATH=originalPath;
      fs.rmSync(dir,{recursive:true,force:true});
    }
  });

test('SSH guest rejects duplicate final evidence frames',
  {skip:process.platform==='win32'?'POSIX fake ssh fixture':false},async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tf-ssh-final-'));
    const originalPath=process.env.PATH;
    try{
      const machine=JSON.stringify({name:'guest-pc',head:'a'.repeat(40),mode:'authority'});
      const final=JSON.stringify({complete:true,evidenceFiles:[]});
      const lines=['TF_FIELD_MACHINE '+machine,'TF_FIELD_EVENT peer-ready.json',
        'TF_FIELD_FINAL '+final,'TF_FIELD_FINAL '+final];
      fs.writeFileSync(path.join(dir,'ssh'),
        '#!/bin/sh\nprintf "%s\\n" '+lines.map(JSON.stringify).join(' ')+'\n',
        {mode:0o700});
      process.env.PATH=dir+path.delimiter+originalPath;
      const guest=session({ssh:'test@localhost',script:'unused'},'authority',
        {head:'a'.repeat(40),hostName:'host'},1000);
      const result=await Promise.allSettled([guest.ready,guest.finish()]);
      assert.equal(result[1].status,'rejected');
      assert.equal(result[1].reason.code,'duplicate_guest_final');
    }finally{
      process.env.PATH=originalPath;
      fs.rmSync(dir,{recursive:true,force:true});
    }
  });
