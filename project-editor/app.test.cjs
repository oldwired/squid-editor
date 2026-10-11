"use strict";
// Controller tests use a minimal in-memory DOM, not a browser or device.
// Downloads are captured as bytes, so export ordering can be checked directly.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const F = require("./project-format.js");
const {fixture,transferFixture} = require("../tests/project-fixtures.cjs");
function harness(withTools=false,extras={}) {
  const nodes = new Map(), events = {}, windowEvents = {}, exports = [], frames=new Map();let frameId=0;
  const flush=()=>{while(frames.size){const queued=Array.from(frames.values());frames.clear();queued.forEach(fn=>fn());}};
  let confirmationCount = 0;
  const doc = {getElementById:id=>nodes.get(id)&&nodes.get(id).isConnected ? nodes.get(id) : null, createElement:tag=>new Node(tag),
    querySelectorAll:selector=>Array.from(nodes.values()).filter(n=>n.isConnected&&(selector==="dialog[open]" ? n.tagName==="DIALOG"&&n.open : n.tagName==="INPUT"&&n.type==="number")),
    addEventListener:(name,handler)=>{events[name]=handler;}};
  function detach(node) {
    for (const child of node.children) detach(child);
    if (nodes.get(node.id)===node) nodes.delete(node.id);
  }
  class Node {
    constructor(tag) { this.tagName=tag.toUpperCase(); this.children=[]; this.attributes={}; this.dataset={}; this.value=""; this.checked=false;this.style={};this.handlers={}; }
    getBoundingClientRect(){const st=Number(this.id.replace(/^value-track-/,""))||0;return {left:st*30,right:st*30+25,top:100,bottom:200,height:100,width:25};}
    setPointerCapture(id){this.pointer=id;}
    hasPointerCapture(id){return this.pointer===id;}
    releasePointerCapture(){this.pointer=null;}
    set id(value) { this._id=value; nodes.set(value,this); }
    get id() { return this._id || ""; }
    get valueAsNumber() { return String(this.value).trim() ? Number(this.value) : NaN; }
    get parentElement() {return this.parent || {textContent:this.id};}
    get parentNode() {return this.parent;}
    get isConnected(){let node=this;while(node){if(node===doc.body)return true;node=node.parent;}return false;}
    getAttribute(name) {return this.attributes[name]||null;}
    dispatchEvent(event) {if(this["on"+event.type])this["on"+event.type](event);return true;}
    stepUp(){this.stepNumber(1);}
    stepDown(){this.stepNumber(-1);}
    stepNumber(direction){const unit=Number(this.step)||1,min=this.min===undefined ? -Infinity : Number(this.min),max=this.max===undefined ? Infinity : Number(this.max),base=Number.isFinite(min) ? min : 0,value=this.valueAsNumber;
      const next=Number.isFinite(value) ? base+(direction>0 ? Math.floor((value-base)/unit+1e-9)+1 : Math.ceil((value-base)/unit-1e-9)-1)*unit : base;
      const result=Math.max(min,Math.min(max,Number(next.toFixed(9))));if(result!==value)this.value=String(result);}
    addEventListener(name,fn){this.handlers[name]=fn;}
    setAttribute(name,value) { this.attributes[name]=String(value); }
    append(...children) { for (const child of children) { if(child.parent)child.parent.children=child.parent.children.filter(n=>n!==child);child.parent=this; this.children.push(child); } }
    insertBefore(child,before) {child.parent=this;this.children.splice(this.children.indexOf(before),0,child);}
    replaceChildren(...children) { this.children.forEach(detach); this.children=[]; this.append(...children); }
    querySelectorAll(selector) { if(selector==="input,select")return Array.from(nodes.values()).filter(n=>/^gen-/.test(n.id)&&["INPUT","SELECT"].includes(n.tagName));return this.children.filter(child=>child.dataset.unknown); }
    get lastElementChild() { return this.children[this.children.length-1]; }
    focus() { doc.activeElement=this; }
    blur() {
      if (doc.activeElement===this) doc.activeElement=doc.body;
      if (this.pendingChange) { this.pendingChange=false; if(this.onchange)this.onchange(); }
    }
    click() {
      if (this.disabled) return;
      const down={preventDefault(){this.prevented=true;}};if(this.onmousedown)this.onmousedown(down);
      if(!down.prevented){doc.activeElement.blur(); this.focus();}
      if (this.type==="checkbox") { this.checked=!this.checked; if(this.onchange)this.onchange(); }
      if (this.onclick) this.onclick({target:this,shiftKey:false});
      flush();
    }
    remove() { detach(this); }
    showModal() { this.open=true; }
    close() { this.open=false;if(this.handlers.close)this.handlers.close(); }
  }
  doc.body=new Node("body"); doc.activeElement=doc.body;
  const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
  for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node=new Node(match[1]); node.id=match[3]; node.hidden=/\bhidden\b/.test(match[2]);
    const type=match[2].match(/\btype="([^"]+)"/); if(type)node.type=type[1];
    for(const key of ["min","max","step","placeholder"]){const attr=match[2].match(new RegExp("\\b"+key+'="([^"]+)"'));if(attr)node[key]=attr[1];}
    const value=match[2].match(/\bvalue="([^"]+)"/);if(value)node.value=value[1];node.checked=/\schecked(?:\s|$)/.test(match[2]);
  }
  for(const match of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){const first=match[2].match(/<option\b[^>]*value="([^"]+)"/);if(first)nodes.get(match[1]).value=first[1];}
  doc.body.append(...nodes.values());
  const context=vm.createContext({document:doc, window:{SquidProject:F,SquidExample:{create:()=>F.Project.parse(fixture)},
    confirm:()=>{confirmationCount++; return false;}, addEventListener:(name,handler)=>{const previous=windowEvents[name];windowEvents[name]=previous?event=>{previous(event);handler(event);}:handler;},...extras},
    atob, Event, AbortController, setTimeout:()=>1, clearTimeout:()=>{},
    requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),
    Blob:class {constructor(parts){this.bytes=Buffer.concat(parts.map(part=>Buffer.from(part)));}},
    URL:{createObjectURL:blob=>{exports.push(blob.bytes);return "blob:test";},revokeObjectURL:()=>{}},
    getComputedStyle:node=>({gridTemplateColumns:Array(node.id==="pattern-bank"?16:4).fill("30px").join(" ")})});
  vm.runInContext(fs.readFileSync(path.join(__dirname,"number-controls.js"),"utf8"),context);
  if(withTools){context.window.SquidMusic=require("./music.js");context.window.SquidGenerators=require("./generators.js");context.window.SquidEditFunctions=require("./edit-functions.js");context.window.SquidGeneratorPlan=require("./generator-plan.js");
    vm.runInContext(fs.readFileSync(path.join(__dirname,"generator-tools.js"),"utf8"),context);
    for(const script of ["project-controls.js","transform-tools.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,script),"utf8"),context);
    for(const script of ["drum-overlay.js","value-chart.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,script),"utf8"),context);
    context.window.SquidDrums=context.SquidDrums;context.window.SquidValueChart=context.SquidValueChart;
    context.window.SquidHID=extras.SquidHID||require("./squid-hid.js");vm.runInContext(fs.readFileSync(path.join(__dirname,"hardware-tools.js"),"utf8"),context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,"workspace-tools.js"),"utf8"),context);}
  vm.runInContext(fs.readFileSync(path.join(__dirname,"app.js"),"utf8"),context);
  const get=id=>nodes.get(id);
  const edit=(id,value)=>{const node=get(id);node.focus();node.value=String(value);node.pendingChange=true;return node;};
  const key=(name,extra={})=>{const event={key:name,metaKey:false,ctrlKey:false,target:doc.activeElement,preventDefault(){this.prevented=true;this.defaultPrevented=true;},...extra};
    if(doc.activeElement.onkeydown)doc.activeElement.onkeydown(event); events.keydown(event);flush();return event;};
  return {get,edit,key,exports,events,windowEvents,doc,flush,confirmationCount:()=>confirmationCount};
}

test("the generated editor example opens and New constructs an independent empty project",()=>{
  const browser=vm.createContext({SquidProject:F});
  vm.runInContext(fs.readFileSync(path.join(__dirname,"example-project.js"),"utf8"),browser);
  const example=browser.SquidExample,h=harness(true,{SquidExample:example});
  h.get("save-project").click();assert.ok(h.exports[0].equals(Buffer.from(example.create().serialize())));
  h.get("new-project").click();h.get("save-project").click();const fresh=F.Project.parse(h.exports[1]);
  assert.equal(fresh.name,"Untitled project");assert.equal(fresh.count,1);
  assert.ok(fresh.header.slice(0xfb2).every(value=>value===0));
  assert.equal(fresh.step(0,0,0).notes.some(note=>note.enabled),false);
  for(let t=0;t<16;t++)assert.equal(fresh.track(t).channel,t+1);
  h.get("example-project").click();h.get("save-project").click();assert.ok(h.exports[2].equals(h.exports[0]));
});

test("projects open at stored starting patterns, including empty slots, without changing file bytes",async()=>{
  const p=F.Project.parse(fixture);p.setTrack(0,"selectedPattern",47);p.setTrack(1,"selectedPattern",63);p.addPattern(0,47);
  const bytes=Buffer.from(p.serialize()),h=harness(true,{SquidExample:{create:()=>F.Project.parse(bytes)}});
  assert.equal(h.get("pattern-label").textContent,"Pattern 48");assert.equal(h.get("track-start-pattern").value,47);
  h.get("pattern-0").click();h.get("track-1").click();assert.equal(h.get("empty-pattern-label").textContent,"Pattern 64 is empty");
  assert.equal(h.get("track-start-note").hidden,false);assert.match(h.get("track-start-note").textContent,/64 is empty/);
  h.get("track-0").click();assert.equal(h.get("pattern-label").textContent,"Pattern 01");h.get("save-project").click();assert.ok(h.exports[0].equals(bytes));
  const opened=harness(true);opened.get("file-input").files=[{name:"Starting patterns.prj",size:bytes.length,arrayBuffer:async()=>bytes}];
  opened.get("file-input").onchange();await ticks();assert.equal(opened.get("pattern-label").textContent,"Pattern 48");
  opened.get("track-1").click();assert.equal(opened.get("pattern-label").textContent,"Pattern 64");opened.get("save-project").click();assert.ok(opened.exports[0].equals(bytes));
});
test("starting-pattern controls edit only the selected track's packed field and are undoable",()=>{
  const h=harness(true);h.get("save-project").click();const before=h.exports[0];
  h.edit("track-start-pattern",47).blur();h.flush();assert.equal(h.get("pattern-label").textContent,"Pattern 01");assert.equal(h.get("track-start-note").hidden,false);
  h.get("save-project").click();const changed=h.exports[1];assert.equal(F.Project.parse(changed).track(0).selectedPattern,47);
  for(let i=0;i<before.length;i++)assert.equal((before[i]^changed[i])&~({0xbd:1,0xbe:0xf8}[i]||0),0,"offset "+i);
  h.get("undo").click();assert.equal(h.get("track-start-pattern").value,0);h.get("save-project").click();assert.ok(h.exports[2].equals(before));
  h.get("redo").click();h.get("pattern-7").click();assert.equal(h.get("track-start-pattern").value,47);h.get("set-start-pattern").click();
  assert.equal(h.get("track-start-pattern").value,7);assert.equal(h.get("pattern-label").textContent,"Pattern 08");assert.equal(h.get("set-start-pattern").disabled,true);
  h.get("undo").click();assert.equal(h.get("track-start-pattern").value,47);assert.equal(h.get("pattern-label").textContent,"Pattern 08");
  h.get("track-1").click();assert.equal(h.get("track-start-pattern").value,0);h.edit("track-start-pattern",63).blur();h.flush();h.get("save-project").click();
  const p=F.Project.parse(h.exports[3]);assert.equal(p.track(0).selectedPattern,47);assert.equal(p.track(1).selectedPattern,63);
});
test("number arrows respect limits and decimal steps, commit edits and retain field navigation",()=>{
  const h=harness(true);h.get("save-project").click();const before=h.exports[0];
  h.get("note-0-velocity-increase").click();assert.equal(h.get("undo").disabled,true);
  h.get("note-0-velocity-decrease").click();assert.equal(h.get("note-0-velocity").value,126);assert.equal(h.doc.activeElement,h.get("note-0-velocity"));
  h.key("Tab");assert.equal(h.doc.activeElement,h.get("note-0-gate"));h.get("note-0-gate-increase").click();assert.equal(Number(h.get("note-0-gate").value),1.125);
  h.get("undo").click();assert.equal(Number(h.get("note-0-gate").value),1);assert.equal(h.get("note-0-velocity").value,126);h.get("undo").click();
  h.get("bpm-increase").click();assert.equal(Number(h.get("bpm").value),120.1);h.get("bpm-decrease").click();h.get("save-project").click();assert.ok(h.exports[1].equals(before));
  h.get("show-value-chart").checked=false;h.get("show-value-chart").click();h.edit("value-lane","gate").blur();h.get("value-number-increase").click();assert.equal(Number(h.get("note-0-gate").value),1.125);assert.equal(Number(h.get("value-number").value),1.125);
  assert.equal(h.get("value-number-increase").tabIndex,-1);
});
test("number arrows honour disabled notes and block stepping past an invalid pending edit",()=>{
  const h=harness(true);assert.equal(h.get("note-1-velocity-increase").disabled,true);h.get("note-1-velocity-increase").click();assert.equal(h.get("note-1-enabled").checked,false);
  h.edit("note-0-pitch",999);h.get("note-0-velocity-decrease").click();assert.equal(h.get("validation-error").hidden,false);assert.equal(h.get("note-0-velocity").value,127);assert.equal(h.doc.activeElement,h.get("note-0-pitch"));
  h.get("dismiss-invalid").click();h.get("note-1-enabled").click();assert.equal(h.get("note-1-velocity-increase").disabled,false);
  h.get("generate-pattern").click();h.get("gen-root-increase").click();assert.match(h.get("gen-root-name").textContent,/C♯3|C#3/);
});
test("keyboard export commits the pitch still being typed",()=>{
  const h=harness();h.edit("note-0-pitch",61);h.key("s",{metaKey:true});
  assert.equal(h.exports.length,1);
  assert.equal(F.Project.parse(h.exports[0]).step(0,0,0).notes[0].pitch,61);
  assert.match(h.get("toast").textContent,/^Export requested:/);
});
test("keyboard export commits pending project name and tempo",()=>{
  const h=harness();h.edit("project-name","Keyboard export");h.key("s",{ctrlKey:true});
  assert.equal(F.Project.parse(h.exports[0]).name,"Keyboard export");
  h.edit("bpm",98.5);h.key("s",{ctrlKey:true});
  assert.equal(F.Project.parse(h.exports[1]).bpm,98.5);
  assert.match(h.get("file-status").textContent,/Source: Editor example/);
  assert.match(h.get("file-status").textContent,/Export requested: Keyboard export_\d{8}_\d{6}_\d{3}\.prj/);
});
test("a validation failure before a clicked export blocks it until the edit is discarded",()=>{
  const h=harness();h.edit("note-0-pitch",999);h.get("save-project").click();
  assert.equal(h.exports.length,0);assert.equal(h.get("validation-error").hidden,false);
  assert.match(h.get("validation-message").textContent,/Pitch must be 0–127/);
  h.get("save-project").click();assert.equal(h.exports.length,0);
  h.get("dismiss-invalid").click();h.get("save-project").click();
  assert.equal(F.Project.parse(h.exports[0]).step(0,0,0).notes[0].pitch,60);
});
test("closing catches both uncommitted edits and rejected values",()=>{
  for (const value of [61,999]) {
    const h=harness();h.edit("note-0-pitch",value);
    const event={preventDefault(){this.prevented=true;}};h.windowEvents.beforeunload(event);
    assert.equal(event.prevented,true);assert.equal(event.returnValue,"");
  }
});
test("dropping a replacement commits a focused edit before asking to discard it",async()=>{
  const h=harness();h.edit("project-name","Pending rename");
  const replacement=Buffer.from(fixture);const array=Uint8Array.from(replacement);
  h.events.drop({preventDefault(){},dataTransfer:{files:[{name:"Replacement.prj",size:array.length,arrayBuffer:async()=>array.buffer}]}});
  await new Promise(setImmediate);
  assert.equal(h.confirmationCount(),1);
  assert.equal(h.get("project-name").value,"Pending rename");
  assert.doesNotMatch(h.get("file-status").textContent,/Replacement.prj/);
});
test("track switching remembers selected pattern and step; arrow navigation follows focus",()=>{
  const h=harness();h.get("pattern-1").click();h.get("step-3").click();
  h.get("track-1").click();h.get("track-0").click();
  assert.equal(h.get("pattern-1").attributes["aria-pressed"],"true");
  assert.equal(h.get("step-3").attributes["aria-pressed"],"true");
  h.get("step-3").focus();h.key("ArrowRight");
  assert.equal(h.get("step-4").attributes["aria-pressed"],"true");
  assert.equal(h.get("step-4").tabIndex,0);assert.equal(h.get("step-3").tabIndex,-1);
});
test("retained steps are hidden by default and stay selectable with explicit outside-length feedback",()=>{
  const h=harness();assert.equal(h.get("step-16"),undefined);
  h.get("show-stored-steps").click();h.get("step-63").click();
  assert.equal(h.get("step-length-note").hidden,false);
  assert.match(h.get("step-63").attributes["aria-label"],/outside pattern length/);
  h.get("step-enabled").click();
  assert.match(h.get("step-63").attributes["aria-label"],/skipped/);
  assert.match(h.get("step-63").className,/selected/);
  h.get("show-stored-steps").click();assert.equal(h.get("step-63"),undefined);
  assert.equal(h.get("step-0").attributes["aria-pressed"],"true");
});
test("empty numeric edits are rejected and optional bank fields still mean Off",()=>{
  for(const id of ["note-0-pitch","note-0-velocity","note-0-gate","track-delay","bpm","track-cc-0"]){
    const h=harness();h.edit(id,"");h.key("s",{ctrlKey:true});assert.equal(h.exports.length,0,id);
    assert.equal(h.get("validation-error").hidden,false,id);
  }
  const h=harness();h.edit("bank-msb","");h.key("s",{ctrlKey:true});assert.equal(F.Project.parse(h.exports[0]).track(0).bankMSB,255);
});
test("deferred rendering preserves the next field focus after Tab blur",()=>{
  const h=harness(),next=h.get("note-0-velocity");h.edit("note-0-pitch",61).blur();next.focus();h.flush();
  assert.equal(h.doc.activeElement,h.get("note-0-velocity"));assert.equal(h.get("note-0-pitch").value,61);
});
test("track color controls update stored color, sidebar and drum rows, and undo",()=>{
  const h=harness(true);h.get("save-project").click();const original=F.Project.parse(h.exports[0]).track(0).color;
  assert.equal(h.get("track-color").value,original);assert.equal(h.get("track-0").style.borderLeftColor,F.TRACK_COLORS[original].hex);
  h.edit("track-color",9).blur();h.flush();assert.equal(h.get("track-color-swatch").style.backgroundColor,F.TRACK_COLORS[9].hex);
  assert.equal(h.get("track-0").style.borderLeftColor,F.TRACK_COLORS[9].hex);h.get("save-project").click();assert.equal(F.Project.parse(h.exports[1]).track(0).color,9);
  h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[2].equals(h.exports[0]));
  h.get("group-drums").click();h.get("group-track-1").checked=true;h.get("group-track-1").onchange();h.get("apply-drum-group").click();
  const rows=h.get("drum-rows").children;assert.equal(rows[0].children[0].style.borderLeftColor,F.TRACK_COLORS[original].hex);
  assert.equal(rows[1].children[0].style.borderLeftColor,F.TRACK_COLORS[F.Project.parse(h.exports[0]).track(1).color].hex);
});
test("musical controls edit stored settings, retain Tab focus, reject empty numbers and undo",()=>{
  const h=harness(true);h.get("save-project").click();const original=h.exports[0];
  h.get("fx-fixed").click();h.edit("fx-fixedSteps",11).blur();h.edit("fx-swing",34).blur();h.get("fx-probability").click();h.edit("fx-rate",70).blur();
  h.edit("fx-modShape",4).blur();h.edit("fx-modLength",32).blur();h.edit("fx-modDepth",-25).blur();h.edit("fx-scale",6).blur();h.edit("fx-key",5).blur();
  h.get("fx-arp").click();h.edit("fx-arpRate",6).blur();h.edit("fx-arpStyle",2).blur();h.edit("fx-arpOctaves",3).blur();h.edit("fx-arpGate",60).blur();h.get("fx-reverse").click();h.get("fx-switchBack").click();
  h.get("save-project").click();const fx=F.Project.parse(h.exports[1]).effects(0,0);
  assert.deepEqual([fx.fixedSteps,fx.swing,fx.rate,fx.modShape,fx.modLength,fx.modDepth,fx.scale,fx.key,fx.arpRate,fx.arpStyle,fx.arpOctaves,fx.arpGate],[11,34,70,4,32,-25,6,5,6,2,3,60]);assert.equal(fx.reverse,true);assert.equal(fx.switchBack,true);
  h.edit("fx-rate",69).blur();h.get("fx-swing").focus();h.flush();assert.equal(h.doc.activeElement,h.get("fx-swing"));
  h.edit("fx-swing","").blur();h.flush();assert.equal(h.get("validation-error").hidden,false);assert.equal(h.get("fx-swing").value,34);h.get("dismiss-invalid").click();
  for(let i=0;i<18;i++)h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[2].equals(original));
});
test("Mono, harmonizer, tie and automation controls serialize and remain visible",()=>{
  const h=harness(true);h.get("track-mono").click();h.edit("chord-preset-0",10).blur();h.flush();
  assert.deepEqual([0,1,2,3].map(n=>Number(h.get("chord-0-"+n).value)),[3,7,10,14]);
  h.get("step-tie").click();h.edit("step-harmonizer",1).blur();h.edit("step-speedControl",8).blur();h.edit("step-roll",11).blur();h.edit("step-groove-4",12).blur();h.flush();
  assert.match(h.get("step-0").attributes["aria-label"],/tie.*harmonizer 1/);assert.match(h.get("polyphony-count").textContent,/Mono/);
  h.get("save-project").click();const p=F.Project.parse(h.exports[0]),st=p.step(0,0,0);assert.equal(p.track(0).mono,true);assert.equal(st.tie,true);assert.equal(st.speedControl,8);assert.equal(st.roll,11);assert.equal(st.groove[4],76);
  h.get("clear-automation").click();h.get("save-project").click();assert.equal(F.Project.parse(h.exports[1]).step(0,0,0).roll,0);assert.equal(F.Project.parse(h.exports[1]).step(0,0,0).tie,true);
  h.edit("chord-0-1",3).blur();h.flush();assert.equal(h.get("validation-error").hidden,false);assert.equal(h.get("chord-0-1").value,7);
});
test("pattern sets edit, copy and recall selected patterns/mutes; undo restores track selections",()=>{
  const h=harness(true);h.get("pattern-1").click();h.get("track-1").click();h.get("pattern-8").click();h.get("track-0").click();
  h.get("pattern-sets").click();assert.equal(h.get("scene-pattern-1").value,0);assert.equal(h.get("scene-mute-1").checked,true);
  h.get("scene-15").click();h.get("delete-scene").click();h.get("scene-0").click();h.edit("scene-copy-destination",15).blur();h.get("copy-scene").click();
  h.get("save-project").click();let p=F.Project.parse(h.exports[0]);assert.deepEqual(p.patternSet(0),p.patternSet(15));
  h.edit("scene-pattern-0",9).blur();h.edit("scene-pattern-1",0).blur();h.get("scene-mute-0").click();h.flush();h.get("save-project").click();const before=h.exports[1];
  h.get("recall-scene").click();assert.equal(h.get("pattern-9").attributes["aria-pressed"],"true");h.get("save-project").click();p=F.Project.parse(h.exports[2]);assert.equal(p.track(0).selectedPattern,9);assert.equal(p.track(0).mute,true);
  h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[3].equals(before));assert.equal(h.get("pattern-1").attributes["aria-pressed"],"true");
  h.get("track-1").click();assert.equal(h.get("pattern-8").attributes["aria-pressed"],"true");
  h.get("pattern-sets").click();h.get("capture-scene").click();h.get("save-project").click();p=F.Project.parse(h.exports[4]);assert.equal(p.patternSet(15).entries[0].slot,1);assert.equal(p.patternSet(15).entries[1].slot,8);
});
test("interpolation and randomizer preview first, apply atomically and undo",()=>{
  const h=harness(true);h.get("save-project").click();const before=h.exports[0];h.get("transform-pattern").click();
  assert.equal(h.get("transform-dialog").open,true);h.edit("transform-anchors","1:40,16:80").blur();assert.equal(h.get("apply-transform").disabled,false);
  h.get("save-project").click();assert.ok(h.exports[1].equals(before));h.get("apply-transform").click();assert.equal(h.get("transform-dialog").open,false);
  h.get("save-project").click();assert.equal(F.Project.parse(h.exports[2]).step(0,0,0).notes[0].pitch,40);h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[3].equals(before));
  h.get("transform-pattern").click();h.edit("transform-operation","randomize").blur();h.edit("transform-min","").blur();assert.equal(h.get("apply-transform").disabled,true);assert.match(h.get("transform-preview").textContent,/Parameter value/);
});
test("value bars target chords or individual notes, navigate steps and edit gate in eighths",()=>{
  const h=harness(true);h.get("note-1-enabled").click();h.edit("note-1-velocity",63).blur();h.flush();h.get("save-project").click();const before=h.exports[0];
  h.get("show-value-chart").checked=false;h.get("show-value-chart").click();assert.equal(h.get("value-chart").hidden,false);assert.equal(h.get("value-number").value,95);assert.match(h.get("value-bar-0").title,/63–127/);
  h.edit("value-number",80).blur();h.flush();assert.equal(h.get("note-0-velocity").value,80);assert.equal(h.get("note-1-velocity").value,80);
  h.edit("value-target",1).blur();h.edit("value-lane","gate").blur();h.edit("value-number",2).blur();h.flush();assert.equal(Number(h.get("note-0-gate").value),1);assert.equal(Number(h.get("note-1-gate").value),2);
  assert.equal(h.get("value-track-0").children.find(n=>n.className==="value-gate-marker").style.bottom,"50%");
  h.get("value-bar-0").focus();h.key("ArrowRight");assert.equal(h.doc.activeElement,h.get("value-bar-1"));assert.equal(h.get("value-number").disabled,true);h.key("ArrowUp");assert.equal(h.get("note-0-enabled").checked,false);
  h.key("ArrowLeft");h.key("ArrowUp",{shiftKey:true});assert.equal(Number(h.get("note-1-gate").value),3);assert.equal(h.doc.activeElement,h.get("value-bar-0"));
  h.edit("value-number",1.2).blur();h.flush();assert.equal(h.get("validation-error").hidden,false);assert.equal(h.get("value-number").value,3);h.get("dismiss-invalid").click();
  for(let i=0;i<3;i++)h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[1].equals(before));
});
test("a drawn value stroke previews, fills crossed bars, commits once and cancels without edits",()=>{
  const h=harness(true);h.get("show-value-chart").checked=false;h.get("show-value-chart").click();h.edit("value-lane","cc3").blur();h.get("save-project").click();const before=h.exports[0];
  function pointer(type,st,y){h.get("value-plot")["onpointer"+type]({target:h.get("value-track-"+st),button:0,pointerId:1,clientX:st*30+10,clientY:y,preventDefault(){}});h.flush();}
  pointer("down",0,150);pointer("move",3,125);h.get("save-project").click();assert.ok(h.exports[1].equals(before));pointer("up",3,125);
  h.get("save-project").click();let p=F.Project.parse(h.exports[2]);assert.deepEqual([0,1,2,3].map(st=>p.step(0,0,st).cc[3]),[64,74,85,95]);assert.ok([0,1,2,3].every(st=>p.step(0,0,st).ccMask&8));
  assert.deepEqual(p.step(0,0,0).notes,F.Project.parse(before).step(0,0,0).notes);h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[3].equals(before));
  pointer("down",0,190);pointer("cancel",0,190);assert.equal(h.get("value-number").value,"");h.get("save-project").click();assert.ok(h.exports[4].equals(before));
  pointer("down",0,150);h.edit("note-0-pitch",61).blur();h.flush();pointer("up",0,150);assert.match(h.get("toast").textContent,/pattern changed/);
  h.get("save-project").click();p=F.Project.parse(h.exports[5]);assert.equal(p.step(0,0,0).notes[0].pitch,61);assert.equal(p.step(0,0,0).ccMask&8,0);
});
test("drum value bars follow the selected instrument and visible page without extending patterns",()=>{
  const h=harness(true);h.get("group-drums").click();h.get("group-track-1").checked=true;h.get("group-track-1").onchange();h.get("apply-drum-group").click();
  h.get("show-value-chart").checked=false;h.get("show-value-chart").click();assert.match(h.get("value-chart-context").textContent,/dr1_kick/);h.get("track-1").click();assert.match(h.get("value-chart-context").textContent,/dr1_clap/);h.edit("pattern-pages",1).blur();h.flush();
  h.edit("drum-page",1).blur();assert.equal(h.get("value-bar-0"),undefined);assert.equal(h.get("value-bar-16").tabIndex,0);
  h.edit("value-lane","cc0").blur();h.edit("value-number",42).blur();h.flush();h.get("save-project").click();const p=F.Project.parse(h.exports[0]);
  assert.equal(p.step(1,0,16).cc[0],42);assert.equal(p.step(1,0,16).ccMask&1,1);assert.equal(p.pattern(1,0)[4]&15,1);assert.equal(p.step(0,0,16).ccMask&1,0);
});
test("drum scenes expose shared and mixed controls, preserve overrides and undo grouped edits",()=>{
  const h=harness(true);for(const [t,name] of [[0,"dr1_kick"],[6,"dr1_snare"],[8,"dr2_hat"]]){h.get("track-"+t).click();h.edit("track-name",name).blur();h.flush();}h.get("track-0").click();
  h.get("pattern-sets").click();assert.equal(h.get("scene-group-pattern-1").value,0);assert.equal(h.get("scene-group-mute-1").indeterminate,true);h.get("scene-members-1").open=true;
  h.edit("scene-pattern-6",2).blur();h.flush();assert.equal(h.get("scene-group-pattern-1").value,"mixed");assert.equal(h.get("scene-members-1").open,true);h.get("save-project").click();const before=h.exports[0];
  h.edit("scene-group-pattern-1",3).blur();h.flush();assert.equal(h.get("scene-pattern-0").value,3);assert.equal(h.get("scene-pattern-6").value,3);assert.equal(h.get("scene-group-pattern-2").value,1);
  h.get("scene-group-mute-1").click();assert.equal(h.get("scene-mute-0").checked,true);assert.equal(h.get("scene-mute-6").checked,true);
  for(let i=0;i<2;i++)h.get("pattern-sets-dialog").onkeydown({key:"z",ctrlKey:true,preventDefault(){}});h.flush();h.get("save-project").click();assert.ok(h.exports[1].equals(before));
  h.get("recall-scene").click();assert.equal(h.get("editor-view").value,"track");assert.match(h.get("toast").textContent,/individual assignments/);h.get("undo").click();assert.equal(h.get("editor-view").value,"1");
});
test("scene capture defaults to a shared drum slot and can retain independent selections",()=>{
  const h=harness(true);h.edit("track-name","dr1_kick").blur();h.flush();h.get("track-6").click();h.edit("track-name","dr1_snare").blur();h.flush();h.get("pattern-0").click();h.get("track-0").click();h.get("pattern-1").click();
  h.get("pattern-sets").click();assert.equal(h.get("scene-drum-capture").checked,true);h.get("capture-scene").click();h.get("save-project").click();let p=F.Project.parse(h.exports[0]);
  assert.equal(p.patternSet(0).entries[0].slot,1);assert.equal(p.patternSet(0).entries[6].slot,null);assert.equal(p.patterns[6].has(1),false);
  h.get("scene-drum-capture").click();h.get("capture-scene").click();h.get("save-project").click();p=F.Project.parse(h.exports[1]);assert.equal(p.patternSet(0).entries[0].slot,1);assert.equal(p.patternSet(0).entries[6].slot,0);
  h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[2].equals(h.exports[0]));
});
test("export requests never disarm the closing guard for edited bytes",()=>{
  const h=harness();h.edit("note-0-pitch",61);h.key("s",{ctrlKey:true});
  const event={preventDefault(){this.prevented=true;}};h.windowEvents.beforeunload(event);assert.equal(event.prevented,true);
  assert.equal(h.get("save-state").textContent,"Edited since open");
});
test("step note panel and inspector share data, history and focus return",()=>{
  const h=harness();h.get("step-edit-0").click();assert.equal(h.get("note-panel").hidden,false);
  h.edit("panel-note-0-pitch",65).blur();h.flush();assert.equal(h.get("note-0-pitch").value,65);
  h.key("Escape");assert.equal(h.get("note-panel").hidden,true);assert.equal(h.doc.activeElement,h.get("step-0"));
  h.key("z",{ctrlKey:true});assert.equal(h.get("note-0-pitch").value,60);
});
test("Tab enters pitch editing and commits a new note before visiting velocity and gate",()=>{
  const h=harness();h.get("step-1").focus();h.key("ArrowRight"); // Selected step 3 is empty.
  assert.equal(h.get("step-2").attributes["aria-pressed"],"true");
  h.key("Tab");assert.equal(h.doc.activeElement,h.get("note-0-pitch"));assert.equal(h.get("note-0-pitch").disabled,false);
  h.edit("note-0-pitch",62);h.key("Tab");assert.equal(h.doc.activeElement,h.get("note-0-velocity"));assert.equal(h.get("note-0-enabled").checked,true);
  h.edit("note-0-velocity",96);h.key("Tab");assert.equal(h.doc.activeElement,h.get("note-0-gate"));
  h.edit("note-0-gate",2);h.key("Enter");assert.equal(h.get("step-3").attributes["aria-pressed"],"true");assert.equal(h.doc.activeElement,h.get("note-0-pitch"));
  h.get("save-project").click();const p=F.Project.parse(h.exports[0]);assert.deepEqual([p.step(0,0,2).notes[0].pitch,p.step(0,0,2).notes[0].velocity,p.step(0,0,2).notes[0].gate],[62,96,15]);
});
test("Enter adds the shown pitch on an empty step; Shift Enter and Alt arrows navigate without adding",()=>{
  const h=harness();h.get("step-1").click();h.key("Tab");h.key("Enter");
  assert.equal(h.get("step-2").attributes["aria-pressed"],"true");assert.equal(h.get("note-0-enabled").checked,false);
  h.key("Enter",{shiftKey:true});assert.equal(h.get("step-1").attributes["aria-pressed"],"true");
  h.key("ArrowRight",{altKey:true});h.key("ArrowRight",{altKey:true});assert.equal(h.get("step-3").attributes["aria-pressed"],"true");
  h.key("Escape");assert.equal(h.doc.activeElement,h.get("step-3"));
  h.get("save-project").click();const p=F.Project.parse(h.exports[0]);assert.equal(p.step(0,0,1).notes[0].enabled,true);assert.equal(p.step(0,0,2).notes[0].enabled,false);assert.equal(p.step(0,0,3).notes[0].enabled,false);
  h.get("step-15").click();h.key("ArrowRight",{altKey:true});assert.equal(h.doc.activeElement,h.get("step-15"));
});
test("note panel opens at pitch, cycles Tab locally, and keeps the field across steps",()=>{
  const h=harness();h.get("step-edit-0").click();assert.equal(h.doc.activeElement,h.get("panel-note-0-pitch"));
  h.key("Tab");assert.equal(h.doc.activeElement,h.get("panel-note-0-velocity"));h.key("Tab");assert.equal(h.doc.activeElement,h.get("panel-note-0-gate"));
  h.key("ArrowRight",{altKey:true});assert.equal(h.get("note-panel-title").textContent,"Step 2 notes");assert.equal(h.doc.activeElement,h.get("panel-note-0-pitch"));
  h.key("ArrowLeft",{altKey:true});h.key("¬",{altKey:true,code:"KeyL"});assert.equal(h.doc.activeElement,h.get("panel-note-0-gate"));
  h.get("close-note-panel").focus();h.key("Tab",{shiftKey:true});assert.equal(h.doc.activeElement,h.get("panel-note-1-pitch"));
  h.key("Tab");assert.equal(h.doc.activeElement,h.get("close-note-panel"));h.key("Tab");assert.equal(h.doc.activeElement,h.get("panel-note-0-enabled"));
  h.key("Escape");assert.equal(h.doc.activeElement,h.get("step-0"));
});
test("invalid note edits block Enter, Tab, and step navigation without changing bytes",()=>{
  for(const [key,extra] of [["Enter",{}],["Tab",{}],["ArrowRight",{altKey:true}]]){
    const h=harness();h.edit("note-0-pitch","");h.key(key,extra);
    assert.equal(h.get("step-0").attributes["aria-pressed"],"true");assert.equal(h.doc.activeElement,h.get("note-0-pitch"));assert.equal(h.get("validation-error").hidden,false);
    h.get("dismiss-invalid").click();h.get("save-project").click();assert.ok(h.exports[0].equals(fixture));
  }
});
test("pitch, velocity and gate shortcuts work from the grid and from fields with coarse adjustments",()=>{
  const h=harness();h.get("step-0").focus();h.key("l");assert.equal(h.doc.activeElement,h.get("note-0-gate"));
  h.key("ArrowUp",{shiftKey:true});assert.equal(Number(h.get("note-0-gate").value),2);
  h.key("v",{altKey:true,code:"KeyV"});h.key("ArrowDown",{shiftKey:true});assert.equal(h.get("note-0-velocity").value,117);
  h.key("p",{altKey:true,code:"KeyP"});h.key("ArrowUp",{shiftKey:true});assert.equal(h.get("note-0-pitch").value,72);
  assert.equal(h.key("ArrowLeft").prevented,undefined);assert.equal(h.key("ArrowDown").prevented,undefined);
  h.key("£",{altKey:true,code:"Digit3"});assert.equal(h.doc.activeElement,h.get("step-0"));assert.equal(h.key("ArrowLeft",{metaKey:true}).prevented,undefined);
  h.key("1",{altKey:true});h.key("ArrowRight");assert.equal(h.doc.activeElement,h.get("pattern-0"));h.key("ArrowDown");assert.equal(h.doc.activeElement,h.get("pattern-16"));
  h.get("track-name").focus();assert.equal(h.key("ArrowLeft",{altKey:true}).prevented,undefined);assert.equal(h.doc.activeElement,h.get("track-name"));
});
test("piano typing can advance after a chord and retains focus at the selected step",()=>{
  const h=harness();h.get("step-1").click();h.get("piano-advance").click();h.get("piano-mode").click();assert.equal(h.doc.activeElement,h.get("step-1"));
  h.key("a");h.key("d");h.events.keyup({key:"a"});assert.equal(h.get("step-1").attributes["aria-pressed"],"true");
  h.events.keyup({key:"d"});h.flush();assert.equal(h.get("step-2").attributes["aria-pressed"],"true");assert.equal(h.doc.activeElement,h.get("step-2"));
  h.key("ArrowRight");assert.equal(h.doc.activeElement,h.get("step-3"));
  h.get("save-project").click();const p=F.Project.parse(h.exports[0]);assert.deepEqual(p.step(0,0,1).notes.filter(n=>n.enabled).map(n=>n.pitch),[60,64]);assert.equal(p.step(0,0,2).notes[0].enabled,false);
});
test("drum note entry moves between pages while retaining the drum row",()=>{
  const h=harness(true);h.get("group-drums").click();h.get("group-track-1").checked=true;h.get("group-track-1").onchange();h.get("apply-drum-group").click();
  h.get("drum-step-0-15").focus();h.key("Enter");h.edit("panel-note-0-pitch",36);h.key("Enter");
  assert.equal(h.get("drum-page").value,1);assert.match(h.get("drum-title").textContent,/slot 01/);assert.equal(h.get("track-number").textContent,"Track 01");assert.equal(h.get("panel-note-0-enabled").checked,false);
  h.key("Escape");assert.equal(h.doc.activeElement,h.get("drum-step-0-16"));
  h.key("ArrowDown");assert.equal(h.doc.activeElement,h.get("drum-step-1-16"));
  h.get("pattern-63").click();h.get("drum-step-1-0").focus();h.key("ArrowRight",{altKey:true});assert.equal(h.doc.activeElement,h.get("drum-step-1-1"));
  h.key("Tab");assert.equal(h.doc.activeElement,h.get("drum-pitch-1"));h.get("save-project").click();assert.equal(F.Project.parse(h.exports[0]).patterns[1].has(63),false);
});
test("keyboard toggles, copy/paste, Mac delete and cross-track pattern clipboard",()=>{
  const h=harness();h.get("step-0").focus();h.key("c",{ctrlKey:true});h.get("step-1").click();h.key("v",{ctrlKey:true});
  assert.match(h.get("step-1").attributes["aria-label"],/C4, 1 note/);
  h.key("Backspace");assert.match(h.get("step-1").attributes["aria-label"],/empty/);
  h.key(" ");assert.match(h.get("step-1").attributes["aria-label"],/C4, 1 note/);
  h.key("c",{ctrlKey:true,shiftKey:true});h.get("track-1").click();h.get("pattern-63").click();h.key("v",{ctrlKey:true,shiftKey:true});
  assert.equal(h.get("pattern-63").attributes["aria-pressed"],"true");assert.match(h.get("step-1").attributes["aria-label"],/C4, 1 note/);
});
test("generator presets load complete defaults, show root names and apply as one undo",()=>{
  const h=harness(true);h.get("generate-pattern").click();for(const [id,value] of [["gen-rhythm","pulse"],["gen-period",4],["gen-melody","root"],["gen-root",36],["gen-length",16]])h.get(id).value=value;h.get("gen-root").oninput();h.get("gen-root").onchange();
  assert.equal(h.get("gen-root-name").textContent,"C2");assert.match(h.get("generator-preview").textContent,/4 generated notes/);
  h.get("apply-generator").click();h.get("save-project").click();const generated=F.Project.parse(h.exports[0]);
  assert.deepEqual([0,4,8,12].map(s=>generated.step(0,0,s).notes[0].pitch),[36,36,36,36]);
  h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[1].equals(fixture));
  h.get("gen-root").value=61;h.get("gen-root").oninput();assert.equal(h.get("gen-root-name").textContent,"C♯4");
});
test("generator merge keeps a longer destination and its retained notes",()=>{
  const h=harness(true);h.get("pattern-pages").value=4;h.get("pattern-pages").onchange();h.flush();
  h.get("show-stored-steps").click();h.get("step-63").click();h.key(" ");
  h.get("generate-pattern").click();for(const [id,value] of [["gen-rhythm","pulse"],["gen-period",4],["gen-melody","root"],["gen-root",36],["gen-length",16]])h.get(id).value=value;h.get("gen-root").oninput();h.get("gen-root").onchange();h.get("gen-mode").value="merge";h.get("gen-mode").onchange();assert.equal(h.get("gen-change-length").checked,false);h.get("apply-generator").click();h.get("save-project").click();
  const p=F.Project.parse(h.exports[0]);assert.equal(p.pattern(0,0)[4]&15,4);assert.equal(p.step(0,0,63).notes[0].enabled,true);assert.equal(p.effects(0,0).fixed,false);
});
test("piano typing enters a held chord once, handles repeats and leaves form typing alone",()=>{
  const h=harness();h.get("step-1").click();h.get("piano-mode").click();h.get("step-1").focus();
  for(const key of ["a","d","g"])h.key(key);h.key("a",{repeat:true});assert.equal(h.get("undo").disabled,true);
  for(const key of ["a","d"])h.events.keyup({key});assert.equal(h.get("undo").disabled,true);
  h.events.keyup({key:"g"});h.flush();h.get("save-project").click();assert.deepEqual(F.Project.parse(h.exports[0]).step(0,0,1).notes.filter(n=>n.enabled).map(n=>n.pitch),[60,64,67]);
  h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[1].equals(fixture));
  h.edit("track-name","a");assert.equal(h.key("a").prevented,undefined);h.events.keyup({key:"a"});h.edit("track-name","Kick").blur();h.flush();assert.equal(h.get("undo").disabled,true);
});
test("MIDI import previews occupancy, splits, applies atomically and undoes",async()=>{
  const h=harness(true),M=require("./music.js"),bytes=M.writeSMF([{name:"Long phrase",notes:[{time:0,pitch:61,velocity:99,duration:1},{time:64,pitch:67,velocity:90,duration:1}],end:80}],120);
  h.get("midi-file-input").files=[{name:"Long.mid",size:bytes.length,arrayBuffer:async()=>bytes.buffer}];await h.get("midi-file-input").onchange();
  assert.equal(h.get("apply-import-midi").disabled,true);assert.match(h.get("import-preview").textContent,/occupied/);
  h.edit("import-slot-0",63).blur();h.flush();assert.equal(h.get("apply-import-midi").disabled,false);
  h.get("apply-import-midi").click();h.get("save-project").click();const p=F.Project.parse(h.exports[0]);
  assert.equal(p.step(0,62,0).notes[0].pitch,61);assert.equal(p.step(0,63,0).notes[0].pitch,67);
  h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[1].equals(fixture));
});
test("all MIDI export scopes are reachable and produce MIDI or ZIP bytes",()=>{
  const h=harness(true),M=require("./music.js");h.get("midi-export").click();h.get("export-scope").value="pattern";h.get("apply-export-midi").click();assert.equal(M.readSMF(h.exports[0]).format,0);
  h.get("export-scope").value="snapshot";h.get("export-scope").onchange();h.get("apply-export-midi").click();assert.equal(M.readSMF(h.exports[1]).tracks.length,16);
  h.get("export-scope").value="bank";h.get("apply-export-midi").click();assert.equal(h.exports[2].readUInt32LE(0),0x04034b50);
});
test("MIDI input requests access only on Connect and enters a released chord as one edit",async()=>{
  let requests=0;const port={id:"keyboard",name:"Test keyboard",state:"connected"},access={inputs:new Map([[port.id,port]])};
  const h=harness(true,{navigator:{requestMIDIAccess:async options=>{assert.equal(options.sysex,false);requests++;return access;}}});assert.equal(requests,0);
  await h.get("connect-midi").onclick();assert.equal(requests,1);h.get("midi-device").value=port.id;h.get("midi-device").onchange();h.get("midi-armed").click();
  for(const pitch of [60,64,67])port.onmidimessage({data:[144,pitch,80]});
  for(const pitch of [60,64])port.onmidimessage({data:[128,pitch,0]});assert.equal(h.get("undo").disabled,true);
  port.onmidimessage({data:[144,67,0]});h.flush();h.get("save-project").click();assert.equal(F.Project.parse(h.exports[0]).step(0,0,0).notes.filter(n=>n.enabled).length,3);
  h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[1].equals(fixture));
});
test("drum grouping opens a shared-slot overlay with toggling, arrow keys and note editing",()=>{
  const h=harness(true);h.get("group-drums").click();h.get("group-track-1").checked=true;h.get("group-track-1").onchange();h.get("apply-drum-group").click();
  assert.equal(h.get("editor-view").value,"1");assert.equal(h.get("drum-overlay").hidden,false);assert.equal(h.get("step-grid").hidden,true);
  h.get("drum-step-0-1").click();assert.equal(h.get("drum-step-0-1").attributes["aria-pressed"],"true");
  h.get("drum-step-0-1").focus();h.key("ArrowDown");assert.equal(h.doc.activeElement,h.get("drum-step-1-1"));
  h.key("Enter");assert.equal(h.get("note-panel").hidden,false);h.key("Escape");assert.equal(h.doc.activeElement,h.get("drum-step-1-1"));
});
test("DR_ names automatically open eight fixed note lanes without changing the project",()=>{
  const p=F.Project.parse(fixture);p.setTrack(0,"name","DR_Kit");p.setTrack(1,"name","dr2_snare");p.setTrack(2,"name","DR_Second kit");
  const bytes=Buffer.from(p.serialize()),h=harness(true,{SquidExample:{create:()=>F.Project.parse(bytes)}});
  assert.equal(h.get("editor-view").value,"notes:0");assert.equal(h.get("drum-rows").children.length,8);assert.equal(h.get("step-grid").hidden,true);
  assert.match(h.get("drum-title").textContent,/DR_Kit · 8 note lanes/);assert.match(h.get("drum-help").textContent,/shared by all eight lanes/);
  h.get("save-project").click();assert.ok(h.exports[0].equals(bytes));
  h.get("track-1").click();assert.equal(h.get("editor-view").value,"2");assert.equal(h.get("drum-rows").children.length,1);
  h.get("track-2").click();assert.equal(h.get("editor-view").value,"notes:2");assert.equal(h.get("drum-rows").children.length,8);
  h.get("drum-note-2-0-0").focus();h.key("ArrowRight");
  h.get("editor-view").value="track";h.get("editor-view").onchange();h.get("copy-step").click();assert.equal(h.get("drum-overlay").hidden,true);assert.equal(h.get("step-1").attributes["aria-pressed"],"true");
  h.get("editor-view").value="notes:2";h.get("editor-view").onchange();assert.equal(h.get("drum-note-2-0-1").attributes["aria-current"],"step");
  h.get("track-8").click();assert.equal(h.get("editor-view").value,"track");h.get("track-2").click();assert.equal(h.get("editor-view").value,"notes:2");
});
test("splitting notes as drums changes only the name, and toggles isolate each lane with undo",()=>{
  const h=harness(true);h.get("split-drums").click();assert.equal(h.get("track-name").value,"DR_Kick");assert.equal(h.get("editor-view").value,"notes:0");
  h.get("save-project").click();const renamed=h.exports[0],original=F.Project.parse(fixture),p=F.Project.parse(renamed);p.setTrack(0,"name",original.track(0).name);assert.ok(Buffer.from(p.serialize()).equals(fixture));
  h.get("undo").click();assert.equal(h.get("editor-view").value,"track");assert.equal(h.get("track-name").value,"Kick");h.get("redo").click();
  h.get("drum-note-0-7-0").click();h.get("save-project").click();const added=F.Project.parse(h.exports[1]),before=F.Project.parse(renamed);
  assert.equal(added.step(0,0,0).notes[7].enabled,true);assert.equal(added.step(0,0,0).notes[7].pitch,60);assert.deepEqual(added.step(0,0,0).notes.slice(0,7),before.step(0,0,0).notes.slice(0,7));
  assert.deepEqual(added.track(0),before.track(0));assert.deepEqual(added.step(0,0,0).cc,before.step(0,0,0).cc);
  h.get("drum-note-0-7-0").click();h.get("drum-note-0-7-0").click();h.get("save-project").click();assert.ok(h.exports[2].equals(h.exports[1]));
  h.get("drum-note-0-7-0").focus();h.key("Backspace");assert.equal(h.get("drum-note-0-7-0").attributes["aria-pressed"],"false");assert.equal(h.get("drum-note-0-0-0").attributes["aria-pressed"],"true");
  h.get("undo").click();assert.equal(h.get("drum-note-0-7-0").attributes["aria-pressed"],"true");
});
test("single-track drum keyboard and value bars retain the chosen note lane across pages",()=>{
  const p=F.Project.create();p.setTrack(0,"name","DR_Kit");p.addPattern(0,0);
  const h=harness(true,{SquidExample:{create:()=>F.Project.parse(p.serialize())}});
  h.get("drum-note-0-0-0").focus();h.key("ArrowDown");assert.equal(h.doc.activeElement,h.get("drum-note-0-1-0"));
  h.key(" ");assert.equal(h.get("note-1-enabled").checked,true);h.key("Tab");assert.equal(h.doc.activeElement,h.get("note-1-pitch"));
  h.key("Escape");assert.equal(h.doc.activeElement,h.get("drum-note-0-1-0"));h.key("Enter");assert.equal(h.doc.activeElement,h.get("panel-note-1-pitch"));
  assert.equal(h.get("panel-notes").children.filter(n=>n.className.startsWith("note-row")).length,1);h.edit("panel-note-1-velocity",77);h.key("Enter");assert.equal(h.doc.activeElement,h.get("panel-note-1-pitch"));
  h.key("Escape");assert.equal(h.doc.activeElement,h.get("drum-note-0-1-1"));h.key("End");h.key("ArrowRight");assert.equal(h.get("drum-page").value,1);assert.equal(h.doc.activeElement,h.get("drum-note-0-1-16"));
  h.key(" ");h.get("show-value-chart").checked=false;h.get("show-value-chart").click();assert.equal(h.get("value-target").value,"1");assert.match(h.get("value-chart-context").textContent,/Note 2/);
  h.get("value-bar-16").focus();h.key("ArrowDown");h.key("Escape");assert.equal(h.doc.activeElement,h.get("drum-note-0-1-16"));
  h.get("save-project").click();const edited=F.Project.parse(h.exports[0]);assert.equal(edited.step(0,0,0).notes[1].velocity,77);assert.equal(edited.step(0,0,16).notes[1].velocity,99);assert.equal(edited.step(0,0,16).notes[0].enabled,false);
  h.get("drum-note-row-0-7").click();assert.equal(h.get("value-target").value,"7");assert.equal(h.get("value-number").disabled,true);
  h.get("value-target").value="0";h.get("value-target").onchange();assert.match(h.get("value-chart-context").textContent,/Note 1/);
  h.get("value-target").value="all";h.get("value-target").onchange();assert.match(h.get("value-chart-context").textContent,/All active notes/);
  h.get("pattern-63").click();h.get("drum-note-0-7-0").focus();h.key("Tab");assert.equal(h.doc.activeElement,h.get("drum-note-pitch-0-7"));
  h.edit("drum-note-pitch-0-7",49).blur();h.get("drum-note-0-7-0").click();h.get("save-project").click();assert.equal(F.Project.parse(h.exports[1]).step(0,63,0).notes[7].pitch,49);
});
test("track selection follows drum membership while an explicit Track view survives edits",()=>{
  const h=harness(true);
  for(const [track,name] of [[0,"dr1_kick"],[1,"dr1_snare"],[5,"dr2_kick"],[6,"dr2_snare"]]){
    h.get("track-"+track).click();h.edit("track-name",name).blur();h.flush();
  }
  h.get("track-8").click();assert.equal(h.get("editor-view").value,"track");assert.equal(h.get("drum-overlay").hidden,true);assert.equal(h.get("step-grid").hidden,false);
  h.get("track-0").click();assert.equal(h.get("editor-view").value,"1");assert.equal(h.get("drum-overlay").hidden,false);assert.equal(h.get("step-grid").hidden,true);
  h.get("track-1").click();assert.equal(h.get("editor-view").value,"1");assert.match(h.get("drum-title").textContent,/Drum group 1/);
  h.get("track-5").click();assert.equal(h.get("editor-view").value,"2");assert.match(h.get("drum-title").textContent,/Drum group 2/);
  h.get("editor-view").value="track";h.get("editor-view").onchange();assert.equal(h.get("drum-overlay").hidden,true);
  h.get("copy-step").click();assert.equal(h.get("editor-view").value,"track");
  h.get("track-5").focus();h.key("ArrowDown");assert.equal(h.get("editor-view").value,"2");assert.equal(h.doc.activeElement,h.get("track-6"));
  h.key("ArrowDown");assert.equal(h.get("editor-view").value,"track");assert.equal(h.get("drum-overlay").hidden,true);assert.equal(h.get("step-grid").hidden,false);
});
test("new drum groups default to normalised routing, allow opting out, and undo together",()=>{
  for(const normalise of [true,false]){
    const h=harness(true);for(const [id,value] of [["track-port",2],["track-channel",10],["track-delay",13],["bank-msb",""],["bank-lsb",7],["program",41],["track-cc-0",74]]){h.edit(id,value).blur();h.flush();}
    h.get("save-project").click();const before=F.Project.parse(h.exports[0]);
    h.get("group-drums").click();assert.equal(h.get("drum-normalise-new").checked,true);assert.equal(h.get("drum-normalise-choice").hidden,false);assert.equal(h.get("normalise-drum-group").hidden,true);
    h.get("group-track-5").checked=true;h.get("group-track-5").onchange();assert.match(h.get("drum-normalise-preview").textContent,/Copy from T1 · Kick to tracks 1, 6/);
    if(!normalise)h.get("drum-normalise-new").click();
    h.get("apply-drum-group").click();h.get("save-project").click();const grouped=F.Project.parse(h.exports[1]);
    assert.equal(grouped.track(5).name,"dr1_track_06");
    for(const key of ["port","channel","delay","bankMSB","bankLSB","program","ccNumbers"])assert.deepEqual(grouped.track(5)[key],before.track(normalise?0:5)[key]);
    h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[2].equals(h.exports[0]));
  }
});
test("existing drum groups offer a normalise button for all members and preserve names",()=>{
  const h=harness(true);
  h.edit("track-name","dr3_kick").blur();h.flush();h.edit("track-channel",10).blur();h.flush();h.edit("program",41).blur();h.flush();
  h.get("track-5").click();h.edit("track-name","dr3_snare").blur();h.flush();
  h.get("save-project").click();const before=F.Project.parse(h.exports[0]);
  h.get("editor-view").value="track";h.get("editor-view").onchange();h.get("group-drums").click();
  assert.equal(h.get("drum-group-number").value,3);assert.equal(h.get("drum-normalise-choice").hidden,true);assert.equal(h.get("normalise-drum-group").hidden,false);
  h.get("group-track-0").checked=false;h.get("group-track-0").onchange();assert.match(h.get("drum-normalise-preview").textContent,/Copy from T1 · dr3_kick to tracks 1, 6/);
  h.get("normalise-drum-group").click();assert.match(h.get("drum-normalise-status").textContent,/Normalised group 3 to T1/);
  h.get("close-drum-group").click();h.get("save-project").click();const after=F.Project.parse(h.exports[1]);
  assert.equal(after.track(5).name,"dr3_snare");assert.equal(after.track(5).channel,10);assert.equal(after.track(5).program,41);assert.deepEqual(after.track(1),before.track(1));
  h.get("undo").click();h.get("save-project").click();assert.ok(h.exports[2].equals(h.exports[0]));
  h.get("track-8").click();h.get("group-drums").click();assert.equal(h.get("drum-group-number").value,1);assert.equal(h.get("drum-normalise-new").checked,true);
});
function memoryDB(failWrites=false){
  const records=new Map();let created=false;
  const db={createObjectStore(){created=true;},transaction(){const transaction={objectStore:()=>({get:key=>operation(()=>records.get(key)),put:(value,key)=>operation(()=>{if(failWrites)throw new Error("Quota exceeded");records.set(key,value);}),delete:key=>operation(()=>records.delete(key))})};
    function operation(fn){const request={};setImmediate(()=>{try{request.result=fn();if(request.onsuccess)request.onsuccess();if(transaction.oncomplete)transaction.oncomplete();}catch(error){transaction.error=error;if(transaction.onerror)transaction.onerror();}});return request;}return transaction;}};
  const indexedDB={open(){const request={result:db};setImmediate(()=>{if(!created&&request.onupgradeneeded)request.onupgradeneeded();if(request.onsuccess)request.onsuccess();});return request;}};
  return {indexedDB,records};
}
async function ticks(){for(let i=0;i<5;i++)await new Promise(setImmediate);}
function hardwareHarness({read,write,list}={}){
  const calls={pickers:0,writes:[],reads:[],lists:0,closed:0},listeners={};
  const spec={reportId:0,items:[{reportSize:8,reportCount:64}]};
  const device={vendorId:0x2b73,productId:0x25,opened:false,collections:[{inputReports:[spec],outputReports:[spec]}],async open(){this.opened=true;},async close(){this.opened=false;calls.closed++;}};
  const hid={async requestDevice(options){calls.pickers++;assert.equal(options.filters[0].vendorId,0x2b73);assert.equal(options.filters[0].productId,0x25);return [device];},addEventListener(name,fn){listeners[name]=fn;}};
  const SquidHID={...require("./squid-hid.js"),Transport:class{constructor(){this.usable=true;}disconnect(){this.usable=false;}},Client:class{
    constructor(transport){this.transport=transport;}
    async listProjects(){calls.lists++;if(list)await list(calls.lists,this.transport);return {projects:[{id:0,name:"Device fixture",patterns:19}],remainingProjects:125,remainingPatterns:1511,currentId:0};}
    async downloadProject(id,options){calls.reads.push(id);if(read)return read(options);return Uint8Array.from(fixture);}
    async uploadProject(bytes,options){calls.writes.push(Buffer.from(bytes));if(write)await write(options);return F.Project.parse(bytes);}
  }};
  return {h:harness(true,{navigator:{hid},SquidHID}),calls,device,listeners};
}
test("hardware dialogs isolate editor shortcuts while idle and transferring",async()=>{
  let finishRead;const {h}=hardwareHarness({read:()=>new Promise(resolve=>{finishRead=resolve;})});
  h.get("copy-step").click();h.edit("note-0-pitch",61).blur();h.flush();h.get("save-project").click();const before=h.exports[0];
  h.get("hardware-manager").click();h.get("hardware-connect").click();await ticks();
  function checkShortcuts(id){
    h.get(id).focus();const focused=h.doc.activeElement;
    for(const [key,extra] of [["Delete"],["Backspace"],["z",{ctrlKey:true}],["y",{ctrlKey:true}],["v",{ctrlKey:true}],["d",{ctrlKey:true}],["g"],["i"],["m"],["s",{ctrlKey:true}],["o",{ctrlKey:true}],["ArrowRight",{altKey:true}],["4",{altKey:true}]]){
      assert.equal(h.key(key,extra).prevented,undefined,key);assert.equal(h.doc.activeElement,focused,key);
    }
    assert.equal(h.exports.length,1);assert.equal(h.get("note-0-pitch").value,61);assert.equal(h.get("generator-dialog").open,undefined);
    assert.equal(h.get("import-midi-dialog").open,undefined);assert.equal(h.get("export-midi-dialog").open,undefined);
    assert.equal(h.key("Tab").prevented,undefined);assert.equal(h.key("Escape").prevented,undefined);
  }
  checkShortcuts("hardware-project-0");h.get("hardware-open").click();await ticks();checkShortcuts("hardware-cancel");
  finishRead(Uint8Array.from(fixture));await ticks();h.get("close-hardware").click();h.get("save-project").click();assert.ok(h.exports[1].equals(before));
  h.get("step-0").focus();h.key("Backspace");h.get("save-project").click();assert.ok(!h.exports[2].equals(before));
});
test("any open dialog suppresses piano note release and background shortcuts",()=>{
  const h=harness();h.get("save-project").click();h.get("piano-mode").click();h.key("a");
  const dialog=h.doc.createElement("dialog");dialog.id="future-dialog";h.doc.body.append(dialog);dialog.showModal();
  h.get("help-button").focus();h.events.keyup({key:"a"});h.key("Delete");assert.equal(h.get("undo").disabled,true);
  dialog.close();h.get("save-project").click();assert.ok(h.exports[1].equals(h.exports[0]));
});
test("late read cancellation neither opens the project nor requests a download",async()=>{
  const input=transferFixture();
  for(const action of ["hardware-open","hardware-save"]){
    let page=0,finishRead;const client=new (require("./squid-hid.js").Client)({usable:true,async command(type,body){
      assert.equal(type,3);assert.notEqual(body[1],2,"completed reads need no abort command");
      if(page===input.length/F.PAGE)return new Promise(resolve=>{finishRead=resolve;});return input.subarray(page++*F.PAGE,page*F.PAGE);
    }});
    const {h}=hardwareHarness({read:options=>client.downloadProject(0,options)});h.get("save-project").click();const before=h.exports[0];
    h.get("hardware-manager").click();h.get("hardware-connect").click();await ticks();h.get(action).click();await ticks();
    assert.equal(typeof finishRead,"function");assert.equal(h.get("hardware-cancel").hidden,false);h.get("hardware-cancel").click();finishRead(Uint8Array.of(1));await ticks();
    assert.match(h.get("hardware-status").textContent,/cancelled/);assert.equal(h.get("hardware-dialog").open,true);
    assert.doesNotMatch(h.get("file-status").textContent,/Source: SQUID:/);assert.equal(h.exports.length,1);assert.equal(client.busy,false);
    h.get("close-hardware").click();h.get("save-project").click();assert.ok(h.exports[1].equals(before));
  }
});
test("confirmed saves remain visible when the subsequent project-list refresh fails",async()=>{
  for(const wireError of [false,true]){
    let failRefresh,refreshing;const reachedRefresh=new Promise(resolve=>{refreshing=resolve;});
    const {h,calls,device}=hardwareHarness({list:(count,transport)=>{
      if(count===2){refreshing();return new Promise((_,reject)=>{failRefresh=()=>{if(wireError)transport.usable=false;reject(new Error(wireError?"SQUID response timed out. Reconnect before retrying.":"SQUID is busy. Stop playback, then retry."));};});}
    }});
    h.get("hardware-manager").click();h.get("hardware-connect").click();await ticks();h.get("hardware-review-send").click();h.get("hardware-send").click();await reachedRefresh;
    assert.match(h.get("hardware-status").textContent,/confirmed.*saved/);failRefresh();await ticks();
    assert.match(h.get("hardware-status").textContent,/confirmed.*saved.*Project list refresh failed:/);assert.match(h.get("hardware-status").textContent,wireError?/timed out/:/busy/);
    assert.equal(calls.writes.length,1);assert.equal(calls.lists,2);assert.equal(h.get("hardware-send-review").hidden,true);assert.equal(h.get("close-hardware").disabled,false);
    assert.equal(device.opened,!wireError);assert.equal(calls.closed,wireError?1:0);
    if(!wireError){h.get("hardware-refresh").click();await ticks();assert.equal(calls.lists,3);assert.equal(calls.writes.length,1);}
  }
});
test("hardware access starts only after Connect; device project loading uses the editor's replacement guard",async()=>{
  const {h,calls}=hardwareHarness();assert.equal(calls.pickers,0);h.get("hardware-manager").click();assert.equal(calls.pickers,0);
  h.get("hardware-connect").click();await ticks();assert.equal(calls.pickers,1);assert.equal(h.get("hardware-open").disabled,false);
  h.get("hardware-project-0").click();assert.equal(h.doc.activeElement,h.get("hardware-project-0"));
  h.get("hardware-open").click();await ticks();assert.match(h.get("file-status").textContent,/Source: SQUID:/);assert.equal(h.get("hardware-dialog").open,false);
  h.edit("project-name","Keep my changes").blur();h.flush();h.get("hardware-manager").click();h.get("hardware-open").click();await ticks();
  assert.equal(h.confirmationCount(),1);assert.equal(h.get("project-name").value,"Keep my changes");assert.match(h.get("hardware-status").textContent,/was kept/);
});
test("hardware send requires a fresh review, commits pending fields and sends the reviewed bytes",async()=>{
  let finishSave;const {h,calls}=hardwareHarness({write:options=>{options.onProgress({phase:"finishing",page:20,total:20});return new Promise(resolve=>{finishSave=resolve;});}});h.get("hardware-manager").click();h.get("hardware-connect").click();await ticks();
  h.edit("project-name","Review snapshot");h.get("hardware-review-send").click();assert.equal(calls.writes.length,0);assert.match(h.get("hardware-send-summary").textContent,/Review snapshot/);
  h.edit("bpm",121);h.get("hardware-send").click();await ticks();assert.equal(calls.writes.length,0);assert.equal(h.get("hardware-send-review").hidden,true);
  h.get("hardware-review-send").click();h.get("hardware-send").click();await ticks();assert.equal(calls.writes.length,1);const project=F.Project.parse(calls.writes[0]);assert.equal(project.name,"Review snapshot");assert.equal(project.bpm,121);
  assert.equal(h.get("hardware-cancel").hidden,true);assert.equal(h.get("close-hardware").disabled,true);finishSave();await ticks();assert.match(h.get("hardware-status").textContent,/confirmed.*saved/);
  const event={preventDefault(){this.prevented=true;}};h.windowEvents.beforeunload(event);assert.equal(event.prevented,true);
});
test("busy hardware transfers keep the dialog open, cancel between pages, and clear reviews on unplug",async()=>{
  let finishRead;const {h,listeners,device}=hardwareHarness({read:options=>new Promise((resolve,reject)=>{finishRead=()=>{assert.equal(options.signal.aborted,true);const error=new Error("Transfer cancelled.");error.name="AbortError";reject(error);};})});
  h.get("hardware-manager").click();h.get("hardware-connect").click();await ticks();h.get("hardware-open").click();await ticks();
  const closing={preventDefault(){this.prevented=true;}};h.windowEvents.beforeunload(closing);assert.equal(closing.prevented,true);
  assert.equal(h.get("hardware-refresh").disabled,true);const event={preventDefault(){this.prevented=true;}};h.get("hardware-dialog").handlers.cancel(event);assert.equal(event.prevented,true);
  h.get("hardware-cancel").click();assert.equal(h.get("hardware-cancel").disabled,true);finishRead();await ticks();
  assert.match(h.get("hardware-status").textContent,/cancelled/);assert.equal(h.get("hardware-dialog").open,true);assert.doesNotMatch(h.get("file-status").textContent,/Source: SQUID:/);
  const idleClosing={preventDefault(){this.prevented=true;}};h.windowEvents.beforeunload(idleClosing);assert.equal(idleClosing.prevented,undefined);
  h.get("hardware-manager").click();h.get("hardware-review-send").click();assert.equal(h.get("hardware-send-review").hidden,false);
  listeners.disconnect({device});assert.equal(h.get("hardware-send-review").hidden,true);assert.equal(h.get("hardware-send").disabled,true);assert.equal(h.get("hardware-projects").children.length,0);
});
test("local recovery is opt-in, restores owned project bytes, and can be deleted",async()=>{
  const storage=memoryDB(),h=harness(true,{indexedDB:storage.indexedDB});await ticks();
  assert.equal(storage.records.size,0);h.edit("project-name","Recovery test").blur();h.flush();assert.equal(storage.records.size,0);
  h.get("autosave-enabled").click();await ticks();assert.equal(F.Project.parse(storage.records.get("current").bytes).name,"Recovery test");
  const restored=harness(true,{indexedDB:storage.indexedDB});await ticks();assert.equal(restored.get("restore-dialog").open,true);
  restored.get("restore-session").click();await ticks();assert.equal(restored.get("project-name").value,"Recovery test");
  const event={preventDefault(){this.prevented=true;}};restored.windowEvents.beforeunload(event);assert.equal(event.prevented,true);
  await restored.get("clear-autosave").onclick();assert.equal(storage.records.size,0);
});
test("recovery write failures remain visible and do not alter project bytes",async()=>{
  const storage=memoryDB(true),h=harness(true,{indexedDB:storage.indexedDB});await ticks();h.get("autosave-enabled").click();await ticks();
  assert.match(h.get("autosave-status").textContent,/Autosave failed: Quota exceeded/);
  h.get("save-project").click();assert.ok(h.exports[0].equals(fixture));
});

test('single-track generator defaults to the selected lane and undoes without touching other notes',()=>{
  const h=harness(true);h.get('split-drums').click();h.get('drum-note-row-0-2').click();h.get('save-project').click();const before=F.Project.parse(h.exports[0]);
  h.get('generate-pattern').click();assert.equal(h.get('gen-lane-2').checked,true);assert.equal(h.get('gen-lane-0').checked,false);assert.equal(h.get('gen-enable-skipped').checked,false);assert.equal(h.get('gen-change-length').checked,false);assert.match(h.get('generator-title').textContent,/drum rhythms/);assert.equal(h.get('generator-visual').children.length,8);assert.match(h.get('generator-visual').children[0].children[0].textContent,/unchanged/);assert.match(h.get('generator-visual').children[2].children[0].textContent,/changes/);
  h.get('gen-dynamics-2').click();for(const [id,value] of [['gen-velocity',90],['gen-accent',0],['gen-humanize',0],['gen-lane-accent-2',18],['gen-lane-humanize-2',0]])h.get(id).value=value;
  h.get('apply-generator').click();h.get('save-project').click();const next=F.Project.parse(h.exports[1]);assert.equal(next.step(0,0,0).notes[2].velocity,108);for(let st=0;st<64;st++)for(let n=0;n<8;n++)if(n!==2)assert.deepEqual(next.step(0,0,st).notes[n],before.step(0,0,st).notes[n]);
  h.get('undo').click();h.get('save-project').click();assert.ok(h.exports[2].equals(h.exports[0]));
});
test('whole drum-group generation allocates a common empty slot and is one undo operation',()=>{
  const h=harness(true);h.edit('track-name','dr1_custom').blur();h.flush();h.get('track-1').click();h.edit('track-name','dr1_other').blur();h.flush();h.get('track-0').click();h.get('save-project').click();const before=F.Project.parse(h.exports[0]);
  h.get('generate-pattern').click();h.get('gen-all-lanes').click();h.get('gen-mode').value='new';h.get('gen-mode').onchange();const s=Number(h.get('gen-slot').value)-1;assert.ok(!before.patterns[0].has(s)&&!before.patterns[1].has(s));assert.equal(h.get('apply-generator').disabled,false);
  h.get('apply-generator').click();h.get('save-project').click();const next=F.Project.parse(h.exports[1]);assert.ok(next.patterns[0].has(s)&&next.patterns[1].has(s));assert.deepEqual(next.track(0),before.track(0));assert.deepEqual(next.track(1),before.track(1));
  h.get('undo').click();h.get('save-project').click();assert.ok(h.exports[2].equals(h.exports[0]));
});
test('drum selection mode is non-mutating while Space still toggles the selected lane',()=>{
  const h=harness(true);h.get('split-drums').click();h.get('save-project').click();const before=h.exports[0];h.edit('drum-interaction','select').blur();h.get('drum-note-0-2-0').click();h.get('save-project').click();assert.ok(h.exports[1].equals(before));h.get('drum-note-0-2-0').focus();h.key(' ');h.get('save-project').click();assert.equal(F.Project.parse(h.exports[2]).step(0,0,0).notes[2].enabled,true);
});

test('pattern-set overview uses one tab stop and arrows inspect assignments without editing bytes',()=>{
  const h=harness(true);h.get('save-project').click();const before=h.exports[0];h.get('pattern-sets').click();
  assert.equal(h.get('scene-cell-0-0').tabIndex,0);assert.equal(h.get('scene-cell-1-0').tabIndex,-1);
  h.get('scene-cell-0-0').focus();h.key('ArrowRight');assert.equal(h.doc.activeElement.id,'scene-cell-0-1');h.key('ArrowDown');assert.equal(h.doc.activeElement.id,'scene-cell-1-1');h.key('End');assert.equal(h.doc.activeElement.id,'scene-cell-1-15');
  assert.equal(h.get('scene-cell-0-0').tabIndex,-1);assert.equal(h.get('scene-cell-1-15').tabIndex,0);h.get('close-pattern-sets').click();assert.equal(h.doc.activeElement.id,'pattern-sets');h.get('save-project').click();assert.ok(h.exports[1].equals(before));
});
