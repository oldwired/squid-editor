"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const F=require("./project-format.js"),M=require("./music.js"),G=require("./generators.js");
const D=require("./drum-overlay.js");
const {fixture} = require("../tests/project-fixtures.cjs");
const blank=()=>F.Project.create();
const note=(time,pitch=60,duration=1)=>({time,pitch,duration,velocity:100,channel:0});
const group=notes=>({name:"Source",notes,cc:[],targetTrack:0,targetSlot:0,channel:0});
const options={start:0,end:16,split:true,quantize:"sixth",overwrite:false};
function smf(data,division=480){const header=Buffer.from("4d546864000000060000000101e04d54726b00000000","hex");header.writeUInt16BE(division,12);header.writeUInt32BE(data.length,18);return Buffer.concat([header,Buffer.from(data)]);}
test("hand-authored running-status MIDI decodes note-on zero as note-off",()=>{
  const read=M.readSMF(smf([0,144,60,100,0,64,110,120,60,0,0,64,0,0,255,47,0]));
  assert.equal(read.groups.length,1);assert.deepEqual(read.groups[0].notes.map(n=>[n.pitch,n.velocity,n.time,n.duration]),[[60,100,0,1],[64,110,0,1]]);
});
test("SMF writer emits 480 PPQN, format 0/1, names, tempo, channels and mapped CCs",()=>{
  const parts=[{name:"Bass",notes:[{...note(1/6,48,1.125),channel:3}],cc:[{time:0,controller:74,value:92,channel:3}],end:16},{name:"Lead",notes:[{...note(2,72,.125),channel:8}],end:16}];
  const bytes=M.writeSMF(parts,98.5),read=M.readSMF(bytes);assert.deepEqual(Array.from(bytes.slice(8,14)),[0,1,0,2,1,224]);assert.ok(Math.abs(read.bpm-98.5)<.001);
  assert.equal(read.tracks[0].name,"Bass");assert.equal(read.groups[0].channel,3);assert.equal(read.groups[1].channel,8);
  const n=read.groups[0].notes[0];assert.equal(n.time,1/6);assert.equal(n.duration,1.125);assert.equal(read.groups[0].cc[0].controller,74);
  assert.equal(M.readSMF(M.writeSMF([parts[0]],120)).format,0);
});
test("MIDI note offsets and gate ticks agree with Manager's 20/15 tick units",()=>{
  const p=blank();p.addPattern(0,0);p.setNote(0,0,0,0,{enabled:true,pitch:60,velocity:100,gate:0,offset:5});
  const part=M.patternEvents(p,0,0),read=M.readSMF(M.writeSMF([part],120)).groups[0].notes[0];
  assert.equal(read.tick,100);assert.equal(read.duration,.125);
  p.setNote(0,0,0,0,{gate:511});assert.equal(M.patternEvents(p,0,0).notes[0].duration,64);
});
test("MIDI export respects fixed length while retaining stored notes in the project",()=>{
  const p=blank();p.addPattern(0,0);p.setNote(0,0,9,0,{enabled:true,pitch:60});p.setNote(0,0,10,0,{enabled:true,pitch:72});p.setPattern(0,0,"fixedLength",10);
  const events=M.patternEvents(p,0,0);assert.equal(events.end,10);assert.deepEqual(events.notes.map(n=>n.pitch),[60]);assert.equal(p.step(0,0,10).notes[0].enabled,true);
});
test("corrupt, truncated, SMPTE and format-2 MIDI are rejected with bounded reads",()=>{
  const good=smf([0,255,47,0]);
  for(let i=0;i<good.length;i++)assert.throws(()=>M.readSMF(good.slice(0,i)));
  assert.throws(()=>M.readSMF(smf([0,60,100,0,255,47,0])),/running status/);
  assert.throws(()=>M.readSMF(smf([0,144,60,128,0,255,47,0])),/channel data/);
  assert.throws(()=>M.readSMF(smf([0,255,47,0],0x8001)),/SMPTE/);
  const format=Buffer.from(good);format[9]=2;assert.throws(()=>M.readSMF(format),/formats 0 and 1/);
  assert.throws(()=>M.readSMF(smf([128,128,128,128,0])),/variable-length/);
});
test("import dry run splits at 64 steps, preserves offsets and leaves source bytes untouched",()=>{
  const p=blank(),before=p.serialize();const prepared=M.prepareImport(p,[group([note(0),note(63+5/6,61),note(64,62)])],{...options,end:80});
  assert.deepEqual(p.serialize(),before);const result=F.Project.parse(prepared.bytes);
  assert.equal(result.count,2);assert.equal(result.step(0,0,63).notes[0].offset,5);assert.equal(result.step(0,1,0).notes[0].pitch,62);
  assert.equal(prepared.report.patterns,2);assert.equal(prepared.report.quantized,0);
  assert.throws(()=>M.prepareImport(p,[group([])],{...options,end:80,split:false}),/64 steps/);
});
test("range selection crops held notes and uses fixed length for partial pages",()=>{
  const prepared=M.prepareImport(blank(),[group([note(0,60,10),note(15,72)])],{...options,start:4,end:14});
  const p=F.Project.parse(prepared.bytes);assert.equal(p.step(0,0,0).notes[0].gate,47);assert.equal(p.effects(0,0).fixedSteps,10);assert.equal(p.effects(0,0).fixed,true);assert.equal(prepared.report.notes,1);assert.equal(prepared.report.clipped,1);
});
test("overflow and colliding destinations fail atomically; replacement must be explicit",()=>{
  const p=blank(),before=p.serialize();
  assert.throws(()=>M.prepareImport(p,[group(Array.from({length:9},(_,i)=>note(0,60+i)))],options),/eight notes/);
  assert.deepEqual(p.serialize(),before);
  assert.throws(()=>M.prepareImport(p,[{...group([]),targetSlot:63}],{...options,end:80}),/64-slot/);
  assert.throws(()=>M.prepareImport(p,[group([]),group([])],options),/same pattern/);
  p.addPattern(0,0);assert.throws(()=>M.prepareImport(p,[group([])],options),/occupied/);
  assert.equal(F.Project.parse(M.prepareImport(p,[group([note(0)])],{...options,overwrite:true}).bytes).step(0,0,0).notes[0].enabled,true);
});
test("CC import requires existing assignments and reports explicit duration clamping",()=>{
  const p=blank(),g=group([note(0,60,100)]);g.cc=[{time:0,controller:74,value:81}];
  assert.throws(()=>M.prepareImport(p,[g],{...options,end:128}),/Assign the source CC/);
  p.setTrack(0,"cc2",74);const imported=M.prepareImport(p,[g],{...options,end:128});const result=F.Project.parse(imported.bytes);
  assert.equal(result.step(0,0,0).cc[2],81);assert.equal(imported.report.gateClipped,1);
});
test("ZIP bank exports pass independent Python ZIP/CRC validation",()=>{
  const midi=M.writeSMF([{name:"Test",notes:[note(0)]}],120),bytes=M.zip([{name:"T01_P01.mid",bytes:midi},{name:"T02_P01.mid",bytes:midi}]);
  const result=spawnSync("python3",["-c","import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert z.namelist()==['T01_P01.mid','T02_P01.mid']; assert z.read(z.namelist()[0])[:4]==b'MThd'"],{input:bytes});
  assert.equal(result.status,0,result.stderr.toString());assert.equal(M.crc32(Buffer.from("123456789")),0xcbf43926);
});
test("every complete preset is deterministic, musically bounded and serializable",()=>{
  assert.ok(G.PRESETS.length>=12);
  for(const preset of G.PRESETS){const result=G.generate(preset.config);assert.deepEqual(result,G.generate(preset.config),preset.id);assert.ok(result.notes.length>0,preset.id);
    for(const n of result.notes){assert.ok(Number.isInteger(n.pitch)&&n.pitch>=0&&n.pitch<=127);assert.ok(n.time>=0&&n.time<preset.config.length);assert.ok(n.velocity>0&&n.velocity<=127);}
    const prepared=M.prepareImport(blank(),[group(result.notes)],{...options,end:preset.config.length});F.Project.parse(prepared.bytes);
  }
});
test("drum presets produce predictable kick, backbeat and offbeat hats",()=>{
  for(const [id,pitch,times] of [["kick",36,[0,4,8,12]],["backbeat",38,[4,12]],["offbeat-hats",46,[2,6,10,14]]]){
    const notes=G.generate(G.PRESETS.find(p=>p.id===id).config).notes;assert.deepEqual(notes.map(n=>n.time),times);assert.ok(notes.every(n=>n.pitch===pitch));
  }
});
test("generator locks retain source rhythm, pitch, articulation and strum offsets",()=>{
  const source=[{...note(2.5,73,3),velocity:92},{...note(6,67,.5),velocity:77}];
  const result=G.generate({lockRhythm:true,lockPitch:true,lockArticulation:true,invert:true},source);
  assert.deepEqual(result.notes,source);
});
test("rhythm generators compose with transforms and reject invalid inputs",()=>{
  const a=G.generate({rhythm:"euclidean",melody:"root",length:16,pulses:5,root:60});assert.equal(a.notes.length,5);
  const b=G.generate({rhythm:"euclidean",melody:"root",length:16,pulses:5,root:60,rotation:3});assert.deepEqual(b.notes.map(n=>n.time).sort((a,b)=>a-b),a.notes.map(n=>(n.time+3)%16).sort((a,b)=>a-b));
  for(const config of [{length:0},{root:48.5},{gate:NaN},{progression:"0,9"},{rhythm:"missing"}])assert.throws(()=>G.generate(config));
});
test("drum name convention groups non-contiguous tracks into separate virtual drums",()=>{
  const p=blank();for(const [t,name] of [[0,"dr1_kick"],[1,"dr1_snare"],[5,"dr2_kick"],[6,"dr2_snare"]])p.setTrack(t,"name",name);
  assert.deepEqual(D.groups(p),[{id:1,rows:[{track:0,name:"kick"},{track:1,name:"snare"}]},{id:2,rows:[{track:5,name:"kick"},{track:6,name:"snare"}]}]);
  assert.equal(D.nameFor("Closed HH",1),"dr1_closed_hh");assert.equal(D.nameFor("dr2_snare",1),"dr1_snare");
  assert.throws(()=>D.nameFor("x".repeat(31),1),/31 characters/);
});
test("drum trigger toggles preserve polyphony, strums, CCs and routing",()=>{
  const p=blank();D.toggleHit(p,5,3,0,36);p.setNote(5,3,0,1,{enabled:true,pitch:39,offset:4});p.setCC(5,3,0,2,88,true);
  const notes=p.step(5,3,0).notes,track=p.track(5);D.toggleHit(p,5,3,0,36);assert.equal(p.step(5,3,0).enabled,false);assert.deepEqual(p.step(5,3,0).notes,notes);
  D.toggleHit(p,5,3,0,36);assert.equal(p.step(5,3,0).enabled,true);assert.deepEqual(p.track(5),track);assert.equal(p.step(5,3,0).cc[2],88);
  D.toggleHit(p,5,3,31,42);assert.equal(p.pattern(5,3)[4]&15,2);assert.equal(p.step(5,3,31).notes[0].pitch,42);
});
test("single-track drums persist through names and stay separate from numbered groups",()=>{
  const p=blank();p.setTrack(0,"name",D.singleNameFor("Kit"));p.setTrack(1,"name","dr2_snare");p.setTrack(5,"name","dr_percussion");
  assert.equal(D.isSingleTrack(p,0),true);assert.equal(D.isSingleTrack(p,5),true);assert.equal(D.isSingleTrack(p,1),false);
  assert.deepEqual(D.groups(p),[{id:2,rows:[{track:1,name:"snare"}]}]);
  assert.equal(D.singleNameFor("dr2_snare"),"DR_snare");assert.equal(D.nameFor("DR_Kit",3),"dr3_kit");
  assert.throws(()=>D.singleNameFor("x".repeat(29)),/Shorten/);
  assert.equal(D.isSingleTrack(F.Project.parse(p.serialize()),0),true);
});
test("single-note drum toggles preserve all other lanes, shared settings and dormant articulation",()=>{
  const p=blank();p.addPattern(0,0);p.setNote(0,0,0,0,{enabled:true,pitch:36,velocity:83,gate:15,offset:2});
  p.setNote(0,0,0,7,{enabled:true,pitch:51,velocity:67,gate:3,offset:4});p.setCC(0,0,0,2,88,true);p.setStep(0,0,0,"divide",3);
  const before=p.step(0,0,0),header=p.header.slice();D.toggleNoteHit(p,0,0,0,7,60);
  const disabled=p.step(0,0,0);assert.equal(disabled.notes[7].enabled,false);assert.equal(disabled.enabled,true);
  assert.deepEqual(disabled.notes.slice(0,7),before.notes.slice(0,7));assert.deepEqual(disabled.cc,before.cc);assert.equal(disabled.ccMask,before.ccMask);assert.equal(disabled.divide,3);
  D.toggleNoteHit(p,0,0,0,7,60);assert.deepEqual(p.step(0,0,0),before);assert.deepEqual(p.header,header);
  p.setStep(0,0,0,"enabled",false);D.toggleNoteHit(p,0,0,0,7,60);assert.equal(p.step(0,0,0).enabled,false);
  D.toggleNoteHit(p,0,0,0,7,60);assert.equal(p.step(0,0,0).enabled,true);assert.deepEqual(p.step(0,0,0).notes,before.notes);
  D.toggleNoteHit(p,0,0,31,6,49);const newHit=p.step(0,0,31);assert.equal(p.pattern(0,0)[4]&15,2);
  assert.deepEqual(newHit.notes.filter(n=>n.enabled).map(n=>[n.pitch,n.velocity,n.gate,n.offset]),[[49,100,7,0]]);
  const bytes=p.serialize();for(const [n,pitch,step] of [[8,60,0],[0,128,0],[0,60,64]])assert.throws(()=>D.toggleNoteHit(p,0,0,step,n,pitch));assert.deepEqual(p.serialize(),bytes);
});
test("drum routing normalisation copies the first member and changes only routing fields",()=>{
  const p=blank();p.addPattern(5,2);p.setNote(5,2,0,0,{enabled:true,pitch:36,offset:4});p.setCC(5,2,0,2,91,true);
  for(const [key,value] of Object.entries({port:2,channel:10,delay:13,bankMSB:255,bankLSB:7,program:41,cc0:74,cc1:71,cc2:1,cc3:10,cc4:11}))p.setTrack(1,key,value);
  p.setTrack(5,"mute",true);p.setTrack(9,"solo",true);
  const before=p.serialize(),source=p.track(1);assert.equal(D.normaliseRouting(p,[9,5,1,5]),1);
  for(const t of [1,5,9])for(const key of ["port","channel","delay","bankMSB","bankLSB","program","ccNumbers"])assert.deepEqual(p.track(t)[key],source[key],"T"+(t+1)+" "+key);
  assert.equal(p.track(5).mute,true);assert.equal(p.track(9).solo,true);
  const allowed=new Map();for(const t of [5,9])for(const [offset,mask] of [[8,255],[9,128],[11,127],[12,255],[13,255],[14,255],[15,240],[16,255],[17,255],[18,255],[19,255]])allowed.set(0xb4+t*0xe8+offset,mask);
  const after=p.serialize();assert.equal(after.length,before.length);for(let i=0;i<after.length;i++)assert.equal((after[i]^before[i])&~(allowed.get(i)||0),0,"Unrelated byte 0x"+i.toString(16));
});
test("drum routing normalisation rejects incompatible or invalid settings atomically",()=>{
  for(const corruption of [p=>p.header[0xb4+8]=48,p=>p.header[0xb4+0x10]=64,p=>p.header[0xb4+5*0xe8+6]=49]){
    const p=blank();corruption(p);const before=p.serialize();assert.throws(()=>D.normaliseRouting(p,[0,5]));assert.deepEqual(p.serialize(),before);
  }
  assert.throws(()=>D.normaliseRouting(blank(),[]),/participating track/);
});
