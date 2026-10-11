/* Scope and destination planning. No UI, no mutation of the source project. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./project-format.js'),require('./generators.js'));else root.SquidGeneratorPlan=factory(root.SquidProject,root.SquidGenerators);})(typeof globalThis!=='undefined'?globalThis:this,function(F,G){
  'use strict';
  const DRUM_PRESETS=[
    {id:'floor',name:'Four-on-the-floor groove',description:'Quarter pulses, backbeats and eighth pulses. Bind the rhythmic roles to your own sounds.',roles:['quarter','backbeat','eighth','offbeat']},
    {id:'backbeat',name:'Backbeat groove',description:'A steady pulse with a backbeat and a syncopated supporting lane.',roles:['quarter','backbeat','eighth','tresillo']},
    {id:'half',name:'Half-time groove',description:'A slower backbeat with space between supporting hits.',roles:['half-pulse','half-backbeat','eighth','offbeat']},
    {id:'broken',name:'Broken beat',description:'Interlocking syncopated rhythms with velocity variation.',roles:['tresillo','backbeat','euclidean','offbeat']},
    {id:'euclidean',name:'Euclidean lanes',description:'Evenly spread pulses with different densities and rotations.',roles:['euclidean','euclidean','euclidean','euclidean']},
    {id:'fill',name:'Fill / variation',description:'A denser seeded variation. Keep pitch or articulation to retain your existing character.',roles:['variation','variation','variation','variation']}
  ];
  const ROLES=[['quarter','Quarter pulse'],['backbeat','Backbeat'],['half-pulse','Half-time pulse'],['half-backbeat','Half-time backbeat'],['eighth','Eighth pulse'],['offbeat','Offbeat'],['tresillo','3 + 3 + 2'],['euclidean','Euclidean'],['variation','Seeded variation'],['custom','Custom rhythm']];
  function context(project,t,n=0){
    const name=project.track(t).name;
    if(/^dr_/i.test(name))return {type:'single',name:name+' · eight note lanes',lanes:Array.from({length:8},(_,i)=>({track:t,note:i,name:'Note '+(i+1),selected:i===n}))};
    const match=/^dr([1-9]\d*)_/i.exec(name);
    if(match){const prefix=new RegExp('^dr'+match[1]+'_','i');return {type:'group',name:'Drum group '+match[1],lanes:Array.from({length:16},(_,i)=>({track:i,note:0,name:'T'+(i+1)+' · '+project.track(i).name.replace(prefix,''),selected:i===t})).filter(r=>prefix.test(project.track(r.track).name))};}
    return {type:'regular',name:'T'+(t+1)+' · '+name,lanes:[]};
  }
  function laneInfo(project,lane,s){const notes=[];if(project.patterns[lane.track].has(s))for(let st=0;st<64;st++){const note=project.step(lane.track,s,st).notes[lane.note];if(note.enabled)notes.push(note);}
    return {pitch:notes.length?notes[0].pitch:60,varied:new Set(notes.map(n=>n.pitch)).size>1,empty:!notes.length};}
  function commonEmpty(project,lanes){return Array.from({length:64},(_,s)=>s).find(s=>lanes.every(l=>!project.patterns[l.track].has(s)));}
  function sourceEvents(project,t,s,n){const notes=[];if(!project.patterns[t].has(s))return notes;for(let st=0;st<64;st++)project.step(t,s,st).notes.forEach((v,i)=>{if(v.enabled&&(n===undefined||i===n))notes.push({time:st+v.offset/6,pitch:v.pitch,velocity:v.velocity,duration:(v.gate+1)/8});});return notes;}
  function roleConfig(role,index,base){const period={quarter:4,backbeat:8,'half-pulse':8,'half-backbeat':16,eighth:2,offbeat:4}[role];
    if(period)return {rhythm:'pulse',period,rotation:role==='backbeat'?4:role==='half-backbeat'?8:role==='offbeat'?2:0};
    if(role==='tresillo')return {rhythm:'tresillo',rotation:0};if(role==='variation')return {rhythm:'random'};
    if(role==='euclidean')return {rhythm:'euclidean',rotation:index%4};return {};
  }
  function prepare(project,request){
    const {sourceTrack,sourceSlot,targetTrack=sourceTrack,targetSlot=sourceSlot,mode='replace',config={},lanes=[],enableSkipped=false,changeLength=false,replacePitch=false}=request;
    if(!Number.isInteger(targetSlot)||targetSlot<0||targetSlot>63)throw new Error('Pattern slot must be 1–64.');
    if(config.offset!==undefined&&(!Number.isInteger(config.offset)||config.offset<0||config.offset>5))throw new Error('Offset must be 0–5 sixths of a step.');
    if(config.gate!==undefined&&!Number.isInteger(config.gate*8))throw new Error('Gate must use eighths of a step.');
    const ctx=context(project,sourceTrack),drum=ctx.type!=='regular';
    if(drum&&!lanes.length)throw new Error('Choose at least one lane or member.');
    const valid=new Set(ctx.lanes.map(l=>l.track+':'+l.note));if(drum&&lanes.some(l=>!valid.has(l.track+':'+l.note)))throw new Error('A chosen lane is outside this drum view.');
    if(!['replace','merge','new'].includes(mode))throw new Error('Choose an apply mode.');
    const targets=drum?lanes:[{track:targetTrack,name:project.track(targetTrack).name}];
    if(new Set(targets.map(l=>l.track+':'+(l.note??'*'))).size!==targets.length)throw new Error('Each lane may appear only once.');
    if(mode==='new'&&targets.some(l=>project.patterns[l.track].has(targetSlot)))throw new Error(drum?'New patterns need a common empty slot across all chosen members.':'Choose an empty pattern slot.');
    const next=F.Project.parse(project.serialize()),report={notes:0,collisions:0,skipped:0,outside:0,activated:0,lengthChanges:0,rows:[]},events=[];
    for(let i=0;i<targets.length;i++){
      const lane=targets[i],t=lane.track,source=sourceEvents(project,drum?t:sourceTrack,sourceSlot,drum?lane.note:undefined);
      const cfg={...G.DEFAULTS,...config,...(drum?roleConfig(lane.role,ctx.lanes.findIndex(r=>r.track===lane.track&&r.note===lane.note),config):{}),...(drum?{melody:'root',root:lane.pitch,span:0,invert:false,seed:String(config.seed)+':'+t+':'+lane.note}: {})};
      if(drum&&lane.pulses!==undefined)cfg.pulses=lane.pulses;if(drum&&lane.rotation!==undefined)cfg.rotation+=lane.rotation;for(const key of ["accent","humanize"])if(drum&&lane[key]!==undefined)cfg[key]=lane[key];
      if(drum&&cfg.lockPitch)cfg.lockPitch=false; // Fixed identity uses the exact source lane below, including dormant values.
      const generated=G.generate(cfg,source);if(!next.patterns[t].has(targetSlot))next.addPattern(t,targetSlot);
      const original=new F.Project(next.header,next.patterns.map((bank,index)=>index===t?new Map([[targetSlot,next.pattern(t,targetSlot).slice()]]):bank)),p=next.pattern(t,targetSlot),length=(p[4]&15)*16,fx=next.effects(t,targetSlot),row={...lane,slot:targetSlot,length,fixedLength:fx.fixed?fx.fixedSteps:null,hits:[],collisions:0,skipped:0,outside:0};
      if(mode!=='merge')for(let st=0;st<cfg.length;st++)for(const n of drum?[lane.note]:Array.from({length:8},(_,n)=>n))next.setNote(t,targetSlot,st,n,{enabled:false});
      if(changeLength){next.setPattern(t,targetSlot,'pages',Math.ceil(cfg.length/16));if(fx.fixed||cfg.length%16)next.setPattern(t,targetSlot,'fixedLength',cfg.length);row.length=Math.ceil(cfg.length/16)*16;row.fixedLength=(fx.fixed||cfg.length%16)?cfg.length:null;report.lengthChanges+=length!==Math.ceil(cfg.length/16)*16||fx.fixed&&fx.fixedSteps!==cfg.length?1:0;}
      for(const note of generated.notes){const st=Math.floor(note.time),old=original.step(t,targetSlot,st),data=next.step(t,targetSlot,st),n=drum?lane.note:data.notes.findIndex(v=>!v.enabled);
        if(drum&&mode==='merge'&&old.notes[n].enabled){row.collisions++;report.collisions++;continue;}
        if(n<0)throw new Error('Merge exceeds eight notes at step '+(st+1)+'.');
        const stored=old.notes[n],src=project.patterns[drum?t:sourceTrack].has(sourceSlot)?project.step(drum?t:sourceTrack,sourceSlot,st).notes[drum?lane.note:n]:null;
        const keepPitch=drum&&!replacePitch&&(config.lockPitch?src&&(src.enabled||src.offsets.length):stored.enabled||stored.offsets.length);
        const patch={enabled:true,pitch:keepPitch?(config.lockPitch?src:stored).pitch:note.pitch,velocity:note.velocity,gate:Math.max(0,Math.min(511,Math.round(note.duration*8)-1))};
        if(drum&&config.lockArticulation&&src&&(src.enabled||src.offsets.length)){
          patch.velocity=src.velocity;patch.gate=src.gate;
        }else patch.offset=config.offset!==undefined&&!config.lockArticulation?config.offset:Math.round((note.time-st)*6);
        next.setNote(t,targetSlot,st,n,patch);
        if(drum&&config.lockArticulation&&src&&(src.enabled||src.offsets.length)){
          const sourcePattern=project.pattern(t,sourceSlot),destPattern=next.pattern(t,targetSlot);for(let off=0;off<6;off++){const at=0x110+st*6+off,bit=1<<n;destPattern[at]=(destPattern[at]&~bit)|(sourcePattern[at]&bit);}
        }
        if(!old.enabled){if(enableSkipped){next.setStep(t,targetSlot,st,'enabled',true);report.activated++;}else{row.skipped++;report.skipped++;}}
        if(st>=(changeLength?Math.ceil(cfg.length/16)*16:length)||fx.fixed&&st>=(changeLength?cfg.length:fx.fixedSteps)){row.outside++;report.outside++;}
        row.hits.push({step:st,...next.step(t,targetSlot,st).notes[n],skipped:!next.step(t,targetSlot,st).enabled});report.notes++;
        const v=next.step(t,targetSlot,st).notes[n];if(!row.hits.at(-1).skipped&&st<row.length&&(!fx.fixed||st<(changeLength?cfg.length:fx.fixedSteps)))events.push({time:st+v.offset/6,pitch:v.pitch,velocity:v.velocity,duration:(v.gate+1)/8});
      }
      // The preview includes retained merge hits, rather than presenting them as deleted.
      row.result=[];for(let st=0;st<cfg.length;st++){const d=next.step(t,targetSlot,st);for(const [n,v] of d.notes.entries())if(v.enabled&&(!drum||n===lane.note))row.result.push({step:st,...v,skipped:!d.enabled});}
      report.rows.push(row);
    }
    report.otherNotesActivated=0;report.ccActivated=0;report.retainedNotesExposed=0;report.retainedNotesHidden=0;
    for(const t of new Set(targets.map(l=>l.track))){if(!project.patterns[t].has(targetSlot))continue;
      const oldFx=project.effects(t,targetSlot),newFx=next.effects(t,targetSlot),oldLength=Math.min((project.pattern(t,targetSlot)[4]&15)*16,oldFx.fixed?oldFx.fixedSteps:64),newLength=Math.min((next.pattern(t,targetSlot)[4]&15)*16,newFx.fixed?newFx.fixedSteps:64),targetNotes=new Set(targets.filter(l=>l.track===t).map(l=>l.note));
      for(let st=0;st<64;st++){const old=project.step(t,targetSlot,st),now=next.step(t,targetSlot,st);
        if(!old.enabled&&now.enabled){report.ccActivated+=old.ccMask.toString(2).replace(/0/g,'').length;report.otherNotesActivated+=old.notes.filter((n,i)=>n.enabled&&drum&&!targetNotes.has(i)).length;}
        const retained=old.notes.filter((n,i)=>n.enabled&&(st>=(config.length??G.DEFAULTS.length)||drum&&!targetNotes.has(i))).length;
        if(st>=oldLength&&st<newLength)report.retainedNotesExposed+=retained;if(st<oldLength&&st>=newLength)report.retainedNotesHidden+=retained;
      }
    }
    return {bytes:next.serialize(),selection:[targets[0].track,targetSlot,0],report,events:{notes:events}};
  }
  return {context,laneInfo,commonEmpty,sourceEvents,prepare,DRUM_PRESETS,ROLES};
});
