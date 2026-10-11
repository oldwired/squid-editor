"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const F=require("./project-format.js"),E=require("./edit-functions.js");
const V=require("./value-chart.js"),D=require("./drum-overlay.js");
const {fixture} = require("../tests/project-fixtures.cjs");
const load=()=>F.Project.parse(fixture);
function isolated(before,after,allowed){for(let i=0;i<after.length;i++)assert.equal((before[i]^after[i])&~(allowed.get(i)||0),0,"Unexpected byte "+i.toString(16));}

test("Mono/Poly and recalled pattern use the confirmed packed bits without changing CCs",()=>{
  const p=load(),before=p.serialize(),track=p.track(0);p.setTrack(0,"mono",true);p.setTrack(0,"selectedPattern",63);
  const after=p.serialize(),info=F.Project.parse(after).track(0);
  assert.equal(info.mono,true);assert.equal(info.selectedPattern,63);assert.deepEqual(info.ccNumbers,track.ccNumbers);assert.equal(info.color,track.color);assert.equal(info.channel,track.channel);
  isolated(before,after,new Map([[0xc3,8],[0xbd,1],[0xbe,0xf8]]));
  const snapshot=p.serialize();assert.throws(()=>p.setTrack(0,"selectedPattern",64));assert.deepEqual(p.serialize(),snapshot);
});
test("harmonizer chords decode the synthetic defaults and write four big-endian nibbles",()=>{
  const p=load();assert.deepEqual(p.track(0).harmonizer[0],[4,7,0,0]);assert.deepEqual(p.track(0).harmonizer[5],[3,7,10,14]);
  for(const preset of F.HARMONIZER_PRESETS){const before=p.serialize();p.setHarmonizer(0,2,preset.intervals);
    const after=p.serialize();assert.equal(F.u16(after,0xec),preset.intervals.reduce((w,n,i)=>w|(n<<(12-i*4)),0));isolated(before,after,new Map([[0xec,255],[0xed,255]]));}
  p.setHarmonizer(0,2,[15,3,7,0]);assert.deepEqual(p.track(0).harmonizer[2],[3,7,15,0]);
  for(const values of [[4,4],[16],[-1],[1,2,3,4,5],[NaN]]){const before=p.serialize();assert.throws(()=>p.setHarmonizer(0,2,values));assert.deepEqual(p.serialize(),before);}
});
test("scene bytes use bit 7 for mute and a seven-bit slot/sentinel, with atomic recall",()=>{
  const p=load();assert.deepEqual(p.patternSet(0).entries[1],{slot:0,mute:true});assert.deepEqual(p.patternSet(0).entries[8],{slot:1,mute:true});
  const before=p.serialize();p.setPatternSetTrack(0,1,"slot",63);assert.equal(p.header[0xead],0xbf);p.setPatternSetTrack(0,1,"mute",false);assert.equal(p.header[0xead],63);
  isolated(before,p.serialize(),new Map([[0xead,255]]));
  const entries=Array.from({length:16},(_,t)=>({slot:t<2 ? t*8 : null,mute:t===1}));p.setPatternSet(2,entries);
  assert.deepEqual(p.header.slice(0xecc,0xedc),Uint8Array.from([0,0x88,...Array(14).fill(255)]));
  const saved=p.serialize();assert.throws(()=>p.setPatternSet(2,entries.map((e,t)=>t===15 ? {...e,slot:64} : e)));assert.deepEqual(p.serialize(),saved);
  p.clearPatternSet(15);p.copyPatternSet(2,15);assert.deepEqual(p.patternSet(15),p.patternSet(2));assert.throws(()=>p.copyPatternSet(2,15),/empty/);
  p.setTrack(0,"solo",true);p.recallPatternSet(2);assert.equal(p.track(0).solo,false);assert.equal(p.track(1).selectedPattern,8);assert.equal(p.track(1).mute,true);
  p.header[0xecc+15]=65;const invalid=p.serialize();assert.throws(()=>p.recallPatternSet(2));assert.deepEqual(p.serialize(),invalid);
  p.clearPatternSet(2);assert.equal(p.patternSet(2).enabled,false);assert.ok(p.header.slice(0xecc,0xedc).every(n=>n===255));
  p.setPatternSetTrack(2,0,"slot",3);assert.deepEqual(p.patternSet(2).entries[0],{slot:3,mute:false});
  p.setPatternSetTrack(2,0,"mute",true);p.setPatternSetTrack(2,0,"slot",4);assert.deepEqual(p.patternSet(2).entries[0],{slot:4,mute:true});
  p.setPatternSetTrack(2,0,"slot",null);assert.equal(p.header[0xecc],255);
});
test("all musical settings change only their documented pattern bytes and reject bad numbers",()=>{
  const specs={fixed:[0xe24,1],fixedSteps:[0xe25,63],probability:[0xe23,1],rate:[0xe22,100],swing:[0xe13,100],
    modShape:[0xe10,5],modLength:[0xe11,64],modDepth:[0xe12,-64],scale:[0xe20,22],key:[0xe21,11],arp:[0xe14,1],
    arpOctaves:[0xe15,3],arpGate:[0xe16,1],arpRate:[0xe18,7,4],arpStyle:[0xe1c,3,4],reverse:[0xe2c,1],switchBack:[0xe2d,1]};
  for(const [key,[offset,value,size=1]] of Object.entries(specs)){
    const p=load(),before=p.pattern(0,0).slice();p.setPattern(0,0,key,value);const after=p.pattern(0,0);
    isolated(before,after,new Map(Array.from({length:size},(_,i)=>[offset+i,255])));
    assert.equal(p.effects(0,0)[key],size===4 ? value : ["fixed","probability","arp","reverse","switchBack"].includes(key) ? true : value);
    if(!["fixed","probability","arp","reverse","switchBack"].includes(key))for(const invalid of [NaN,"",999,-999]){const snapshot=p.serialize();assert.throws(()=>p.setPattern(0,0,key,invalid));assert.deepEqual(p.serialize(),snapshot);}
  }
});
test("tie, harmonizer and all automation edits preserve notes, skip, count and neighboring flags",()=>{
  const p=load(),before=p.copyStep(0,0,0),original=p.step(0,0,0);p.setStep(0,0,0,"tie",true);p.setStep(0,0,0,"harmonizer",6);
  assert.equal(F.u32(p.pattern(0,0),8)&0x43800000,0x43000000);
  for(const [code] of F.SPEED_CONTROL)p.setStep(0,0,0,"speedControl",code);
  for(const [code] of F.ROLLS)p.setStep(0,0,0,"roll",code);
  for(let i=0;i<6;i++)p.setStep(0,0,0,"groove"+i,i-3);
  const info=p.step(0,0,0);assert.equal(info.tie,true);assert.equal(info.harmonizer,6);assert.equal(info.enabled,original.enabled);assert.equal(info.count,original.count);assert.deepEqual(info.notes,original.notes);
  assert.deepEqual(info.groove,[61,62,63,64,65,66]);for(let i=1;i<4;i++)assert.deepEqual(p.copyStep(0,0,0)[i],before[i]);
  for(const [key,value] of [["harmonizer",7],["speedControl",10],["roll",5],["groove0",-65]]){const bytes=p.serialize();assert.throws(()=>p.setStep(0,0,0,key,value));assert.deepEqual(p.serialize(),bytes);}
  p.clearAutomation(0,0,0);assert.equal(p.step(0,0,0).transpose,8);assert.equal(p.step(0,0,0).speedControl,0);assert.deepEqual(p.step(0,0,0).groove,Array(6).fill(64));assert.equal(p.step(0,0,0).tie,true);
});
test("interpolation follows stored direction, retains chords and leaves the source untouched",()=>{
  const p=load();p.setPattern(0,0,"direction",1);for(let st=0;st<16;st++)p.setNote(0,0,st,0,{enabled:true,offset:2});
  p.setNote(0,0,4,1,{enabled:true,pitch:80,offset:4});const before=p.serialize();
  const result=E.prepare(p,0,0,{operation:"interpolate",parameter:"pitch",order:"direction",anchors:"1:60, 13:72",fill:false,resetOffset:true});
  const q=F.Project.parse(result.bytes);assert.deepEqual([0,4,8,12].map(st=>q.step(0,0,st).notes[0].pitch),[60,64,68,72]);
  assert.equal(q.step(0,0,4).notes[1].pitch,80);assert.equal(q.step(0,0,4).notes[1].offset,4);assert.equal(q.step(0,0,4).notes[0].offset,0);
  assert.deepEqual(p.serialize(),before);assert.deepEqual(q.pattern(0,0).slice(0xe10),p.pattern(0,0).slice(0xe10));
  const gates=F.Project.parse(E.prepare(p,0,0,{operation:"interpolate",parameter:"gate",order:"numeric",anchors:"1:0.125, 5:1.125",resetOffset:false}).bytes);
  assert.equal(gates.step(0,0,4).notes[0].gate,8);assert.equal(gates.step(0,0,4).notes[1].gate,8);assert.equal(gates.step(0,0,4).notes[1].offset,4);
});
test("seeded randomizer respects scale/ranges and step skips without losing musical data",()=>{
  const p=load();p.setPattern(0,0,"scale",1);p.setPattern(0,0,"key",2);
  const options={operation:"randomize",parameter:"pitch",order:"numeric",start:1,end:16,min:60,max:72,seed:"repeat",scale:true,fill:true,resetOffset:false};
  const a=E.prepare(p,0,0,options),b=E.prepare(p,0,0,options);assert.deepEqual(a.bytes,b.bytes);
  const q=F.Project.parse(a.bytes);for(let st=0;st<16;st++){const n=q.step(0,0,st).notes[0];assert.ok(n.pitch>=60&&n.pitch<=72);assert.ok([2,4,6,7,9,11,1].includes(n.pitch%12));}
  const skipped=F.Project.parse(E.prepare(p,0,0,{...options,parameter:"active",chance:0}).bytes);assert.ok(Array.from({length:16},(_,st)=>skipped.step(0,0,st).enabled).every(v=>!v));assert.deepEqual(skipped.step(0,0,0).notes,p.step(0,0,0).notes);
  const before=p.serialize();for(const bad of [{...options,start:NaN},{...options,min:73,max:72},{...options,parameter:"gate",min:.2,max:1},{...options,operation:"interpolate",anchors:"1:60,1:72"}])assert.throws(()=>E.prepare(p,0,0,bad));assert.deepEqual(p.serialize(),before);
});
test("value bars edit active chord slots or a single slot without touching offsets or empty notes",()=>{
  const p=load();p.setNote(0,0,0,3,{enabled:true,pitch:67,velocity:63,gate:15,offset:4});
  const before=p.pattern(0,0).slice(),info=V.read(p,0,0,0,"velocity","all");assert.equal(info.min,63);assert.equal(info.max,127);assert.equal(info.value,95);
  V.write(p,0,0,0,"velocity","all",80);assert.equal(p.step(0,0,0).notes[0].velocity,80);assert.equal(p.step(0,0,0).notes[3].velocity,80);
  isolated(before,p.pattern(0,0),new Map([[0x291,255],[0x29d,255]]));
  V.write(p,0,0,0,"gate","3",31);assert.equal(p.step(0,0,0).notes[0].gate,7);assert.equal(p.step(0,0,0).notes[3].gate,31);assert.equal(p.step(0,0,0).notes[3].offset,4);
  const empty=p.copyStep(0,0,1);V.write(p,0,0,1,"velocity","all",90);assert.deepEqual(p.copyStep(0,0,1),empty);
  assert.equal(V.read(p,0,0,1,"velocity","all").editable,false);V.write(p,0,0,1,"cc4","all",99);assert.equal(p.step(0,0,1).cc[4],99);assert.equal(p.step(0,0,1).ccMask&16,16);
  const saved=p.serialize();for(const invalid of [NaN,-1,128])assert.throws(()=>V.write(p,0,0,0,"velocity","all",invalid));assert.deepEqual(p.serialize(),saved);
  assert.equal(V.fromHeight("gate",.5,2),7);assert.equal(V.fromHeight("gate",1,64),511);assert.equal(V.fromHeight("gate",0,2),0);assert.equal(V.fromHeight("velocity",.5,2),64);
});
test("drum scene controls cover sparse groups, retain mixed states and stage changes atomically",()=>{
  const p=load();for(const [t,name] of [[0,"dr1_kick"],[6,"dr1_snare"],[8,"dr2_hat"]])p.setTrack(t,"name",name);
  const [group,other]=D.groups(p);assert.deepEqual(group.rows.map(r=>r.track),[0,6]);p.clearPatternSet(15);
  p.setPatternSetTrack(15,8,"slot",9);p.setPatternSetTrack(15,0,"slot",1);const before=p.serialize();
  assert.equal(D.sceneState(p,15,group).slot,"mixed");D.setScene(p,15,group,"slot",2);assert.equal(D.sceneState(p,15,group).slot,2);assert.equal(D.sceneState(p,15,group).mute,false);
  isolated(before,p.serialize(),new Map([[0xf9c,255],[0xfa2,255]]));p.setPatternSetTrack(15,6,"mute",true);assert.equal(D.sceneState(p,15,group).mute,"mixed");
  D.setScene(p,15,group,"mute",true);assert.equal(D.sceneState(p,15,group).mute,true);assert.equal(D.sceneState(p,15,other).slot,9);
  const saved=p.serialize();assert.throws(()=>D.setScene(p,15,group,"slot",64));assert.deepEqual(p.serialize(),saved);
  assert.throws(()=>D.setScene(p,15,{rows:[{track:0},{track:20}]},"slot",3));assert.deepEqual(p.serialize(),saved);
  D.setScene(p,15,group,"slot",null);assert.equal(D.sceneState(p,15,group).assigned,0);D.setScene(p,15,group,"slot",3);assert.equal(D.sceneState(p,15,group).mute,false);
});
