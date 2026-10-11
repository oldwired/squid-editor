"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const H=require("./squid-hid.js"),F=require("./project-format.js");
const {fixture,transferFixture} = require("../tests/project-fixtures.cjs");
const reportSpec={reportId:0,items:[{reportSize:8,reportCount:64}]};
// A simulated peer drives the real asynchronous report listener and handshake.
class Peer{
  constructor(respond,{mutate=()=>{},stall=false,stalledWrite=false}={}){
    this.vendorId=H.VID;this.productId=H.PID;this.opened=true;this.collections=[{usagePage:0xffa0,children:[{inputReports:[reportSpec],outputReports:[reportSpec]}]}];
    this.respond=respond;this.mutate=mutate;this.stall=stall;this.stalledWrite=stalledWrite;this.listeners=new Set();this.reports=[];this.requests=[];this.pending=null;this.response=null;
  }
  addEventListener(name,fn){if(name==="inputreport")this.listeners.add(fn);}
  removeEventListener(name,fn){this.listeners.delete(fn);}
  emit(bytes){bytes=Uint8Array.from(bytes);this.mutate(bytes);for(const fn of this.listeners)fn({device:this,reportId:0,data:new DataView(bytes.buffer)});}
  async sendReport(id,report){
    assert.equal(id,0);assert.equal(report.length,64);this.reports.push(Uint8Array.from(report));
    if(this.stalledWrite)return new Promise(()=>{});if(this.stall)return;
    const dv=new DataView(report.buffer,report.byteOffset,report.byteLength),type=report[1],index=dv.getUint16(2,true);
    if(report[0]===0xa0){this.pending={type,body:new Uint8Array(dv.getUint32(4,true)),crc:dv.getUint16(8,true),offset:0,index:1};this.emit(H.ackReport(0xa8,type,1));}
    else if(report[0]===0xa1){
      const p=this.pending;assert.ok(p);assert.equal(type,p.type);assert.equal(index,p.index++);
      const length=Math.min(60,p.body.length-p.offset);p.body.set(report.subarray(4,4+length),p.offset);p.offset+=length;
      if(p.offset===p.body.length){assert.equal(H.crc16(p.body),p.crc);this.pending=null;this.requests.push({type,body:p.body});this.emit(H.ackReport(0xae,type,index+1));
        const reply=this.respond(type,p.body,this);if(reply!==null){this.response={type,body:Uint8Array.from(reply),index:1};this.emit(H.startReport(type,this.response.body));}}
      else this.emit(H.ackReport(0xa9,type,index+1));
    }else if(report[0]===0xa8||report[0]===0xa9){
      const r=this.response;assert.ok(r);assert.equal(type,r.type);const block=r.index++;
      this.emit(H.dataReport(type,block,r.body.subarray((block-1)*60,block*60)));
    }else if(report[0]===0xae||report[0]===0xaf)this.response=null;
    else assert.fail("Unknown host report");
  }
}
function connect(responder,options){const peer=new Peer(responder,options),transport=new H.Transport(peer,{timeoutMs:30});return {peer,transport,client:new H.Client(transport)};}
function listBody(){
  const b=new Uint8Array(41),v=new DataView(b.buffer);b[0]=1;b[1]=9;v.setUint16(2,19,false);b.set(new TextEncoder().encode("Synthetic"),4);b[37]=127;v.setUint16(38,2048,false);b[40]=9;return b;
}
test("framing matches known CRC vectors, report padding and little-endian lengths",()=>{
  assert.equal(H.crc16(new TextEncoder().encode("123456789")),0x31c3);
  // Independently calculated using Python binascii.crc_hqx(bytes, 0).
  const body=Uint8Array.from({length:4096},(_,i)=>(i*37+11)&255);
  assert.equal(H.crc16(body),0xa843);
  const start=H.startReport(5,body);assert.deepEqual(Array.from(start.subarray(0,10)),[0xa0,5,0,0,0,16,0,0,0x43,0xa8]);assert.ok(start.subarray(10).every(n=>n===0));
  const data=H.dataReport(3,258,Uint8Array.of(9,1));assert.deepEqual(Array.from(data.subarray(0,7)),[0xa1,3,2,1,9,1,0]);assert.equal(data.length,64);
});
test("zero-length requests send the Manager's empty A1 and accept an immediate response",async()=>{
  const {transport,peer}=connect(type=>{assert.equal(type,0);return listBody();});const reply=await transport.command(0);
  assert.deepEqual(reply,listBody());assert.deepEqual(peer.requests[0].body,new Uint8Array());
  assert.deepEqual(peer.reports.slice(0,2).map(r=>[r[0],r[1],r[2]]),[[0xa0,0,0],[0xa1,0,1]]);
  assert.ok(peer.reports[1].subarray(4).every(n=>n===0));
});
test("multi-block sends are paced by acknowledgements and preserve final partial bytes",async()=>{
  const body=Uint8Array.from({length:61},(_,n)=>n),{transport,peer}=connect((type,received)=>{assert.equal(type,5);assert.deepEqual(received,body);return [1];});
  assert.deepEqual(await transport.command(5,body),Uint8Array.of(1));const sent=peer.reports.filter(r=>r[0]===0xa1);assert.equal(sent.length,2);assert.equal(sent[1][4],60);assert.ok(sent[1].subarray(5).every(n=>n===0));
});
test("acknowledgements accept hardware next-index and Manager echoed-index conventions, reject unrelated indices",async()=>{
  const {transport}=connect(()=>[1],{mutate:r=>{if([0xa8,0xa9,0xae].includes(r[0]))r[2]--;}});assert.deepEqual(await transport.command(5,new Uint8Array(61)),Uint8Array.of(1));
  const bad=connect(()=>[1],{mutate:r=>{if(r[0]===0xa8)r[2]=7;}});await assert.rejects(bad.transport.command(0),/Unexpected SQUID acknowledgement/);assert.equal(bad.transport.usable,false);
});
test("project-list records and capacity use bounded names and big-endian counts",()=>{
  assert.deepEqual(H.decodeProjectList(listBody()),{projects:[{id:9,name:"Synthetic",patterns:19}],remainingProjects:127,remainingPatterns:2048,currentId:9});
  assert.throws(()=>H.decodeProjectList([2]),/busy/);assert.throws(()=>H.decodeProjectList(listBody().subarray(0,40)),/Invalid/);
  const b=listBody();b[2]=5;assert.throws(()=>H.decodeProjectList(b),/pattern count/);
});
test("a full project download round-trips the synthetic project and closes with continuation",async()=>{
  let page=0;const progress=[];const {client,peer}=connect((type,body)=>{
    assert.equal(type,3);assert.equal(body[0],9);assert.equal(body[1],page?1:0);
    if(page===fixture.length/4096)return [1];return fixture.subarray(page++*4096,page*4096);
  });const downloaded=await client.downloadProject(9,{onProgress:p=>progress.push(p)});
  assert.ok(Buffer.from(downloaded).equals(fixture));assert.equal(F.Project.parse(downloaded).count,19);assert.equal(peer.requests.length,21);assert.equal(progress.at(-1).page,20);
});
test("a short project download aborts rather than loading a partial file",async()=>{
  let page=0;const {client,peer}=connect((type,body)=>body[1]===2?[1]:page++? [1]:fixture.subarray(0,4096));
  await assert.rejects(client.downloadProject(9),/before all pattern/);assert.deepEqual(Array.from(peer.requests.at(-1).body),[9,2]);
});
test("cancelling a read completes its current page then sends the project abort command",async()=>{
  const controller=new AbortController(),{client,peer}=connect((type,body)=>body[1]===2?[1]:fixture.subarray(0,4096));
  await assert.rejects(client.downloadProject(9,{signal:controller.signal,onProgress:()=>controller.abort()}),{name:"AbortError"});
  assert.equal(peer.requests.length,2);assert.deepEqual(Array.from(peer.requests.at(-1).body),[9,2]);assert.ok(!peer.requests.some(r=>r.type===1));
});
test("cancelling during final read completion rejects without aborting the completed device session",async()=>{
  const input=transferFixture(),controller=new AbortController(),requests=[];
  let page=0,finish,reached;const completion=new Promise(resolve=>{finish=resolve;}),finishing=new Promise(resolve=>{reached=resolve;});
  const client=new H.Client({usable:true,async command(type,body=new Uint8Array()){
    requests.push({type,body:Array.from(body)});if(type===0)return listBody();assert.equal(type,3);assert.equal(body[0],9);assert.equal(body[1],page?1:0);
    if(page===input.length/F.PAGE){reached();return completion;}return input.subarray(page++*F.PAGE,page*F.PAGE);
  }});
  const read=client.downloadProject(9,{signal:controller.signal});await finishing;controller.abort();finish(Uint8Array.of(1));
  await assert.rejects(read,{name:"AbortError"});assert.equal(requests.length,4);assert.deepEqual(requests.at(-1).body,[9,1]);
  assert.equal(client.busy,false);assert.equal((await client.listProjects()).projects[0].id,9);
});
test("uploads query capacity then send exact project pages and a separate save command",async()=>{
  const input=Buffer.from(fixture),{client,peer}=connect((type,body)=>{if(type===4){assert.deepEqual(Array.from(body),[0,19]);input.fill(0);}return [1];});
  const uploaded=await client.uploadProject(input);assert.equal(uploaded.count,19);assert.equal(peer.requests[0].type,4);
  assert.ok(Buffer.concat(peer.requests.slice(1,-1).map(r=>Buffer.from(r.body))).equals(fixture));assert.deepEqual(Array.from(peer.requests.at(-1).body),[0]);assert.equal(peer.requests.at(-1).type,5);
});
test("capacity rejection prevents every project-page write",async()=>{
  const {client,peer}=connect(()=>[0]);await assert.rejects(client.uploadProject(fixture),/free project/);assert.deepEqual(peer.requests.map(r=>r.type),[4]);
});
test("invalid files are rejected before sending any command",async()=>{
  const {client,peer}=connect(()=>[1]);await assert.rejects(client.uploadProject(new Uint8Array(4096)),/Unsupported/);assert.equal(peer.reports.length,0);
});
test("cancelling upload sends abort instead of the save command",async()=>{
  const controller=new AbortController(),{client,peer}=connect(()=>[1]);await assert.rejects(client.uploadProject(fixture,{signal:controller.signal,onProgress:p=>{if(p.phase==="write")controller.abort();}}),{name:"AbortError"});
  assert.equal(peer.requests.length,3);assert.deepEqual(Array.from(peer.requests.at(-1).body),[1]);
});
test("busy during upload causes an explicit abort and no further pages",async()=>{
  const {client,peer}=connect((type,body)=>type===5&&body.length===4096?[2]:[1]);await assert.rejects(client.uploadProject(fixture),/busy/);
  assert.equal(peer.requests.length,3);assert.deepEqual(Array.from(peer.requests.at(-1).body),[1]);
});
test("bad response CRC and out-of-order blocks fail closed with a negative acknowledgement",async()=>{
  for(const corrupt of [r=>{if(r[0]===0xa0)r[8]^=1;},r=>{if(r[0]===0xa1)r[2]=2;}]){
    const {transport,peer}=connect(()=>[1],{mutate:corrupt});await assert.rejects(transport.command(0),/checksum|out of order/);assert.equal(peer.reports.at(-1)[0],0xaf);assert.equal(transport.usable,false);
  }
});
test("oversized responses are refused before allocating a buffer",async()=>{
  const {transport,peer}=connect(()=>[1],{mutate:r=>{if(r[0]===0xa0)new DataView(r.buffer).setUint32(4,0xffffffff,true);}});
  await assert.rejects(transport.command(0),/size/);assert.equal(peer.reports.at(-1)[0],0xaf);
});
test("concurrent requests and concurrent project operations are refused",async()=>{
  const {transport,client}=connect(()=>null);const first=client.listProjects();await assert.rejects(client.listProjects(),/still running/);await assert.rejects(transport.command(0),/still running/);transport.disconnect();await assert.rejects(first,/disconnected/);
});
test("timeouts cover absent acknowledgements, responses and stalled sendReport promises",async()=>{
  for(const options of [{stall:true},{stalledWrite:true},{}]){const {transport}=connect(()=>null,options);await assert.rejects(transport.command(0),/timed out/);assert.equal(transport.usable,false);}
});
test("only the expected SQUID report interface and project commands are accepted",async()=>{
  assert.throws(()=>new H.Transport({vendorId:1,productId:2}),/TORAIZ/);
  const peer=new Peer(()=>[1]);peer.collections=[];assert.throws(()=>new H.Transport(peer),/64-byte/);
  const {transport}=connect(()=>[1]);await assert.rejects(transport.command(1),/Unsupported/);await assert.rejects(transport.command(0x80),/Unsupported/);
});
