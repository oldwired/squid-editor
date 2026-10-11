/* Standard MIDI Files and SQUID note-event conversion. No device access. */
(function(root,factory){ if(typeof module==="object" && module.exports) module.exports=factory(require("./project-format.js")); else root.SquidMusic=factory(root.SquidProject); })(typeof globalThis!=="undefined"?globalThis:this,function(F){
  "use strict";
  const PPQN=480, encoder=new TextEncoder(), decoder=new TextDecoder();
  const check=(n,min,max,label)=>{if(!Number.isFinite(n)||n<min||n>max)throw new Error(label+" is outside "+min+"–"+max+".");return n;};
  function readSMF(input){
    const b=Uint8Array.from(input), view=new DataView(b.buffer); let at=0,totalEvents=0;
    if(b.length>8*1024*1024)throw new Error("MIDI files are limited to 8 MiB.");
    function need(n,end=b.length){if(at+n>end)throw new Error("Truncated MIDI file.");}
    function byte(end){need(1,end);return b[at++];}
    function word(){need(2);const n=view.getUint16(at);at+=2;return n;}
    function long(){need(4);const n=view.getUint32(at);at+=4;return n;}
    function tag(){need(4);const s=String.fromCharCode(...b.slice(at,at+4));at+=4;return s;}
    function vlq(end){let n=0;for(let i=0;i<4;i++){const v=byte(end);n=n*128+(v&127);if(!(v&128))return n;}throw new Error("Invalid MIDI variable-length number.");}
    if(tag()!=="MThd")throw new Error("Choose a Standard MIDI File (.mid).");
    const header=long();if(header<6)throw new Error("Invalid MIDI header.");need(header);
    const format=word(),count=word(),division=word();at+=header-6;
    if(format>1 || (format===0 && count!==1) || !count)throw new Error("MIDI formats 0 and 1 are supported.");
    if(!division || division&0x8000)throw new Error("SMPTE timing is unsupported; export the MIDI file with beat timing.");
    const tracks=[],tempos=[],warnings=[];
    for(let t=0;t<count;t++){
      if(tag()!=="MTrk")throw new Error("Missing MIDI track chunk.");
      const length=long();need(length);const end=at+length,track={name:"Track "+(t+1),notes:[],cc:[],end:0};
      let tick=0,running=0,ignored=0;const held=new Map();
      while(at<end){
        if(++totalEvents>200000)throw new Error("MIDI file has too many events.");
        tick+=vlq(end);let status=byte(end);
        if(status<128){if(!running)throw new Error("MIDI running status has no previous channel status.");at--;status=running;}
        if(status===255){
          running=0;const type=byte(end),n=vlq(end);need(n,end);
          if(type===3)track.name=decoder.decode(b.slice(at,at+n));
          if(type===81 && n===3){const micros=b[at]*65536+b[at+1]*256+b[at+2];if(micros)tempos.push({tick,bpm:60000000/micros});}
          at+=n;if(type===47){if(n!==0)throw new Error("Invalid end-of-track event.");at=end;}continue;
        }
        if(status===240 || status===247){running=0;const n=vlq(end);need(n,end);at+=n;ignored++;continue;}
        if(status>=240)throw new Error("Unsupported system event in MIDI file.");
        running=status;const type=status>>4,channel=status&15,a=byte(end),d=type===12 || type===13 ? 0 : byte(end);
        if(a>127 || d>127)throw new Error("Invalid MIDI channel data.");
        const key=channel+":"+a;
        if(type===9 && d){const list=held.get(key)||[];list.push({tick,pitch:a,velocity:d,channel});held.set(key,list);}
        else if(type===8 || type===9){const list=held.get(key);if(list && list.length){const note=list.shift();track.notes.push({...note,time:note.tick/division*4,duration:Math.max(1,tick-note.tick)/division*4});}}
        else if(type===11)track.cc.push({time:tick/division*4,channel,controller:a,value:d});
        else ignored++;
      }
      track.end=tick/division*4;
      for(const list of held.values())for(const note of list){track.notes.push({...note,time:note.tick/division*4,duration:Math.max(1,tick-note.tick)/division*4});warnings.push("Unclosed note in "+track.name+" ends at track end.");}
      if(ignored)warnings.push(track.name+": "+ignored+" program, pressure, pitch-bend or SysEx events will not be imported.");
      tracks.push(track);
    }
    if(at!==b.length)warnings.push("Trailing MIDI bytes were ignored.");
    tempos.sort((a,b)=>a.tick-b.tick);
    if(tempos.length>1)warnings.push("Tempo changes are present; SQUID stores one project tempo.");
    const groups=[];
    tracks.forEach((track,index)=>{const channels=new Set([...track.notes,...track.cc].map(e=>e.channel));
      for(const channel of channels)groups.push({name:track.name,sourceTrack:index,channel,notes:track.notes.filter(n=>n.channel===channel),cc:track.cc.filter(n=>n.channel===channel),end:track.end});});
    if(!groups.length)throw new Error("No notes or control changes were found.");
    return {format,division,tracks,groups,bpm:tempos.length ? tempos[0].bpm : 120,warnings};
  }
  function vlq(n){check(n,0,0x0fffffff,"MIDI delta time");n=Math.round(n);const out=[n&127];while((n=Math.floor(n/128)))out.unshift((n&127)|128);return out;}
  function be(n,size){return Array.from({length:size},(_,i)=>Math.floor(n/2**(8*(size-i-1)))&255);}
  function chunk(name,data){return [...encoder.encode(name),...be(data.length,4),...data];}
  function writeSMF(parts,bpm){
    check(bpm,30,300,"Tempo");if(!parts.length || parts.length>16)throw new Error("Choose 1–16 MIDI tracks.");
    const result=chunk("MThd",[0,parts.length===1 ? 0 : 1,...be(parts.length,2),...be(PPQN,2)]);
    parts.forEach((part,index)=>{
      const events=[];const name=Array.from(encoder.encode(part.name||"SQUID"));events.push({tick:0,order:-3,data:[255,3,...vlq(name.length),...name]});
      if(index===0)events.push({tick:0,order:-2,data:[255,81,3,...be(Math.round(60000000/bpm),3)]});
      for(const n of part.notes){
        check(n.pitch,0,127,"Pitch");check(n.velocity,0,127,"Velocity");check(n.time,0,1000000,"Note time");check(n.duration,0.001,1000000,"Duration");
        const ch=n.channel??part.channel??0;check(ch,0,15,"Channel");
        const on=Math.round(n.time*120),off=Math.max(on+1,Math.round((n.time+n.duration)*120));
        if(!n.velocity)continue;
        events.push({tick:on,order:1,data:[144|ch,n.pitch,n.velocity]},{tick:off,order:0,data:[128|ch,n.pitch,0]});
      }
      for(const c of part.cc||[]){check(c.controller,0,127,"CC number");check(c.value,0,127,"CC value");events.push({tick:Math.round(c.time*120),order:-1,data:[176|(c.channel??part.channel??0),c.controller,c.value]});}
      events.sort((a,b)=>a.tick-b.tick||a.order-b.order);
      let tick=0;const data=[];for(const e of events){data.push(...vlq(e.tick-tick),...e.data);tick=e.tick;}
      data.push(...vlq(Math.max(tick,Math.round((part.end||0)*120))-tick),255,47,0);
      result.push(...chunk("MTrk",data));
    });return Uint8Array.from(result);
  }
  function patternEvents(project,t,s){
    const p=project.pattern(t,s),track=project.track(t),fx=project.effects(t,s),nominal=(p[4]&15)*16;
    const end=fx.fixed && fx.fixedSteps>=1 && fx.fixedSteps<=64 ? Math.min(nominal,fx.fixedSteps) : nominal,notes=[],cc=[];
    for(let step=0;step<end;step++){
      const data=project.step(t,s,step);if(!data.enabled)continue;
      for(const note of data.notes)if(note.enabled)for(const offset of note.offsets.length ? note.offsets : [0])
        notes.push({time:step+offset/6,duration:(note.gate+1)/8,pitch:note.pitch,velocity:note.velocity,channel:(track.channel||1)-1});
      if(track.ccNumbers)for(let lane=0;lane<5;lane++)if(data.ccMask&(1<<lane))cc.push({time:step,controller:track.ccNumbers[lane],value:data.cc[lane],channel:track.channel-1});
    }
    return {name:track.name+" · Pattern "+(s+1),notes,cc,end,channel:(track.channel||1)-1};
  }
  // Dry-run every conversion on owned bytes. The UI applies the returned bytes
  // as one transaction, only after presenting diagnostics and destinations.
  function prepareImport(project,groups,options){
    const clone=F.Project.parse(project.serialize()),start=check(options.start,0,1000000,"Range start"),end=check(options.end,start+0.001,1000000,"Range end");
    const length=Math.ceil(end-start);if(!options.split && length>64)throw new Error("Select at most 64 steps, or enable splitting.");
    if(!Number.isInteger(start)||!Number.isInteger(end))throw new Error("Range boundaries must be whole steps.");
    const chunks=Math.ceil(length/64),report={notes:0,cc:0,patterns:0,quantized:0,clipped:0,gateClipped:0,targets:[]};
    if(!groups.length)throw new Error("Select at least one source.");
    const used=new Set();
    for(const group of groups){
      const t=check(group.targetTrack,0,15,"Destination track"),slot=check(group.targetSlot,0,63,"Destination pattern");
      if(!Number.isInteger(t)||!Number.isInteger(slot)||slot+chunks>64)throw new Error("Import would exceed the 64-slot bank.");
      const ccNumbers=Array.from(new Set((group.cc||[]).filter(c=>c.time>=start&&c.time<end).map(c=>c.controller)));
      if(ccNumbers.length>5)throw new Error(group.name+" uses more than five CC controllers in this range.");
      if(ccNumbers.length && !clone.track(t).isV3)throw new Error("CC import requires V3 track settings.");
      // Use existing assignments first; replacing assignments would affect all
      // other patterns on the destination track and must never happen silently.
      const assignments=clone.track(t).ccNumbers||[];
      const lanes=new Map(ccNumbers.map(number=>[number,assignments.indexOf(number)]));
      if(Array.from(lanes.values()).some(lane=>lane<0))throw new Error("Assign the source CC numbers ("+ccNumbers.join(", ")+") to destination track "+(t+1)+" first, or import notes only.");
      for(let i=0;i<chunks;i++){
        const key=t+":"+(slot+i);if(used.has(key))throw new Error("Two sources target the same pattern.");used.add(key);
        if(clone.patterns[t].has(slot+i)){if(!options.overwrite)throw new Error("Track "+(t+1)+", pattern "+(slot+i+1)+" is occupied. Choose empty slots or enable replacement.");clone.deletePattern(t,slot+i);}
        clone.addPattern(t,slot+i);clone.setPattern(t,slot+i,"pages",Math.max(1,Math.ceil(Math.min(64,length-i*64)/16)));
        const chunkLength=Math.min(64,length-i*64);if(chunkLength%16)clone.setPattern(t,slot+i,"fixedLength",chunkLength);
        report.patterns++;report.targets.push("T"+(t+1)+" P"+(slot+i+1));
      }
      for(const n of group.notes){
        if(n.time>=end || n.time+n.duration<=start)continue;
        const time=Math.max(start,n.time)-start,duration=Math.min(end,n.time+n.duration)-Math.max(start,n.time);
        if(n.time<start || n.time+n.duration>end)report.clipped++;
        const quant=options.quantize==="step" ? Math.round(time)*6 : Math.round(time*6);
        if(quant/6>=length) { report.clipped++;continue; }
        if(Math.abs(quant/6-time)>0.00001)report.quantized++;
        const step=Math.floor(quant/6),s=slot+Math.floor(step/64),local=step%64;
        const current=clone.step(t,s,local),empty=current.notes.findIndex(n=>!n.enabled);
        if(empty<0)throw new Error("More than eight notes land on track "+(t+1)+", pattern "+(s+1)+", step "+(local+1)+". Use a finer range or separate destinations.");
        const raw=Math.round(duration*8)-1;
        if(raw>511 || raw<0)report.gateClipped++;
        clone.setNote(t,s,local,empty,{enabled:true,pitch:n.pitch,velocity:n.velocity,gate:Math.max(0,Math.min(511,raw)),offset:quant%6});report.notes++;
      }
      for(const c of group.cc||[]){if(c.time<start||c.time>=end)continue;const step=Math.min(length-1,Math.round(c.time-start));
        clone.setCC(t,slot+Math.floor(step/64),step%64,lanes.get(c.controller),c.value,true);report.cc++;}
      if(options.channel)clone.setTrack(t,"channel",group.channel+1);
    }
    if(options.bpm!==undefined)clone.bpm=options.bpm;
    return {bytes:clone.serialize(),report};
  }
  function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
  function zip(files){
    const le=(n,size)=>Array.from({length:size},(_,i)=>Math.floor(n/2**(8*i))&255),parts=[],central=[];let offset=0;
    for(const file of files){const name=Array.from(encoder.encode(file.name)),data=file.bytes,crc=crc32(data);
      const local=[...le(0x04034b50,4),...le(20,2),...le(0x800,2),0,0,0,0,0,0,...le(crc,4),...le(data.length,4),...le(data.length,4),...le(name.length,2),0,0,...name];
      parts.push(Uint8Array.from(local),data);
      central.push(...le(0x02014b50,4),...le(20,2),...le(20,2),...le(0x800,2),0,0,0,0,0,0,...le(crc,4),...le(data.length,4),...le(data.length,4),...le(name.length,2),0,0,0,0,0,0,0,0,0,0,0,0,...le(offset,4),...name);
      offset+=local.length+data.length;
    }
    const footer=[...le(0x06054b50,4),0,0,0,0,...le(files.length,2),...le(files.length,2),...le(central.length,4),...le(offset,4),0,0];
    parts.push(Uint8Array.from(central),Uint8Array.from(footer));const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){result.set(part,at);at+=part.length;}return result;
  }
  return {readSMF,writeSMF,patternEvents,prepareImport,zip,crc32};
});
