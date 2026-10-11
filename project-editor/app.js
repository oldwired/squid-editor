(function () {
  "use strict";
  const F = window.SquidProject, Project = F.Project;
  const $ = function (id) { return document.getElementById(id); };
  const modalOpen=()=>document.querySelectorAll("dialog[open]").length>0;
  const numberControl=input=>window.SquidNumbers ? window.SquidNumbers.wrap(input) : input;
  const numberElement=control=>control.tagName==="INPUT" ? control : control.children[0];
  if(window.SquidNumbers)window.SquidNumbers.setCommitter(commitPendingField,id=>{render();const input=$(id);if(input&&!input.disabled)input.focus({preventScroll:true});});
  const example = window.SquidExample.create().serialize();
  let project = Project.parse(example), track = 0, slot = 0, step = 0;
  let saved = example.slice(), filename = "Editor example", dirty = false;
  let past = [], future = [], toastTimer, dragDepth = 0, validationFailure = "", lastExportName = "", invalidField = "", lastField = "";
  let trackViews = Array(16).fill(null), renderFrame = 0, notePanel = false, stepClipboard = null;
  let pianoMode = false, pianoOctave = 4, afterRender = function () {}, patternClipboard=null, drumNote=0;
  let heldKeys=new Set(),typedNotes=[],typedLocation=null;
  function scheduleRender() {
    if (!renderFrame) renderFrame = requestAnimationFrame(function () { renderFrame=0; render(); });
  }
  function element(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = content;
    return el;
  }
  function decorateStep(button,data) {
    const active=data.notes.flatMap((note,index)=>note.enabled ? [{...note,index}] : []);
    if(!active.length)return;
    const visual=element("span","step-articulation"),velocities=element("span","step-velocities"),gates=element("span","step-gates");
    visual.setAttribute("aria-hidden","true");
    for(const note of active){
      const meter=element("span","step-velocity"),fill=element("span","step-velocity-fill");
      meter.dataset.noteSlot=note.index;meter.style.gridColumn=String(note.index+1);
      fill.style.height=(note.velocity/127*100)+"%";meter.append(fill);velocities.append(meter);
    }
    visual.append(velocities,gates);
    for(const note of active){
      const lane=element("span","step-gate-track");lane.dataset.noteSlot=note.index;
      const duration=(note.gate+1)/8,offsets=note.offsets.length ? note.offsets : [note.offset];
      for(const offset of offsets){
        const start=offset/6,bar=element("span","step-gate-fill"+(start+duration>1 ? " continues" : ""));
        bar.style.left=(start*100)+"%";bar.style.width=(Math.min(duration,1-start)*100)+"%";lane.append(bar);
      }
      gates.append(lane);
    }
    const description=active.map(n=>"Note "+(n.index+1)+" "+F.noteName(n.pitch)+" · Vel "+n.velocity+" · Gate "+((n.gate+1)/8).toFixed(3)+" steps · Offset "+(n.offsets.length ? n.offsets : [n.offset]).map(o=>o ? o+"/6" : "0").join(", ")).join("\n");
    button.title=description;button.setAttribute("aria-description",description.replace(/\n/g,"; "));button.append(visual);
  }
  function option(select, value, label) {
    const item = element("option", "", label); item.value = value; select.append(item);
  }
  F.PORTS.forEach(function (label, i) { option($("track-port"),i,label); });
  F.TRACK_COLORS.forEach(function (color,i) {option($("track-color"),i,"#"+String(i+1).padStart(2,"0")+" · "+color.name);});
  for (let n = 1; n <= 16; n++) option($("track-channel"),n,n);
  F.DIRECTION_NAMES.forEach(function (label, i) { option($("pattern-direction"),i,label); });
  for (let n = 1; n <= 4; n++) { option($("step-count"),n,n); option($("step-divide"),n,n); }
  option($("step-harmonizer"),0,"Off");for(let n=1;n<=6;n++)option($("step-harmonizer"),n,"Chord "+n);
  option($("step-harmonizer"),7,"Stored reserved code 7");$("step-harmonizer").lastElementChild.disabled=true;
  const transpositions = F.TRANSPOSE;
  transpositions.map((n,code)=>({n,code})).sort((a,b)=>a.n-b.n).forEach(function ({n,code}) {
    option($("step-transpose"),code,code === 8 ? "Off" : (n>0 ? "+" : "")+n+" semitones");
  });
  function equal(a,b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function snapshot() { return {bytes:project.serialize(),track:track,slot:slot,step:step,note:drumNote,view:$("editor-view").value,views:trackViews.map(v=>v ? {...v} : null)}; }
  function restore(s) { project = Project.parse(s.bytes); track = s.track; slot = s.slot; step = s.step;if(s.note!==undefined)drumNote=s.note;if(s.view!==undefined)$("editor-view").value=s.view;if(s.views)trackViews=s.views.map(v=>v ? {...v} : null); }
  function selectedDrumNote(){return $("editor-view").value==="notes:"+track&&/^dr_/i.test(project.track(track).name) ? drumNote : null;}
  function stepButtonId(t=track,st=step){return $("drum-overlay").hidden ? "step-"+st : selectedDrumNote()===null ? "drum-step-"+t+"-"+st : "drum-note-"+t+"-"+drumNote+"-"+st;}
  function trimHistory(stack) {
    let size = stack.reduce(function (n, item) { return n+item.bytes.length; }, 0);
    while (stack.length > 40 || (size > 24*1024*1024 && stack.length > 1)) size -= stack.shift().bytes.length;
  }
  function toast(message, error) {
    clearTimeout(toastTimer);
    $("toast").textContent = message; $("toast").className = "visible" + (error ? " error" : "");
    toastTimer = setTimeout(function () { $("toast").className = ""; }, error ? 6000 : 3200);
  }
  function change(action) {
    const before = snapshot();
    try {
      action();
      const after = project.serialize();
      if (!equal(before.bytes,after)) { past.push(before); trimHistory(past); future = []; }
      validationFailure = ""; invalidField = "";
      dirty = !equal(saved,after); scheduleRender();
      return true;
    } catch (error) { validationFailure = error.message; invalidField = document.activeElement.id || lastField; restore(before); scheduleRender(); return false; }
  }
  function commitPendingField() {
    const active = document.activeElement;
    // Number/text fields commit on blur. Keyboard export must include the value
    // still being typed, and must stop if the change handler rejects it.
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) active.blur();
    if (validationFailure && active && active.id && $(active.id) && !active.disabled) active.focus();
    return !validationFailure;
  }
  function navigate(event, position, columns, count, select) {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const offsets = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-columns, ArrowDown:columns};
    let next;
    if (event.key in offsets) next = Math.max(0,Math.min(count-1,position+offsets[event.key]));
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count-1;
    else return;
    event.preventDefault(); select(next);
  }
  function startingPattern(t){
    const selected=project.track(t).selectedPattern;
    return selected===null ? (project.patterns[t].size ? Math.min.apply(null,Array.from(project.patterns[t].keys())) : 0) : selected;
  }
  function selectTrack(t) {
    trackViews[track] = {slot:slot,step:step}; track = t;
    const remembered = trackViews[t];
    slot = remembered ? remembered.slot : startingPattern(t);
    step = remembered ? remembered.step : 0; render();
  }
  function routeLabel(info) {
    if (!info.isV3) return "Legacy track";
    const port = F.PORTS[info.port] || "Output " + info.port;
    return port + (info.port >= 1 && info.port <= 3 ? " · Ch "+info.channel : "") + (info.mute ? " · Muted" : "") + (info.solo ? " · Solo" : "");
  }
  function renderTracks() {
    $("track-list").replaceChildren();
    for (let t = 0; t < 16; t++) {
      const info = project.track(t), button = element("button","track-button" + (t===track ? " selected" : ""));
      button.id = "track-"+t; button.setAttribute("aria-label","Track "+(t+1)+": "+info.name);
      button.setAttribute("aria-pressed",t===track);
      button.tabIndex = t===track ? 0 : -1; button.title = routeLabel(info);
      if (info.color!==null) {
        button.style.borderLeftColor=F.TRACK_COLORS[info.color].hex;
        button.title+=" · Color #"+String(info.color+1).padStart(2,"0");
      }
      button.append(element("span","track-index",String(t+1).padStart(2,"0")));
      const name = element("span","track-button-name",info.name || "Unnamed track");
      name.append(element("small","",routeLabel(info)));
      button.append(name,element("span","track-pattern-count",project.patterns[t].size));
      button.onclick = function () { selectTrack(t); };
      button.onkeydown = function (event) {
        if (event.key === "ArrowRight" && !event.altKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault(); $("pattern-"+slot).focus();
        } else if (["ArrowUp","ArrowDown","Home","End"].includes(event.key))
          navigate(event,t,1,16,function (next) { selectTrack(next); $("track-"+next).focus(); });
      };
      $("track-list").append(button);
    }
  }
  function renderBank() {
    $("pattern-bank").replaceChildren();
    for (let s = 0; s < 64; s++) {
      const occupied = project.patterns[track].has(s);
      const button = element("button","pattern-slot" + (occupied ? " occupied" : "") + (s===slot ? " selected" : ""),String(s+1).padStart(2,"0"));
      button.id = "pattern-"+s; button.setAttribute("aria-label","Pattern "+(s+1)+(occupied ? "" : ", empty"));
      button.setAttribute("aria-pressed",s===slot); button.title = "Pattern "+(s+1)+(occupied ? "" : " · Empty");
      button.tabIndex = s===slot ? 0 : -1;
      button.onclick = function () { slot = s; step = 0; render(); };
      button.onkeydown = function (event) {
        const columns = getComputedStyle($("pattern-bank")).gridTemplateColumns.split(" ").length;
        navigate(event,s,columns,64,function (next) { slot = next; step = 0; render(); $("pattern-"+next).focus(); });
      };
      $("pattern-bank").append(button);
    }
  }
  function renderGrid() {
    $("step-grid").replaceChildren();
    const present = project.patterns[track].has(slot);
    $("empty-pattern").hidden = present; $("step-grid").hidden = !present;
    $("empty-inspector").hidden = present; $("step-inspector").hidden = !present;
    $("duplicate-pattern").disabled = !present || project.patterns[track].size === 64; $("delete-pattern").disabled = !present;
    $("add-pattern").disabled = project.patterns[track].size === 64;
    for(const id of ["copy-step","paste-step","transfer-pattern"]) $(id).disabled=!present;
    $("paste-step").disabled=!present || !stepClipboard;
    $("pattern-label").textContent = "Pattern " + String(slot+1).padStart(2,"0");
    $("empty-pattern-label").textContent = "Pattern " + String(slot+1).padStart(2,"0") + " is empty";
    $("inspector-location").textContent = "Track " + String(track+1).padStart(2,"0") + " / Pattern " + String(slot+1).padStart(2,"0");
    $("step-number").textContent = String(step+1).padStart(2,"0");
    $("step-length-note").hidden = true; $("speed-note").hidden = true;
    $("stored-steps-control").hidden = !present;
    for (const id of ["pattern-pages","pattern-speed","pattern-direction"]) $(id).disabled = !present;
    $("pattern-effects").textContent = "";
    if (!present) { closeNotePanel(false); return; }
    const p = project.pattern(track,slot), pages = p[4]&15, direction = F.u32(p,0xe28);
    const fx=project.effects(track,slot);
    const effects=[pages*16+" steps", "Speed "+({0:"×0.25",1:"×0.5",2:"×1",3:"×1.5",4:"×2"}[p[5]]||p[5]),F.DIRECTION_NAMES[direction]||"Direction "+direction];
    if(fx.fixed)effects.push("Fixed "+fx.fixedSteps+" steps");if(fx.probability)effects.push("Probability "+fx.rate+"%");if(fx.swing)effects.push("Swing "+fx.swing+"%");
    if(fx.modDepth)effects.push("Speed modulation "+fx.modDepth);if(fx.scale)effects.push("Scale "+(F.SCALES[fx.scale]?.name||fx.scale)+" · "+F.noteName(fx.key).replace(/-1$/,""));
    if(fx.arp)effects.push("Arpeggiator · "+(F.ARP_RATES[fx.arpRate]||fx.arpRate));if(fx.reverse)effects.push("Reverse");if(fx.switchBack)effects.push("Switch Back");
    effects.forEach((label,i)=>$("pattern-effects").append(element("span",i>=3?"effect active":"effect",label)));
    if (step >= pages*16) $("show-stored-steps").checked = true;
    const showStored = $("show-stored-steps").checked || $("step-page-select").value==="all";
    $("stored-steps-control").hidden = pages===4 || $("step-page-select").value==="all";
    $("step-length-note").hidden = step < pages*16 && (!fx.fixed || step<fx.fixedSteps);
    $("step-length-note").textContent = step>=pages*16 ? "Outside pattern length" : "Beyond fixed length ("+fx.fixedSteps+" steps)";
    $("pattern-pages").value = pages;
    $("pattern-speed").value = p[5]; $("pattern-speed").disabled = p[3] !== 51;
    $("speed-note").hidden = p[3] === 51;
    // Preserve unknown direction values unless the user explicitly chooses a known mode.
    $("pattern-direction").querySelectorAll("option[data-unknown]").forEach(function (el) { el.remove(); });
    if (direction > 11) {
      option($("pattern-direction"),direction,"Mode "+direction+" (preserved)");
      $("pattern-direction").lastElementChild.dataset.unknown = "true";
    }
    $("pattern-direction").value = direction;
    for (let page = 0; page < 4; page++) {
      if (page >= pages && !showStored) continue;
      const group = element("div","step-page-group");
      const label = element("div","step-page-label");
      label.append(element("span","","Steps "+(page*16+1)+"–"+((page+1)*16)),
        element("span","",page < pages ? "Page "+(page+1) : "Stored beyond length"));
      group.append(label);
      const row = element("div","step-page");
      let beat;
      for (let local = 0; local < 16; local++) {
        if (local%4 === 0) { beat = element("div","step-beat"); row.append(beat); }
        const s = page*16+local, data = project.step(track,slot,s);
        const notes = data.notes.filter(function (n) { return n.enabled; });
        let cls = "step-card" + (notes.length ? " has-note" : "") + (data.ccMask ? " has-cc" : "");
        if (s===step) cls += " selected";
        if (!data.enabled) cls += " inactive";
        if (page>=pages || (fx.fixed && s>=fx.fixedSteps)) cls += " outside";
        const button = element("button",cls); button.id = "step-"+s;
        const pitch = notes.length ? F.noteName(notes[0].pitch) : "·";
        button.setAttribute("aria-label","Step "+(s+1)+", "+(notes.length ? pitch+", "+notes.length+" note"+(notes.length===1 ? "" : "s") : "empty")
          + (!data.enabled ? ", skipped" : "") + (data.tie ? ", tie" : "") + (data.harmonizer ? ", harmonizer "+data.harmonizer : "") + (page>=pages ? ", outside pattern length" : "") + (fx.fixed && s>=fx.fixedSteps ? ", beyond fixed length" : "") + (data.ccMask ? ", CC values" : ""));
        button.setAttribute("aria-pressed",s===step);
        button.tabIndex = s===step ? 0 : -1;
        button.append(element("span","step-index",String(s+1).padStart(2,"0")),element("span","note-label",pitch));
        const indicators = element("span","note-indicators",[notes.length > 1 ? "×"+notes.length : "",data.tie ? "Tie" : "",data.harmonizer ? "H"+data.harmonizer : ""].filter(Boolean).join(" · "));
        button.append(indicators);
        decorateStep(button,data);
        button.onclick = function (event) {
          step = s;
          if (event.shiftKey) toggleFirstNote(s); else render();
        };
        button.oncontextmenu = function (event) { event.preventDefault(); step = s; toggleFirstNote(s); };
        button.onkeydown = function (event) {
          const columns = getComputedStyle(row).gridTemplateColumns.split(" ").length*4;
          navigate(event,s,columns,showStored ? 64 : pages*16,function (next) { step = next; render(); $("step-"+next).focus(); });
        };
        const tile=element("div","step-tile");
        const edit=element("button","step-edit","Edit"); edit.id="step-edit-"+s;
        edit.setAttribute("aria-label","Edit notes in step "+(s+1)); edit.setAttribute("aria-expanded",notePanel && s===step);
        edit.tabIndex=-1; // Enter on the step opens the same note panel.
        edit.onclick=function () { step=s; openNotePanel(); };
        tile.append(button,edit); beat.append(tile);
      }
      group.append(row); $("step-grid").append(group);
    }
  }
  function validOr(value,max,fallback) { return value>=0 && value<=max ? value : fallback; }
  function toggleFirstNote(s) {
    change(function () {
      const data = project.step(track,slot,s), note = data.notes[0];
      project.setNote(track,slot,s,0,{enabled:!note.enabled,pitch:validOr(note.pitch,127,60),
        velocity:validOr(note.velocity,127,100),gate:validOr(note.gate,511,7)});
      if (!note.enabled && !data.enabled) project.setStep(track,slot,s,"enabled",true);
    });
  }
  function numberInput(id, label, value, max, disabled, handler) {
    const input = element("input");
    input.id = id; input.type = "number"; input.min = 0; input.max = max; input.value = value;
    input.disabled = disabled; input.setAttribute("aria-label",label);
    input.onchange = function () { lastField=id; const value = input.valueAsNumber; change(function () {
      if (!Number.isFinite(value)) throw new Error(label+" needs a number."); handler(value);
    }); };
    return numberControl(input);
  }
  function editNote(n,values) {
    const data=project.step(track,slot,step),note=data.notes[n];
    if (!note.enabled) {
      values={enabled:true,pitch:validOr(note.pitch,127,60),velocity:validOr(note.velocity,127,100),gate:validOr(note.gate,511,7),...values};
      if (!data.enabled) project.setStep(track,slot,step,"enabled",true);
    }
    project.setNote(track,slot,step,n,values);
  }
  function renderInspector() {
    const data = project.step(track,slot,step);
    $("step-number").textContent = String(step+1).padStart(2,"0");
    $("step-enabled").checked = data.enabled; $("step-slide").checked = data.slide;
    $("step-count").value = data.count; $("step-divide").value = data.divide;
    $("step-tie").checked=data.tie;$("step-harmonizer").value=data.harmonizer;
    $("step-transpose").value = data.transpose;
    $("polyphony-count").textContent = (project.track(track).mono ? "Mono · " : "")+data.notes.filter(function (n) { return n.enabled; }).length+" / 8 stored";
    renderNotes($("notes-list"),"note-");
    if (notePanel) {
      $("note-panel-title").textContent="Step "+(step+1)+(selectedDrumNote()===null ? " notes" : " · Note "+(drumNote+1));
      renderNotes($("panel-notes"),"panel-note-");
    }
    $("cc-list").replaceChildren();
    for (let lane = 0; lane < 5; lane++) {
      const cell = element("div","cc-cell"), label = element("label");
      const check = element("input"); check.type = "checkbox"; check.checked = !!(data.ccMask&(1<<lane));
      check.id = "cc-"+lane+"-enabled"; check.setAttribute("aria-label","CC lane "+(lane+1)+" enabled");
      check.onchange = function () {
        const enabled = check.checked;
        change(function () { project.setCC(track,slot,step,lane,data.cc[lane],enabled); });
      };
      const number=project.track(track).ccNumbers;
      label.append(check,element("span","",number ? "CC "+number[lane] : "Lane "+(lane+1))); cell.append(label);
      cell.append(numberInput("cc-"+lane+"-value","CC lane "+(lane+1)+" value",data.cc[lane],127,!check.checked,
        function (value) { project.setCC(track,slot,step,lane,value,true); }));
      $("cc-list").append(cell);
    }
    const p=project.pattern(track,slot), a=0xbd0+step*9;
    $("step-automation-note").textContent=p[a+1] || p[a+2] || p.slice(a+3,a+9).some(v=>v!==64)
      ? "Speed, roll or Groove Bend automation is stored in this step." : "";
  }
  function renderNotes(container,prefix) {
    const data=project.step(track,slot,step); container.replaceChildren();
    const firstEmpty=data.notes.findIndex(n=>!n.enabled),selected=selectedDrumNote();
    data.notes.forEach(function (note,n) {
      if(prefix==="panel-note-"&&selected!==null&&n!==selected)return;
      if (!$("show-all-notes").checked && !note.enabled && n!==firstEmpty && n!==selected) return;
      const row = element("div","note-row" + (note.enabled ? "" : " disabled")+(n===selected ? " selected-note" : ""));
      const check = element("input"); check.type = "checkbox"; check.checked = note.enabled;
      check.id = prefix+n+"-enabled"; check.setAttribute("aria-label","Note "+(n+1)+" enabled");
      check.onchange = function () {
        const enabled = check.checked;
        change(function () {
          project.setNote(track,slot,step,n,{enabled:enabled,pitch:validOr(note.pitch,127,60),
            velocity:validOr(note.velocity,127,100),gate:validOr(note.gate,511,7)});
          if (enabled && !data.enabled) project.setStep(track,slot,step,"enabled",true);
        });
      };
      row.append(check);
      const pitch = element("div","note-pitch");
      pitch.append(element("span","",note.pitch<=127 ? F.noteName(note.pitch) : "—"),
        numberInput(prefix+n+"-pitch","Note "+(n+1)+" MIDI pitch",note.pitch,127,false,
          function (value) { editNote(n,{pitch:value}); }));
      numberElement(pitch.lastElementChild).title=note.enabled ? "Enter: next step · Shift+Enter: previous step" : "Type a pitch to add this note. Enter adds the shown pitch and moves to the next step.";
      row.append(pitch,
        numberInput(prefix+n+"-velocity","Note "+(n+1)+" velocity",note.velocity,127,!note.enabled,
          function (value) { project.setNote(track,slot,step,n,{velocity:value}); }),
        numberInput(prefix+n+"-gate","Note "+(n+1)+" gate in steps",((note.gate+1)/8).toFixed(3),64,!note.enabled,
          function (value) { if(value<.125||value>64||!Number.isInteger(value*8))throw new Error("Gate must be 0.125–64.000 steps, in increments of 0.125."); project.setNote(track,slot,step,n,{gate:value*8-1}); }));
      numberElement(row.children[3]).min=.125;numberElement(row.children[3]).step=.125;numberElement(row.children[3]).title="Gate in steps · 1.000 reaches the next step · stored value "+note.gate;
      const offset=element("select"); offset.id=prefix+n+"-offset";
      for(let i=0;i<6;i++) option(offset,i,i ? i+"/6" : "0");
      offset.value=note.offset; offset.disabled=!note.enabled;
      offset.setAttribute("aria-label","Note "+(n+1)+" offset");
      offset.title=note.offsets.length>1 ? "Preserved offset mask: "+note.offsets.join(", ")+"; choosing a value replaces them." : "Delay in sixths of a step";
      offset.onchange=function () { const value=offset.value; change(()=>project.setNote(track,slot,step,n,{offset:value})); };
      row.append(offset); container.append(row);
      if (note.enabled) { const info=element("div","gate-duration", "Note "+(n+1)+": "+((note.gate+1)/8).toFixed(3)+" steps"); container.append(info); }
    });
  }
  function positionNotePanel() {
    const anchor=!$("drum-overlay").hidden ? selectedStepButton() : $("step-edit-"+step); if (!anchor || !anchor.getBoundingClientRect) return;
    const box=anchor.getBoundingClientRect(), panel=$("note-panel");
    const width=Math.min(420,window.innerWidth-24), height=panel.offsetHeight || 240;
    panel.style.width=width+"px"; panel.style.left=Math.max(12,Math.min(box.left,window.innerWidth-width-12))+"px";
    panel.style.top=Math.max(12,Math.min(box.bottom+6,window.innerHeight-height-12))+"px";
  }
  function openNotePanel() {
    if (!commitPendingField() || !project.patterns[track].has(slot)) return;
    notePanel=true; $("note-panel").hidden=false; render(); focusNote("pitch");
  }
  function closeNotePanel(returnFocus) {
    notePanel=false; $("note-panel").hidden=true;
    const anchor=selectedStepButton();
    if (returnFocus && anchor) anchor.focus();
  }
  function selectedStepButton() {
    return $(stepButtonId());
  }
  function noteField(id) {
    const match=/^(panel-)?note-(\d+)-(enabled|pitch|velocity|gate|offset)$/.exec(id);
    return match ? {prefix:match[1] ? "panel-note-" : "note-",n:Number(match[2]),field:match[3]} : null;
  }
  function focusNote(field="pitch",prefix=notePanel ? "panel-note-" : "note-",n) {
    if (!project.patterns[track].has(slot)) {
      const input=!$("drum-overlay").hidden ? $(selectedDrumNote()===null ? "drum-pitch-"+track : "drum-note-pitch-"+track+"-"+drumNote) : $("empty-add");
      if (input) {input.focus();if (input.select && input.type==="number") input.select();}return;
    }
    if(prefix==="note-"&&window.SquidWorkbench)window.SquidWorkbench.reveal("step");
    const notes=project.step(track,slot,step).notes;
    if (n===undefined) n=selectedDrumNote()===null ? Math.max(0,notes.findIndex(note=>note.enabled)) : drumNote;
    let input=$(prefix+n+"-"+field);
    if (!input) {n=Math.max(0,notes.findIndex(note=>note.enabled));input=$(prefix+n+"-"+field);}
    if (!input || input.disabled) input=$(prefix+n+"-pitch");
    if (input) {input.focus();if (input.select && input.type==="number") input.select();}
  }
  function moveStep(delta,field) {
    const original=document.activeElement.id;
    if (!commitPendingField()) {render();if ($(original)) $(original).focus();return false;}
    if (!project.patterns[track].has(slot) && $("drum-overlay").hidden) return false;
    const length=!$("drum-overlay").hidden || $("show-stored-steps").checked || $("step-page-select").value==="all" ? 64 : (project.pattern(track,slot)[4]&15)*16;
    step=Math.max(0,Math.min(length-1,step+delta));render();
    if (field) focusNote(field.field,field.prefix,field.n);
    else {const button=selectedStepButton();if (button) button.focus();}
    return true;
  }
  function tabNotes(event,field) {
    const prefix=field ? field.prefix : "panel-note-",original=event.target.id,ids=[];
    event.preventDefault();
    if (!commitPendingField()) {render();if (field) focusNote(field.field,field.prefix,field.n);return;}
    render();
    if (prefix==="panel-note-") ids.push("close-note-panel");
    for (let n=0;n<8;n++) for (const key of ["enabled","pitch","velocity","gate","offset"]) {
      const id=prefix+n+"-"+key;if ($(id) && !$(id).disabled) ids.push(id);
    }
    const index=ids.indexOf(original),next=index+(event.shiftKey ? -1 : 1);
    let input;
    if (prefix==="note-" && next<0) input=!$("stored-steps-control").hidden ? $("show-stored-steps") : selectedStepButton();
    else if (prefix==="note-" && next>=ids.length) input=$("show-all-notes");
    else input=$(ids[(next+ids.length)%ids.length]);
    if (input) {input.focus();if (input.select && input.type==="number") input.select();}
  }
  function render() {
    if (renderFrame) { cancelAnimationFrame(renderFrame); renderFrame=0; }
    const focused = document.activeElement.id;
    const bytes = project.serialize(); dirty = !equal(saved,bytes);
    $("validation-error").hidden = !validationFailure;
    $("validation-message").textContent = validationFailure ? validationFailure + " The previous value is kept." : "";
    $("project-name").value = project.name; $("bpm").value = project.bpm;
    $("save-state").textContent = dirty ? "Edited since open" : "No changes";
    $("save-state").className = "save-state" + (dirty ? " dirty" : "");
    $("undo").disabled = !past.length; $("redo").disabled = !future.length;
    document.title = (dirty ? "• " : "") + project.name + " — SQUID editor";
    const info = project.track(track);
    $("track-number").textContent = "Track "+String(track+1).padStart(2,"0");
    $("track-name").value = info.name; $("track-route").textContent = routeLabel(info);
    $("track-color").value=info.color===null ? "" : info.color;$("track-color").disabled=!info.isV3;
    $("track-color").title=info.isV3 ? "SQUID palette #"+String(info.color+1).padStart(2,"0") : "Color editing requires V3 track settings.";
    $("track-color-swatch").style.backgroundColor=info.color===null ? "transparent" : F.TRACK_COLORS[info.color].hex;
    $("track-port").value = info.port; $("track-channel").value = info.channel;
    $("track-delay").value = info.delay;
    for (const id of ["track-port","track-channel","track-delay","bank-msb","bank-lsb","program"])
      $(id).disabled = !info.isV3;
    $("routing-note").hidden = info.isV3;
    $("track-mute").checked=info.mute; $("track-solo").checked=info.solo;
    $("track-mono").checked=info.mono;$("track-mono").disabled=!info.isV3;
    $("track-mute").disabled=$("track-solo").disabled=!info.isV3;
    const start=$("track-start-pattern");start.replaceChildren();
    for(let s=0;s<64;s++)option(start,s,"Pattern "+String(s+1).padStart(2,"0")+(project.patterns[track].has(s) ? "" : " · Empty"));
    start.value=info.selectedPattern===null ? "" : info.selectedPattern;start.disabled=!info.isV3;
    $("set-start-pattern").disabled=!info.isV3||info.selectedPattern===slot;
    $("track-start-note").hidden=info.selectedPattern===null||project.patterns[track].has(info.selectedPattern);
    $("track-start-note").textContent="Starting pattern "+String(info.selectedPattern+1).padStart(2,"0")+" is empty.";
    for(let lane=0;lane<5;lane++) { $("track-cc-"+lane).value=info.ccNumbers ? info.ccNumbers[lane] : ""; $("track-cc-"+lane).disabled=!info.isV3; }
    $("track-channel").disabled = !info.isV3 || info.port===0 || info.port>3;
    $("bank-msb").value = info.bankMSB===255 ? "" : info.bankMSB;
    $("bank-lsb").value = info.bankLSB===255 ? "" : info.bankLSB;
    $("program").value = info.program===255 ? "" : info.program;
    $("file-status").textContent = "Source: " + filename + " · " + project.count + " patterns · " + (bytes.length/1024).toLocaleString()+" KiB"
      + (lastExportName ? " · Export requested: " + lastExportName : "");
    $("file-status").title = $("file-status").textContent;
    renderTracks(); renderBank(); renderGrid();
    $("file-warnings").textContent=project.warnings.join(" "); $("file-warnings").hidden=!project.warnings.length;
    afterRender();
    if(project.patterns[track].has(slot))renderInspector();
    if(document.querySelector){
      for(const error of document.querySelectorAll(".inline-field-error"))error.remove();
      for(const input of document.querySelectorAll("[aria-invalid=true]")){input.removeAttribute("aria-invalid");input.removeAttribute("aria-describedby");}
      const field=invalidField&&$(invalidField);if(validationFailure&&field){const error=element("span","inline-field-error",validationFailure+" Previous value kept.");error.id="field-error";error.setAttribute("role","alert");field.setAttribute("aria-invalid","true");field.setAttribute("aria-describedby",error.id);(field.closest("label")||field.closest(".note-row")||field.parentElement).append(error);}
    }

    if(window.SquidNumbers)window.SquidNumbers.sync();
    if(notePanel)positionNotePanel();
    const focus=/^(step-\d+|drum-step-\d+-\d+|drum-note-\d+-\d+-\d+)$/.test(focused) ? selectedStepButton() : $(focused);
    if (focus && !focus.disabled) focus.focus({preventScroll:true});
  }
  function load(bytes, name) {
    if (!commitPendingField()) return false;
    let next;
    try { next = Project.parse(bytes); } catch (error) { toast(error.message,true); return false; }
    if (dirty && !window.confirm("Open another project? Export your current edits first if you want to keep them.")) return false;
    project = next; saved = bytes.slice(); filename = name;
    lastExportName = ""; trackViews = Array(16).fill(null); $("show-stored-steps").checked = false;
    track = 0; slot = startingPattern(track);
    step = 0; past = []; future = []; render(); toast("Opened "+project.name);
    return true;
  }
  async function readFile(file) {
    if (!file) return;
    if (file.size > F.PAGE*(1+16*64)) { toast("This file is larger than a SQUID project.",true); return; }
    try { load(new Uint8Array(await file.arrayBuffer()),file.name); }
    catch (error) { toast("Could not read the file: "+error.message,true); }
  }
  function download() {
    if (!commitPendingField()) return;
    try {
      const bytes = project.serialize(); Project.parse(bytes);
      const blob = new Blob([bytes],{type:"application/octet-stream"}), url = URL.createObjectURL(blob);
      const a = element("a"); a.href = url;
      a.download = (project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,"_") || "SQUID project") + "_" + new Date().toISOString().replace(/[-:]/g,"").replace("T","_").replace(".","_").replace("Z","") + ".prj";
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); },30000);
      lastExportName = a.download; render(); toast("Export requested: "+a.download);
    } catch (error) { toast(error.message,true); }
  }
  function nextEmpty() {
    if (!project.patterns[track].has(slot)) return slot;
    for (let s = 0; s < 64; s++) if (!project.patterns[track].has(s)) return s;
    throw new Error("All 64 pattern slots are occupied.");
  }
  $("open-project").onclick = function () { if (commitPendingField()) $("file-input").click(); };
  $("file-input").onchange = function () { const file = $("file-input").files[0]; $("file-input").value = ""; readFile(file); };
  $("example-project").onclick = function () { load(example.slice(),"Editor example"); };
  $("new-project").onclick = function () {
    if (!commitPendingField()) return;
    if (dirty && !window.confirm("Create a new project? Export your current edits first if you want to keep them.")) return;
    try {
      project = Project.create("Untitled project"); project.addPattern(0,0);
      saved = project.serialize(); filename = "New project"; past = []; future = [];
      lastExportName = ""; trackViews = Array(16).fill(null); $("show-stored-steps").checked = false;
      track = 0; slot = 0; step = 0; render(); toast("New project · USB channels 1–16");
    } catch (error) { toast(error.message,true); }
  };
  $("save-project").onclick = download;
  $("dismiss-invalid").onclick = function () { validationFailure = ""; invalidField=""; render(); };
  $("show-all-notes").onchange=render;
  $("close-note-panel").onclick=function () { if (commitPendingField()) closeNotePanel(true); };
  window.addEventListener("resize",positionNotePanel);
  window.addEventListener("scroll",function () { if(notePanel) positionNotePanel(); },true);
  $("show-stored-steps").onchange = function () {
    if (!$("show-stored-steps").checked && step >= (project.pattern(track,slot)[4]&15)*16) step = 0;
    render();
  };
  $("project-name").onchange = function () { const value = $("project-name").value; change(function () { project.name = value; }); };
  $("bpm").onchange = function () { const value = $("bpm").valueAsNumber; change(function () { project.bpm = value; }); };
  $("track-name").onchange = function () { const value = $("track-name").value; change(function () { project.setTrack(track,"name",value); }); };
  $("track-color").onchange = function () {const value=$("track-color").value;change(()=>project.setTrack(track,"color",value));};
  $("track-start-pattern").onchange=function(){const value=$("track-start-pattern").value;change(()=>project.setTrack(track,"selectedPattern",value));};
  $("set-start-pattern").onclick=function(){if(commitPendingField())change(()=>project.setTrack(track,"selectedPattern",slot));};
  const trackControls = {"track-port":"port","track-channel":"channel","track-delay":"delay","bank-msb":"bankMSB","bank-lsb":"bankLSB","program":"program"};
  Object.keys(trackControls).forEach(function (id) {
    $(id).onchange = function () {
      const el=$(id), key = trackControls[id];
      const value=el.value==="" && ["bankMSB","bankLSB","program"].includes(key) ? 255 : el.type==="number" ? el.valueAsNumber : el.value;
      change(function () { project.setTrack(track,key,value==="" && ["bankMSB","bankLSB","program"].includes(key) ? 255 : value); });
    };
  });
  for(const key of ["mute","solo","mono"]) $("track-"+key).onchange=function () { const value=$("track-"+key).checked; change(()=>project.setTrack(track,key,value)); };
  for(let lane=0;lane<5;lane++) $("track-cc-"+lane).onchange=function () { const value=$("track-cc-"+lane).valueAsNumber; change(()=>project.setTrack(track,"cc"+lane,value)); };
  const patternControls = {"pattern-pages":"pages","pattern-speed":"speed","pattern-direction":"direction"};
  Object.keys(patternControls).forEach(function (id) {
    $(id).onchange = function () {
      const value = $(id).value; change(function () { project.setPattern(track,slot,patternControls[id],value); });
    };
  });
  const stepControls = {"step-enabled":"enabled","step-slide":"slide","step-tie":"tie","step-harmonizer":"harmonizer","step-count":"count","step-divide":"divide","step-transpose":"transpose"};
  Object.keys(stepControls).forEach(function (id) {
    $(id).onchange = function () {
      const value = $(id).type === "checkbox" ? $(id).checked : $(id).value;
      change(function () { project.setStep(track,slot,step,stepControls[id],value); });
    };
  });
  function addPattern() { change(function () { slot = nextEmpty(); project.addPattern(track,slot); step = 0; }); }
  $("add-pattern").onclick = addPattern; $("empty-add").onclick = addPattern;
  $("duplicate-pattern").onclick = function () {
    if (change(function () { const source = project.pattern(track,slot); slot = nextEmpty(); project.addPattern(track,slot,source); step = 0; }))
      toast("Duplicate created in pattern "+String(slot+1).padStart(2,"0"));
  };
  $("delete-pattern").onclick = function () { change(function () { project.deletePattern(track,slot); step = 0; }); };
  $("clear-step").onclick = function () { change(function () { const n=selectedDrumNote();if(n===null)project.clearStep(track,slot,step);else project.setNote(track,slot,step,n,{enabled:false}); }); };
  $("copy-step").onclick=function () { if(commitPendingField() && project.patterns[track].has(slot)) { stepClipboard=project.copyStep(track,slot,step); render(); toast("Step copied"); } };
  $("paste-step").onclick=function () { if(commitPendingField() && stepClipboard) change(()=>project.pasteStep(track,slot,step,stepClipboard)); };
  function enterChord(notes,location,advance) {
    if (!commitPendingField() || !notes.length) return false;
    const [t,s,st]=location||[track,slot,step];
    const ok=change(function () {
      if(!project.patterns[t].has(s))throw new Error("Create a pattern before entering notes.");
      for(const note of notes){
        const data=project.step(t,s,st);let n=data.notes.findIndex(n=>n.enabled && n.pitch===note.pitch);
        if(n<0)n=data.notes.findIndex(n=>!n.enabled);
        if(n<0)throw new Error("This step already has eight notes.");
        project.setNote(t,s,st,n,{enabled:true,pitch:note.pitch,velocity:note.velocity,gate:7,offset:0});
      }
      project.setStep(t,s,st,"enabled",true);
      if(advance && track===t && slot===s && step===st)step=(step+1)%((project.pattern(t,s)[4]&15)*16);
    });return ok;
  }
  function updatePianoControls(){
    $("piano-mode").textContent=pianoMode?"Piano keys on · Octave "+pianoOctave:"Piano keys off";
    $("piano-mode").setAttribute("aria-pressed",pianoMode);
    $("piano-status").hidden=!pianoMode;$("piano-status").textContent="A = C"+pianoOctave+" · Z/X change octave";
  }
  $("piano-mode").onclick=function () { pianoMode=!pianoMode; heldKeys.clear();typedNotes=[];updatePianoControls();const button=selectedStepButton();if (button) button.focus(); };
  $("undo").onclick = function () {
    if (!past.length) return;
    future.push(snapshot()); trimHistory(future); restore(past.pop()); render();
    toast("Undid edit · Track "+(track+1)+", pattern "+(slot+1)+", step "+(step+1));
  };
  $("redo").onclick = function () {
    if (!future.length) return;
    past.push(snapshot()); trimHistory(past); restore(future.pop()); render();
    toast("Redid edit · Track "+(track+1)+", pattern "+(slot+1)+", step "+(step+1));
  };
  $("help-button").onclick = function () { $("help-dialog").showModal(); };
  $("close-help").onclick = $("help-done").onclick = function () { $("help-dialog").close(); };
  document.addEventListener("keydown",function (event) {
    const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
    if(event.isComposing || event.defaultPrevented)return;
    if(modalOpen())return;
    const field=noteField(event.target.id),gridStep=/^(step-\d+|drum-step-\d+-\d+|drum-note-\d+-\d+-\d+)$/.test(event.target.id);
    if (event.key==="Escape") {
      if ((notePanel || field) && commitPendingField()) {event.preventDefault();closeNotePanel(true);} return;
    }
    if (mod && key === "s") { event.preventDefault(); download(); return; }
    if (mod && key === "o") { event.preventDefault(); if (commitPendingField()) $("file-input").click(); return; }
    if (!mod && event.altKey && ["ArrowLeft","ArrowRight"].includes(event.key) &&
        (field || !/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName))) {
      event.preventDefault();moveStep(event.key==="ArrowRight" ? 1 : -1,field);return;
    }
    const fieldKey=event.altKey && event.code ? event.code.replace(/^Key/,"").toLowerCase() : key;
    if (!mod && event.altKey && ["p","v","l"].includes(fieldKey)) {
      event.preventDefault();if (commitPendingField()) {render();focusNote({p:"pitch",v:"velocity",l:"gate"}[fieldKey],field ? field.prefix : undefined,field ? field.n : undefined);}return;
    }
    if (!mod && !event.altKey && event.key==="Enter" && field) {
      event.preventDefault();const value=event.target.valueAsNumber;
      if (!commitPendingField()) {render();focusNote(field.field,field.prefix,field.n);return;}
      if (!event.shiftKey && field.field==="pitch" && !project.step(track,slot,step).notes[field.n].enabled &&
          !change(()=>editNote(field.n,{pitch:value}))) {render();focusNote(field.field,field.prefix,field.n);return;}
      moveStep(event.shiftKey ? -1 : 1,field);return;
    }
    if (!mod && !event.altKey && event.shiftKey && ["ArrowUp","ArrowDown"].includes(event.key) && field && ["pitch","velocity","gate"].includes(field.field)) {
      event.preventDefault();
      if (!commitPendingField()) {render();focusNote(field.field,field.prefix,field.n);return;}
      const amount={pitch:12,velocity:10,gate:8}[field.field],max=field.field==="gate" ? 511 : 127;
      const value=Math.max(0,Math.min(max,project.step(track,slot,step).notes[field.n][field.field]+(event.key==="ArrowUp" ? amount : -amount)));
      change(()=>editNote(field.n,{[field.field]:value}));render();focusNote(field.field,field.prefix,field.n);return;
    }
    if (!mod && !event.altKey && event.key==="Tab") {
      if (gridStep && !event.shiftKey) {event.preventDefault();focusNote("pitch");return;}
      if (field || (notePanel && event.target.id==="close-note-panel")) {tabNotes(event,field);return;}
    }
    const regionKey=event.altKey && /^Digit[1-4]$/.test(event.code||"") ? event.code.slice(-1) : key;
    if(!mod && event.altKey && /^[1-4]$/.test(regionKey)) {
      event.preventDefault();if (!commitPendingField()) return;render();
      if (regionKey==="4") focusNote("pitch");
      else {const ids=["track-"+track,"pattern-"+slot,selectedStepButton() ? selectedStepButton().id : "empty-add"];if ($(ids[Number(regionKey)-1])) $(ids[Number(regionKey)-1]).focus();}return;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    if(event.altKey)return;
    if (!mod && ["p","v","l"].includes(key)) {event.preventDefault();focusNote({p:"pitch",v:"velocity",l:"gate"}[key]);return;}
    if(!mod && key==="`"){event.preventDefault();$("piano-mode").click();return;}
    if(pianoMode && !mod){
      if(key==="z"||key==="x"){event.preventDefault();pianoOctave=Math.max(-1,Math.min(8,pianoOctave+(key==="x"?1:-1)));updatePianoControls();return;}
      const index="awsedftgyhujk".indexOf(key);
      if(index>=0 && key.length===1){event.preventDefault();if(!event.repeat && !heldKeys.has(key)){
        const pitch=(pianoOctave+1)*12+index;if(pitch<=127){if(!heldKeys.size)typedLocation=[track,slot,step];heldKeys.add(key);typedNotes.push({pitch,velocity:100});}
      }return;}
    }
    if (mod && key === "z") { event.preventDefault(); $(event.shiftKey ? "redo" : "undo").click(); }
    else if (mod && key === "y") { event.preventDefault(); $("redo").click(); }
    else if(mod && key==="c") {event.preventDefault();if(event.shiftKey){if(project.patterns[track].has(slot)){patternClipboard=project.pattern(track,slot).slice();toast("Pattern copied");}}else $("copy-step").onclick();}
    else if(mod && key==="v") {event.preventDefault();if(event.shiftKey && patternClipboard)change(()=>project.addPattern(track,slot,patternClipboard));else if(!event.shiftKey)$("paste-step").onclick();}
    else if(mod && key==="d"){event.preventDefault();if(!$("duplicate-pattern").disabled)$("duplicate-pattern").onclick();}
    else if (!mod && ["Delete","Backspace"].includes(event.key) && project.patterns[track].has(slot)) { event.preventDefault(); $("clear-step").onclick(); }
    else if(!mod && event.key===" " && /^step-(\d+)$/.test(event.target.id)){event.preventDefault();toggleFirstNote(step);}
    else if(!mod && event.key==="Enter" && /^step-(\d+)$/.test(event.target.id)){event.preventDefault();openNotePanel();}
    else if(!mod && key==="n"){event.preventDefault();if(!$("add-pattern").disabled)$("add-pattern").onclick();}
    else if(!mod && ["g","i","m"].includes(key)){event.preventDefault();$({g:"generate-pattern",i:"midi-import",m:"midi-export"}[key]).click();}
  });
  document.addEventListener("keyup",function (event) {
    if(modalOpen()){heldKeys.clear();typedNotes=[];return;}
    if(heldKeys.delete(event.key.toLowerCase()) && !heldKeys.size){enterChord(typedNotes,typedLocation,$("piano-advance").checked);typedNotes=[];}
  });
  window.addEventListener("blur",function () {heldKeys.clear();typedNotes=[];});
  window.addEventListener("beforeunload",function (event) { const committed = commitPendingField(); if (!committed || dirty) { event.preventDefault(); event.returnValue = ""; } });
  document.addEventListener("dragenter",function (event) {
    if (event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); dragDepth++; $("drop-overlay").hidden = false; }
  });
  document.addEventListener("dragover",function (event) { event.preventDefault(); });
  document.addEventListener("dragleave",function (event) {
    event.preventDefault(); dragDepth = Math.max(0,dragDepth-1);
    if (!dragDepth) $("drop-overlay").hidden = true;
  });
  document.addEventListener("drop",function (event) {
    event.preventDefault(); dragDepth = 0; $("drop-overlay").hidden = true;
    readFile(event.dataTransfer.files[0]);
  });
  document.addEventListener("change",event=>{if(event.target&&event.target.id)lastField=event.target.id;},true);
  slot=startingPattern(track);render();
  if(window.SquidTools) afterRender=window.SquidTools.setup({
    getProject:()=>project,getSelection:()=>[track,slot,step],getNoteSelection:selectedDrumNote,setNoteSelection:n=>{drumNote=n;},stepButtonId,commit:commitPendingField,change,toast,enterChord,decorateStep,loadProject:load,
    select:function(t,s,st=0){trackViews[track]={slot,step};track=t;slot=s;step=st;render();},
    getTrackSelections:()=>Array.from({length:16},(_,t)=>t===track ? slot : trackViews[t] ? trackViews[t].slot : startingPattern(t)),
    recallSet:function(index){return change(function(){const entries=project.recallPatternSet(index);entries.forEach((e,t)=>{if(e.slot!==null)trackViews[t]={slot:e.slot,step:0};});if(entries[track].slot!==null){slot=entries[track].slot;step=0;}});},
    applyBytes:function(bytes,selection){return change(function(){project=Project.parse(bytes);if(selection)[track,slot,step]=selection;});},
    loadSession:function(bytes,name,selection){
      if(!load(bytes,name))return false;saved=new Uint8Array();
      if(Array.isArray(selection)&&selection.length===3&&selection.every((n,i)=>Number.isInteger(n)&&n>=0&&n<([16,64,64][i]))) [track,slot,step]=selection;
      render();return true;
    },
    openNotes:function(t,s,st,n){trackViews[track]={slot,step};track=t;slot=s;step=st;if(n!==undefined)drumNote=n;openNotePanel();}
  });
  render();
})();
