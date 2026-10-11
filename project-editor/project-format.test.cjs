"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const F = require("./project-format.js"), P = F.Project;
const {fixture} = require("../tests/project-fixtures.cjs");
const changedProject = P.parse(fixture); changedProject.setTrack(0,"channel",2);
const changed = Buffer.from(changedProject.serialize());
function load() { return P.parse(fixture); }
function bytes(p) { return Buffer.from(p.serialize()); }

test("synthetic projects round-trip byte-for-byte",function () {
  for (const input of [fixture,changed]) assert.ok(bytes(P.parse(input)).equals(input),"Export bytes changed");
  assert.equal(load().count,19);
});
test("MIDI channel edit changes only its packed field",function () {
  const p = load(); p.setTrack(0,"channel",2);
  assert.deepEqual(bytes(p).subarray(0xb4,0xf4),changed.subarray(0xb4,0xf4));
  const differences = [];
  bytes(p).forEach(function (v,i) { if (v!==fixture[i]) differences.push(i); });
  assert.deepEqual(differences,[0xbd]);
  assert.equal(P.parse(bytes(p)).track(0).channel,2);
});
test("all 16 channels and output ports preserve neighboring packed fields",function () {
  for (let channel = 1; channel <= 16; channel++) for (let port = 0; port < 6; port++) {
    const p = load(), original = p.header.slice();
    p.setTrack(0,"port",port); p.setTrack(0,"channel",channel);
    assert.equal(p.track(0).port,port); assert.equal(p.track(0).channel,channel);
    assert.equal(p.header[0xbd]&0x7f,original[0xbd]&0x7f);
    assert.deepEqual(p.header.slice(0xbe,0xc4),original.slice(0xbe,0xc4));
  }
});
// Construct expected paths from 4x4 geometry, independently of the codec tables.
function directionPaths() {
  const row = Array.from({length:16},(_,i)=>i), transpose = i=>(i%4)*4+Math.floor(i/4);
  const zigzag = row.map(i=>Math.floor(i/4)*4+(Math.floor(i/4)%2 ? 3-i%4 : i%4));
  const clockwise = [];
  for(let edge=0;edge<2;edge++) {
    for(let x=edge;x<4-edge;x++)clockwise.push(edge*4+x);
    for(let y=edge+1;y<4-edge;y++)clockwise.push(y*4+3-edge);
    for(let x=2-edge;x>=edge;x--)clockwise.push((3-edge)*4+x);
    for(let y=2-edge;y>edge;y--)clockwise.push(y*4+edge);
  }
  const paired = row.map(i=>(i&~3)+[0,2,1,3][i%4]);
  const paths = [row,row.map(transpose),zigzag,clockwise,clockwise.map(transpose),paired];
  return [...paths,...paths.map(path=>path.map(i=>(i&~3)+3-i%4))];
}
test("all 12 directions follow independently constructed grid paths",()=>{
  const paths=directionPaths();
  for(let code=0;code<12;code++) {
    assert.deepEqual(F.DIRECTIONS[code],paths[code]);
    assert.equal(new Set(paths[code]).size,16);
    for(let pages=1;pages<=4;pages++) {
      const p=P.create();p.addPattern(0,0);p.setPattern(0,0,"pages",pages);p.setPattern(0,0,"direction",code);
      const expected=Array.from({length:pages},(_,page)=>paths[code].map(step=>page*16+step)).flat().filter(step=>step%5!==2);
      for(let step=0;step<64;step++)if(step%5===2)p.setStep(0,0,step,"enabled",false);
      const page=p.pattern(0,0);
      expected.forEach((step,index)=>{
        assert.equal(page[0xe34+step],expected[(index+1)%expected.length]);
        assert.equal(page[0xe74+step],expected[(index+expected.length-1)%expected.length]);
      });
    }
  }
});
test("editing one note changes only that field and preserves opaque project/pattern bytes",function () {
  const p = load(); p.setNote(0,0,0,0,{pitch:61});
  const result = bytes(p), differences = [];
  result.forEach(function (v,i) { if (v!==fixture[i]) differences.push(i); });
  assert.deepEqual(differences,[4096+0x290]);
  assert.equal(P.parse(result).step(0,0,0).notes[0].pitch,61);
});
test("note toggles preserve dormant offsets, including multiple stored triggers",function () {
  const p = load(), page = p.pattern(0,0);
  p.setNote(0,0,1,7,{enabled:true,pitch:127,velocity:127,gate:511});
  assert.equal(p.step(0,0,1).notes[7].enabled,true);
  assert.equal(page[0x110+6]&128,128);
  page[0x110+6+5] |= 128;
  p.setNote(0,0,1,7,{enabled:false});
  assert.equal(p.step(0,0,1).notes[7].enabled,false);
  assert.equal(page[0x110+6]&128,128);assert.equal(page[0x110+6+5]&128,128);
  p.setNote(0,0,1,7,{enabled:true});assert.deepEqual(p.step(0,0,1).notes[7].offsets,[0,5]);
  p.setNote(0,0,1,7,{offset:3});assert.deepEqual(p.step(0,0,1).notes[7].offsets,[3]);
  assert.equal(p.step(0,0,0).notes[0].enabled,true);
});
test("CC activation stays independent of all eight note flags",function () {
  const p = load(), before = p.step(0,0,0).notes;
  for (let lane = 0; lane < 5; lane++) p.setCC(0,0,0,lane,lane*20,true);
  assert.equal(p.step(0,0,0).ccMask,31);
  assert.deepEqual(p.step(0,0,0).notes,before);
  p.setCC(0,0,0,2,0,false); assert.equal(p.step(0,0,0).ccMask,27);
});
test("skip and unskip update bitmaps and all forward/reverse traversal references",function () {
  const p = load(), page = p.pattern(0,0);
  p.setPattern(0,0,"direction",0); p.setStep(0,0,1,"enabled",false);
  assert.equal(F.u16(page,0x108),0xfffd);
  assert.equal(page[0xe34],2); assert.equal(page[0xe74+2],0);
  assert.equal(p.step(0,0,1).enabled,false);
  p.setStep(0,0,1,"enabled",true); assert.equal(F.u16(page,0x108),0xffff);
  assert.equal(page[0xe34],1);
});
test("all-skipped patterns have self-referencing traversal entries",function () {
  const p = load(), page = p.pattern(0,0);
  for (let step = 0; step < 64; step++) p.setStep(0,0,step,"enabled",false);
  for (let step = 0; step < 64; step++) {
    assert.equal(page[0xe34+step],step); assert.equal(page[0xe74+step],step);
  }
});
test("length edits retain notes beyond length while updating derived traversal",function () {
  const p = load(); p.setNote(0,0,63,0,{enabled:true,pitch:72});
  p.setPattern(0,0,"pages",4); p.setPattern(0,0,"direction",0);
  assert.equal(p.pattern(0,0)[0xe34+63],0);
  p.setPattern(0,0,"pages",1);
  assert.equal(p.step(0,0,63).notes[0].pitch,72);
  assert.equal(p.pattern(0,0)[0xe74+63],15);
});
test("adding and removing pages preserves track/slot order, occupancy and original pages",function () {
  const p = load(), original = p.pattern(0,0).slice();
  p.addPattern(0,2); p.addPattern(15,63,p.pattern(0,0)); assert.equal(p.count,21);
  const reparsed = P.parse(bytes(p));
  assert.deepEqual(reparsed.pattern(0,0),original);
  assert.deepEqual(reparsed.pattern(15,63),original);
  assert.equal(F.u16(reparsed.header,0x34+2*2),0xffff);
  reparsed.deletePattern(0,2); reparsed.deletePattern(15,63);
  // Removed sectors were already FFFF in these originally empty slots.
  assert.ok(bytes(reparsed).equals(fixture),"Add/remove round trip changed original bytes");
});
test("new projects are valid header-only containers with 16 V3 tracks and empty pattern sets",function () {
  const p = P.create("New sequence");
  assert.equal(p.count,0); assert.equal(bytes(p).length,4096);
  assert.equal(P.parse(bytes(p)).name,"New sequence");
  assert.equal(p.bpm,120);
  for (let t = 0; t < 16; t++) {
    assert.equal(p.track(t).port,3); assert.equal(p.track(t).channel,t+1);
    assert.equal(p.track(t).name,"Track "+String(t+1).padStart(2,"0"));
  }
  assert.ok(p.header.slice(0xeac,0xfac).every(function (v) { return v===255; }));
  p.addPattern(0,0); assert.equal(P.parse(bytes(p)).count,1);
});
test("new project defaults contain no inherited opaque fields or factory preset data",()=>{
  const p=P.create("Explicit defaults"),reparsed=P.parse(p.serialize());
  assert.ok(p.header.slice(0xfb2).every(value=>value===0));
  assert.equal(F.u16(p.header,0x26),0);assert.equal(F.u32(p.header,0x28),0xffffffff);
  for(let t=0;t<16;t++) {
    const info=reparsed.track(t);
    assert.equal(info.selectedPattern,0);assert.equal(info.mute,false);assert.equal(info.solo,false);assert.equal(info.mono,false);
    assert.equal(p.header[0xb4+t*0xe8+0x0a]&7,1);
    assert.deepEqual(info.harmonizer,[[4,7,0,0],[3,7,0,0],[4,7,10,0],[3,7,10,0],[4,7,11,0],[3,7,10,14]]);
  }
});
test("edits reject invalid values atomically, including inactive invalid notes",function () {
  const p = load(), original = bytes(p);
  for (const patch of [{pitch:128},{gate:512},{velocity:-1},{pitch:61,gate:999}]) {
    assert.throws(function () { p.setNote(0,0,0,0,patch); });
    assert.ok(bytes(p).equals(original),"Invalid edit changed project bytes");
  }
  assert.throws(function () { p.name=""; }); assert.throws(function () { p.name="🎹"; });
  assert.throws(function () { p.bpm=301; }); assert.throws(function () { p.setTrack(0,"delay",64); });
  assert.throws(function () { p.setTrack(0,"channel",17); });
  assert.throws(function () { p.addPattern(0,0); });
  p.pattern(0,0)[0x290+32]=255;
  assert.throws(function () { p.setNote(0,0,1,0,{enabled:true}); });
});
test("malformed, unsupported, truncated and appended containers fail before loading",function () {
  for (const input of [fixture.subarray(0,10),fixture.subarray(0,fixture.length-4096),Buffer.concat([fixture,Buffer.alloc(4096)])])
    assert.throws(function () { P.parse(input); });
  const bad = Buffer.from(fixture); bad[3]=5; assert.throws(function () { P.parse(bad); });
  const word = Buffer.from(fixture); word[4096+11]|=1;const recovered=P.parse(word);
  assert.ok(bytes(recovered).equals(word));assert.match(recovered.warnings.join(" "),/unknown low step flags/);
});
test("known step controls edit only their respective packed fields",function () {
  const p = load();
  p.setStep(0,0,0,"count",4); p.setStep(0,0,0,"divide",3); p.setStep(0,0,0,"slide",true);
  p.setStep(0,0,0,"transpose",16);
  const s = P.parse(bytes(p)).step(0,0,0);
  assert.equal(s.count,4); assert.equal(s.divide,3); assert.equal(s.slide,true); assert.equal(s.transpose,16);
  assert.equal(s.notes[0].enabled,true); assert.equal(s.notes[0].pitch,60);
});
test("all new tracks have uniform CC/default fields and zero reserved bytes",()=>{
  const p=P.create();
  for(let t=0;t<16;t++){
    assert.deepEqual(p.track(t).ccNumbers,[0,1,2,3,4]);assert.equal(p.track(t).mute,false);assert.equal(p.track(t).solo,false);
    assert.ok(p.header.slice(0xb4+t*0xe8+0x40,0xb4+t*0xe8+0x60).every(v=>v===0));
  }
});
test("packed CC assignments and mute/solo edits preserve routing and adjacent bits",()=>{
  const p=load(),before=p.track(0),header=p.header.slice();
  p.setTrack(0,"mute",true);p.setTrack(0,"solo",true);
  assert.equal(p.header[0xbd],header[0xbd]|96);
  for(let lane=0;lane<5;lane++)p.setTrack(0,"cc"+lane,127-lane);
  const info=P.parse(p.serialize()).track(0);assert.deepEqual(info.ccNumbers,[127,126,125,124,123]);
  assert.equal(info.port,before.port);assert.equal(info.channel,before.channel);assert.equal(info.mute,true);assert.equal(info.solo,true);
  assert.deepEqual(p.header.slice(0xc4),header.slice(0xc4));
});
test("all track colors round-trip while changing only their four packed bits",()=>{
  const p=load();p.setTrack(0,"channel",2);p.setTrack(0,"mute",true);p.setTrack(0,"solo",true);
  const before=p.serialize(),original=p.track(0);
  for(let color=0;color<16;color++){
    p.setTrack(0,"color",color);const after=p.serialize(),info=P.parse(after).track(0);
    assert.equal(info.color,color);assert.deepEqual({...info,color:original.color},original);
    for(let i=0;i<after.length;i++)assert.equal((after[i]^before[i])&~(i===0xbd ? 0x1e : 0),0,"Byte 0x"+i.toString(16));
  }
  for(const value of [-1,16,1.5,"",NaN]){const before=p.serialize();assert.throws(()=>p.setTrack(0,"color",value));assert.deepEqual(p.serialize(),before);}
  const fresh=P.create();for(let t=0;t<16;t++)assert.equal(fresh.track(t).color,t);
  p.header[0xb4+6]=49;assert.equal(p.track(0).color,null);assert.throws(()=>p.setTrack(0,"color",0),/V3/);
});
test("invalid stored tempo uses a visible fallback and retains original bytes",()=>{
  const input=Buffer.from(fixture);input[0xfb0]=255;input[0xfb1]=255;const p=P.parse(input);
  assert.equal(p.bpm,120);assert.match(p.warnings[0],/120 BPM fallback/);assert.ok(bytes(p).equals(input));
  p.bpm=98.4;assert.equal(P.parse(bytes(p)).bpm,98.4);
  for(const value of ["",NaN,"abc",null])assert.throws(()=>p.bpm=value);
});
test("step clipboard copies all stored musical fields and repairs skip traversal",()=>{
  const p=load();p.setNote(0,0,0,0,{offset:4});p.setCC(0,0,0,2,91,true);p.setStep(0,0,0,"enabled",false);
  p.pasteStep(1,0,1,p.copyStep(0,0,0));assert.deepEqual(p.copyStep(1,0,1),p.copyStep(0,0,0));
  assert.equal(p.step(1,0,1).notes[0].offset,4);assert.equal(F.u16(p.pattern(1,0),0x108)&2,0);
});
test("cross-track pattern copy/move preserves the full page and rejects occupied targets",()=>{
  const p=load(),source=p.pattern(0,0).slice();p.transferPattern(0,0,1,63,false);assert.deepEqual(p.pattern(1,63),source);
  assert.throws(()=>p.transferPattern(0,0,1,63,true));assert.deepEqual(p.pattern(0,0),source);
  p.transferPattern(1,63,15,63,true);assert.equal(p.patterns[1].has(63),false);assert.deepEqual(P.parse(p.serialize()).pattern(15,63),source);
});
