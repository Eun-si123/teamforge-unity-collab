import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig, readNunitResult } from "./field-realtime-two-pc.mjs";
import { validateFieldFrame } from "./field-realtime-guest.mjs";

const head="a".repeat(40);
const config={
  TEAMFORGE_FIELD_GUEST_SSH:"field@guest-pc",
  TEAMFORGE_FIELD_HOST_IPV4:"192.168.1.5",
  TEAMFORGE_FIELD_GUEST_REALTIME_SCRIPT:"C:/TeamForge/scripts/field-realtime-guest.mjs",
  TEAMFORGE_FIELD_UNITY_EDITOR:"C:\\Program Files\\Unity\\Hub\\Editor\\6000.3.21f1\\Editor\\Unity.exe",
};
const ips={lan:[{family:"IPv4",address:"192.168.1.5",internal:false}]};
const frame={version:1,mode:"authority",head,hostName:"host-pc",
  token:"A".repeat(48),endpoint:"ws://192.168.1.5:5080/ws"};

test("realtime harness rejects missing values, shell injection and invalid networks",()=>{
  assert.throws(()=>parseConfig({},ips),{code:"field_environment_missing"});
  assert.deepEqual(parseConfig(config,ips),{
    ssh:config.TEAMFORGE_FIELD_GUEST_SSH,ipv4:"192.168.1.5",
    script:config.TEAMFORGE_FIELD_GUEST_REALTIME_SCRIPT,
    unity:config.TEAMFORGE_FIELD_UNITY_EDITOR,
  });
  assert.throws(()=>parseConfig({...config,TEAMFORGE_FIELD_GUEST_SSH:"user@pc && whoami"},ips),{code:"invalid_ssh_target"});
  assert.throws(()=>parseConfig({...config,TEAMFORGE_FIELD_GUEST_REALTIME_SCRIPT:"C:/../hack.mjs"},ips),{code:"invalid_guest_script"});
  assert.throws(()=>parseConfig({...config,TEAMFORGE_FIELD_HOST_IPV4:"192.168.1."},ips),{code:"invalid_host_ipv4"});
  assert.throws(()=>parseConfig({...config,TEAMFORGE_FIELD_HOST_IPV4:"192.168.1.99"},ips),{code:"host_ipv4_not_local"});
  assert.throws(()=>parseConfig({...config,TEAMFORGE_FIELD_UNITY_EDITOR:"C:\\temp\\cmd.exe"},ips),{code:"invalid_unity_editor"});
});

test("guest rejects fake peer identity, bad endpoints and unsupported scenarios",()=>{
  assert.equal(validateFieldFrame(frame,"guest-pc",head).mode,"authority");
  assert.throws(()=>validateFieldFrame({...frame,head:"b".repeat(40)},"guest-pc",head),{code:"field_peer_identity_mismatch"});
  assert.throws(()=>validateFieldFrame({...frame,hostName:"guest-pc"},"guest-pc",head),{code:"field_peer_identity_mismatch"});
  assert.throws(()=>validateFieldFrame({...frame,mode:"dangerous"},"guest-pc",head),{code:"field_peer_identity_mismatch"});
  assert.throws(()=>validateFieldFrame({...frame,token:"short"},"guest-pc",head),{code:"field_peer_identity_mismatch"});
  assert.throws(()=>validateFieldFrame({...frame,endpoint:"ws://127.0.0.1:5080/ws?token=x"},"guest-pc",head),{code:"invalid_realtime_endpoint"});
  assert.throws(()=>validateFieldFrame({...frame,endpoint:"wss://example.org/ws"},"guest-pc",head),{code:"invalid_realtime_endpoint"});
  assert.throws(()=>validateFieldFrame({...frame,endpoint:"ws://192.168.1.5:5080/other"},"guest-pc",head),{code:"invalid_realtime_endpoint"});
});

test("Unity result requires exactly the selected test passed (not ignored or absent)",()=>{
  const ok='<test-run result="Passed" total="1" passed="1" failed="0" skipped="0" inconclusive="0"></test-run>';
  assert.equal(readNunitResult(ok).passed,1);
  assert.throws(()=>readNunitResult('<test-run result="Passed" total="0" passed="0" failed="0" skipped="0" inconclusive="0">'),{code:"unity_field_assertions_failed"});
  assert.throws(()=>readNunitResult(ok.replace('skipped="0"','skipped="1"')),{code:"unity_field_assertions_failed"});
  assert.throws(()=>readNunitResult(ok.replace('passed="1"','passed="0"')),{code:"unity_field_assertions_failed"});
  assert.throws(()=>readNunitResult('<test-results></test-results>'),{code:"unity_test_result_missing"});
});
