/* Composable, deterministic generators. Built-ins emit ordinary note events;
   future custom generators can use the same validated conversion boundary. */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.SquidGenerators=factory();})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const SCALES={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],dorian:[0,2,3,5,7,9,10],mixolydian:[0,2,4,5,7,9,10],pentatonic:[0,2,4,7,9],blues:[0,3,5,6,7,10],chromatic:[0,1,2,3,4,5,6,7,8,9,10,11]};
  const registry=new Map();
  const DEFAULTS={length:16,pulses:5,period:3,period2:4,rhythm:"euclidean",melody:"walk",scale:"minor",root:48,span:24,gate:1,velocity:100,accent:12,humanize:0,rotation:0,invert:false,reverse:false,lockRhythm:false,lockPitch:false,lockArticulation:false,seed:"1",progression:"1,6,4,5"};
  const PRESETS=[
    ["euclidean-melody","Euclidean minor melody","Five evenly spread notes in one bar; a repeatable melodic walk.",{}],
    ["kick","Drums · Four on the floor","Four quarter-note kicks, MIDI 36. One bar.",{rhythm:"pulse",period:4,melody:"root",root:36,span:0,gate:.5,velocity:110,accent:0}],
    ["backbeat","Drums · Backbeat","Snare on beats two and four, MIDI 38. One bar.",{rhythm:"pulse",period:8,rotation:4,melody:"root",root:38,span:0,gate:.25,velocity:100,accent:0}],
    ["hats","Drums · Eighth-note hats","Closed hats, MIDI 42, with gentle accents and velocity variation.",{rhythm:"pulse",period:2,melody:"root",root:42,span:0,gate:.125,velocity:76,accent:14,humanize:4}],
    ["offbeat-hats","Drums · Offbeat open hats","Open hats between the beats, MIDI 46.",{rhythm:"pulse",period:4,rotation:2,melody:"root",root:46,span:0,gate:.75,velocity:82,accent:0}],
    ["tresillo","Rhythm · Tresillo","A repeating 3+3+2 rhythm across each bar.",{rhythm:"tresillo",melody:"root",root:60,gate:.5,velocity:96,accent:12}],
    ["poly","Rhythm · Three against four","Combine pulses every three and four steps. Two bars.",{length:32,rhythm:"polyrhythm",period:3,period2:4,melody:"root",root:60,gate:.5,velocity:96,accent:8}],
    ["bass","Bass · Minor progression","Four bars of a syncopated bassline following i–VI–iv–v.",{length:64,pulses:24,melody:"bass",root:36,span:12,gate:.75,velocity:96,accent:16,humanize:3}],
    ["busy-bass","Bass · Busy minor walk","A short, dense bass pattern with changing accents.",{pulses:13,melody:"walk",root:36,span:12,gate:.5,velocity:94,accent:22,humanize:6}],
    ["pentatonic","Melody · Pentatonic","Seven notes across one bar, spanning two octaves.",{pulses:7,melody:"random",scale:"pentatonic",root:60,span:24,gate:1.5,velocity:84,accent:8,humanize:4,progression:"1,4,2,5"}],
    ["motif","Melody · Repeating motif","A scale-degree motif over evenly spaced eighth notes.",{length:32,rhythm:"pulse",period:2,melody:"motif",root:60,span:12,gate:1,velocity:88,accent:10}],
    ["minor-chords","Harmony · Minor progression","One triad per bar: i–VI–iv–v. Four bars.",{length:64,rhythm:"pulse",period:16,melody:"chords",root:48,span:24,gate:15.875,velocity:80,accent:0}],
    ["major-voicings","Harmony · Smooth major chords","Four bars of I–vi–IV–V with nearby chord voicings.",{length:64,rhythm:"pulse",period:16,melody:"voice-leading",scale:"major",root:48,span:24,gate:15.875,velocity:80,accent:0}],
    ["arp","Arpeggio · Major ascent","Sixteenth-note arpeggios with space between notes. Two bars.",{length:32,rhythm:"pulse",period:1,melody:"arp",scale:"major",root:60,span:24,gate:.75,velocity:86,accent:10,humanize:3}],
    ["ambient","Harmony · Sparse ambient","Long minor chords appearing probabilistically over four bars.",{length:64,rhythm:"random",pulses:5,melody:"voice-leading",root:48,span:24,gate:8,velocity:64,accent:0,humanize:6}]
  ].map(([id,name,description,config])=>Object.freeze({id,name,description,config:Object.freeze({...DEFAULTS,...config,seed:id})}));
  function random(seed){let n=2166136261;for(const c of String(seed)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return function(){n+=0x6d2b79f5;let t=n;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
  const mod=(n,m)=>((n%m)+m)%m,clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function register(name,generate){if(registry.has(name))throw new Error("Generator already registered.");registry.set(name,generate);}
  register("euclidean",({length,pulses})=>Array.from({length},(_,i)=>pulses>0 && (i*pulses)%length<pulses));
  register("random",({length,pulses},rng)=>Array.from({length},()=>rng()<pulses/length));
  register("polyrhythm",({length,period,period2})=>Array.from({length},(_,i)=>i%period===0||i%period2===0));
  register("pulse",({length,period})=>Array.from({length},(_,i)=>i%period===0));
  register("tresillo",({length})=>Array.from({length},(_,i)=>[0,6,12].includes(i%16)));
  function generate(config,source=[]){
    const c={...DEFAULTS,...config};
    for(const [key,min,max] of [["length",1,64],["pulses",0,64],["period",1,64],["period2",1,64],["root",0,127],["span",0,48],["gate",0.125,64],["velocity",1,127],["accent",0,64],["humanize",0,32],["rotation",-64,64]])
      if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw new Error(key+" is outside "+min+"–"+max+".");
    if(!Number.isInteger(c.length)||!Number.isInteger(c.pulses)||!Number.isInteger(c.period)||!Number.isInteger(c.period2))throw new Error("Rhythm lengths must be whole numbers.");
    for(const key of ["root","span","rotation"])if(!Number.isInteger(c[key]))throw new Error(key+" must be a whole number.");
    c.pulses=Math.min(c.pulses,c.length);
    const rng=random(c.seed),scale=SCALES[c.scale];if(!scale)throw new Error("Unknown scale.");
    const rhythm=registry.get(c.rhythm);if(!rhythm)throw new Error("Unknown rhythm generator.");
    const pitches=[];for(let p=c.root;p<=Math.min(127,c.root+c.span);p++)if(scale.includes(mod(p-c.root,12)))pitches.push(p);
    const degree=n=>c.root+scale[mod(n,scale.length)]+12*Math.floor(n/scale.length);
    const progression=String(c.progression).split(",").map(n=>Number(n.trim())-1);
    if(progression.some(n=>!Number.isInteger(n)||n<0||n>=scale.length))throw new Error("Progression degrees must be 1–"+scale.length+", separated by commas.");
    const sourceAt=step=>source.filter(n=>Math.floor(n.time)===step);
    let hits=c.lockRhythm ? Array.from({length:c.length},(_,i)=>sourceAt(i).length>0) : rhythm(c,rng);
    const notes=[];let walk=Math.floor(pitches.length/2),index=0,previousChord=[];
    for(let s=0;s<c.length;s++){
      if(!hits[s])continue;
      const saved=sourceAt(s),d=progression[Math.floor(s/16)%progression.length];let chord;
      if(c.lockPitch && saved.length)chord=saved.map(n=>n.pitch);
      else if(c.melody==="root")chord=[c.root];
      else if(c.melody==="bass")chord=[degree(d)];
      else if(c.melody==="walk"){walk=clamp(walk+Math.floor(rng()*5)-2,0,pitches.length-1);chord=[pitches[walk]];}
      else if(c.melody==="random")chord=[pitches[Math.floor(rng()*pitches.length)]];
      else if(c.melody==="motif")chord=[degree([0,2,4,1,0,4,3,2][index%8])];
      else if(c.melody==="arp")chord=[degree(d+[0,2,4,7][index%4])];
      else if(c.melody==="chords" || c.melody==="voice-leading"){
        chord=[degree(d),degree(d+2),degree(d+4)];
        if(c.melody==="voice-leading" && previousChord.length)chord=chord.map((p,i)=>{
          const candidates=[p-24,p-12,p,p+12,p+24].filter(p=>p>=c.root && p<=Math.min(127,c.root+Math.max(c.span,12)));
          return candidates.sort((a,b)=>Math.abs(a-previousChord[i])-Math.abs(b-previousChord[i]))[0]??p;
        });previousChord=chord;
      } else throw new Error("Unknown pitch generator.");
      for(let j=0;j<chord.length;j++){
        let pitch=chord[j];if(c.invert && !(c.lockPitch&&saved.length))pitch=c.root*2-pitch;
        if(pitch<0||pitch>127)throw new Error("Generated pitch exceeds MIDI range; adjust root, span or inversion.");
        const original=saved[j];let time=mod((c.reverse ? c.length-1-s : s)+c.rotation,c.length);
        const duration=c.lockArticulation&&original ? original.duration : c.gate;
        const velocity=c.lockArticulation&&original ? original.velocity : clamp(Math.round(c.velocity+(s%4===0?c.accent:0)+(rng()*2-1)*c.humanize),1,127);
        if(c.lockArticulation&&original)time+=original.time-Math.floor(original.time);
        notes.push({time,duration,pitch,velocity,channel:0});
      }index++;
    }
    return {name:"Generated pattern",notes:notes.sort((a,b)=>a.time-b.time||a.pitch-b.pitch),cc:[],end:c.length,seed:c.seed};
  }
  return {SCALES,DEFAULTS,PRESETS,register,generate,random};
});
