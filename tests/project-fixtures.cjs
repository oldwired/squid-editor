"use strict";
// Synthetic regression data. No factory songs, captured headers or device files.
const F = require("../project-editor/project-format.js");
function createFixture() {
  const p = F.Project.create("Synthetic fixture");
  p.setTrack(0,"name","Kick"); p.setTrack(1,"name","Clap"); p.setTrack(8,"name","Bass");
  const slots = [...Array.from({length:16},(_,track)=>[track,0]),[0,1],[1,8],[8,1]];
  for (const [track,slot] of slots) {
    p.addPattern(track,slot);
    for (const step of [0,4,8,12]) p.setNote(track,slot,step,0,{enabled:true,pitch:60,velocity:127,gate:7});
  }
  p.setPatternSet(0,Array.from({length:16},(_,t)=>({slot:t===8 ? 1 : 0,mute:t!==0})));
  // Deliberately opaque bytes exercise preservation independently of defaults.
  p.header[0xfe0] = 0xa5; p.header[0xfff] = 0x5a;
  p.pattern(0,0)[0xf00] = 0x39; p.pattern(1,8)[0xfff] = 0xc7;
  return Buffer.from(p.serialize());
}
function transferFixture() {
  const p = F.Project.create("Synthetic transfer");
  p.addPattern(0,0); p.addPattern(5,9);
  p.setNote(0,0,0,0,{enabled:true,pitch:50,velocity:93,gate:5});
  p.setNote(5,9,7,0,{enabled:true,pitch:57,velocity:81,gate:13});
  return Buffer.from(p.serialize());
}
module.exports = {fixture:createFixture(),transferFixture};
