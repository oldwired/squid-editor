(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.SquidDrums=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  function groups(project){const map=new Map();for(let t=0;t<16;t++){
    const info=project.track(t),match=/^dr([1-9]\d*)_(.+)$/i.exec(info.name);if(!match)continue;
    const id=Number(match[1]);if(!map.has(id))map.set(id,[]);map.get(id).push({track:t,name:match[2]});
  }return Array.from(map,([id,rows])=>({id,rows})).sort((a,b)=>a.id-b.id);}
  const NOTE_PITCHES=[36,38,42,46,39,45,49,51];
  function isSingleTrack(project,t){return /^dr_/i.test(project.track(t).name);}
  function singleNameFor(name){const result="DR_"+name.replace(/^dr(?:[1-9]\d*)?_/i,"");
    if(result.length>31)throw new Error("The DR_ prefix needs three characters. Shorten the track name to 28 characters first.");return result;}
  function nameFor(name,id){if(!Number.isInteger(id)||id<1||id>99)throw new Error("Drum group must be 1–99.");
    const suffix=name.replace(/^dr(?:[1-9]\d*)?_/i,"").trim().toLowerCase().replace(/\s+/g,"_")||"drum";
    const result="dr"+id+"_"+suffix;if(result.length>31)throw new Error("Track name "+result+" exceeds 31 characters. Shorten it first.");return result;}
  function guessPitch(name){if(/kick|bass.?drum/i.test(name))return 36;if(/snare/i.test(name))return 38;if(/clap/i.test(name))return 39;
    if(/open.*(hat|hh)/i.test(name))return 46;if(/hat|hh/i.test(name))return 42;if(/ride/i.test(name))return 51;if(/crash|clash/i.test(name))return 49;if(/tom/i.test(name))return 45;return 60;}
  function routingPlan(project,tracks){
    const ordered=Array.from(new Set(tracks)).sort((a,b)=>a-b);
    if(!ordered.length)throw new Error("Select at least one participating track.");
    for(const t of ordered)if(!project.track(t).isV3)throw new Error("Normalising routing requires V3 settings on every participating track.");
    const source=project.track(ordered[0]);
    // Stage only the header, sharing untouched pattern pages. Invalid source
    // fields must not leave any participating track partially changed.
    const staged=new project.constructor(project.header.slice(),project.patterns);
    for(const t of ordered){
      for(const key of ["port","channel","delay","bankMSB","bankLSB","program"])staged.setTrack(t,key,source[key]);
      source.ccNumbers.forEach((number,lane)=>staged.setTrack(t,"cc"+lane,number));
    }
    return {tracks:ordered,source:ordered[0],settings:source,header:staged.header};
  }
  function normaliseRouting(project,tracks){const plan=routingPlan(project,tracks);project.header.set(plan.header);return plan.source;}
  function sceneState(project,index,group){
    const scene=project.patternSet(index),entries=group.rows.map(r=>scene.entries[r.track]),assigned=entries.filter(e=>e.slot!==null);
    const slot=entries.every(e=>e.slot===entries[0].slot) ? entries[0].slot : "mixed";
    const mute=assigned.length&&assigned.every(e=>e.mute===assigned[0].mute) ? assigned[0].mute : assigned.length ? "mixed" : false;
    return {slot,mute,assigned:assigned.length,count:entries.length};
  }
  function setScene(project,index,group,key,value){
    if(!["slot","mute"].includes(key))throw new Error("Choose a drum scene control.");
    // Stage the header so invalid member/slot values cannot partly update a group.
    const staged=new project.constructor(project.header.slice(),project.patterns);
    for(const r of group.rows)if(key==="slot"||staged.patternSet(index).entries[r.track].slot!==null)staged.setPatternSetTrack(index,r.track,key,value);
    project.header.set(staged.header);
  }
  function toggleHit(project,t,s,step,pitch){
    if(!Number.isInteger(pitch)||pitch<0||pitch>127)throw new Error("Drum pitch must be 0–127.");
    if(!project.patterns[t].has(s))project.addPattern(t,s);
    if(step>=(project.pattern(t,s)[4]&15)*16)project.setPattern(t,s,"pages",Math.floor(step/16)+1);
    const data=project.step(t,s,step),notes=data.notes.filter(n=>n.enabled);
    if(notes.length)project.setStep(t,s,step,"enabled",!data.enabled);
    else{project.setNote(t,s,step,0,{enabled:true,pitch,velocity:100,gate:7,offset:0});project.setStep(t,s,step,"enabled",true);}
  }
  function toggleNoteHit(project,t,s,step,n,pitch){
    if(!Number.isInteger(n)||n<0||n>7)throw new Error("Drum note slot must be 1–8.");
    if(!Number.isInteger(pitch)||pitch<0||pitch>127)throw new Error("Drum pitch must be 0–127.");
    if(!Number.isInteger(step)||step<0||step>63)throw new Error("Step must be 1–64.");
    if(!project.patterns[t].has(s))project.addPattern(t,s);
    if(step>=(project.pattern(t,s)[4]&15)*16)project.setPattern(t,s,"pages",Math.floor(step/16)+1);
    const data=project.step(t,s,step),note=data.notes[n];
    if(note.enabled)project.setNote(t,s,step,n,{enabled:false});
    else{
      // A retained offset marks a previously stored hit. Re-enabling it keeps
      // its articulation and pitch, while a fresh hit uses the row's defaults.
      const patch=note.offsets.length ? {enabled:true} : {enabled:true,pitch,velocity:100,gate:7};
      project.setNote(t,s,step,n,patch);
      if(!data.enabled)project.setStep(t,s,step,"enabled",true);
    }
  }
  function setup(editor){
    const $=id=>document.getElementById(id),F=window.SquidProject,node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
    const option=(select,value,label)=>{const el=node("option",label);el.value=value;select.append(el);};
    const pitches=new Map();let signature="",activeGroup=null,lastProject=null,lastTrack=null,lastMembership=null;
    const cellId=(r,st)=>r.noteSlot===undefined ? "drum-step-"+r.track+"-"+st : "drum-note-"+r.track+"-"+r.noteSlot+"-"+st;
    const choose=(r,s,st)=>{if(r.noteSlot!==undefined)editor.setNoteSelection(r.noteSlot);editor.select(r.track,s,st);};
    const openRow=(r,s,st)=>editor.openNotes(r.track,s,st,r.noteSlot);
    function render(){
      const p=editor.getProject(),all=groups(p),singles=Array.from({length:16},(_,t)=>t).filter(t=>isSingleTrack(p,t)),[track,slot,step]=editor.getSelection(),view=$("editor-view"),next=JSON.stringify([all,singles.map(t=>[t,p.track(t).name])]);
      if(p!==lastProject){pitches.clear();lastProject=p;}
      if(next!==signature){const selected=view.value;view.replaceChildren();option(view,"track","Track");for(const group of all)option(view,group.id,"Drum group "+group.id);for(const t of singles)option(view,"notes:"+t,"Drum notes · T"+(t+1)+" · "+p.track(t).name.slice(3));view.value=all.some(g=>String(g.id)===selected)||singles.some(t=>"notes:"+t===selected)?selected:"track";signature=next;}
      const membership=all.find(g=>g.rows.some(r=>r.track===track)),groupId=isSingleTrack(p,track) ? "notes:"+track : membership ? String(membership.id) : null;
      // Follow track selection; an explicit View choice lasts until the track
      // or its group membership changes, rather than being reset by every edit.
      if(track!==lastTrack || groupId!==lastMembership){view.value=groupId || "track";lastTrack=track;lastMembership=groupId;}
      const single=view.value==="notes:"+track&&isSingleTrack(p,track);
      $("split-drums").disabled=isSingleTrack(p,track);
      activeGroup=single ? {rows:Array.from({length:8},(_,n)=>({track,noteSlot:n,name:"Note "+(n+1)}))} : all.find(g=>String(g.id)===view.value)||null;
      if(activeGroup && !activeGroup.rows.some(r=>r.track===track)){view.value="track";activeGroup=null;}
      $("grid-velocity-label").textContent=single ? "Vel" : "Vel · slots 1–8 →";
      $("grid-shortcuts").textContent=single ? "Click / Space: toggle note · ↑/↓: lanes · Enter: edit · Delete: clear note" : activeGroup ? "Click / Space: toggle step trigger · ↑/↓: tracks · Enter: edit" : "Space / Shift-click / right-click: toggle note 1 · Enter: edit";
      $("drum-overlay").hidden=!activeGroup;if(!activeGroup)return;
      $("step-grid").hidden=true;$("empty-pattern").hidden=true;
      $("drum-title").textContent=(single ? p.track(track).name+" · 8 note lanes" : "Drum group "+activeGroup.id)+" · Pattern slot "+String(slot+1).padStart(2,"0");
      $("drum-help").textContent=single ? "Each row is one note slot on this track. Draw hits toggles only that note. Select steps or Shift-click selects without changing it; Space toggles and Enter edits. Pitch sets new hits. Routing, pattern settings, step skip, CC and other step controls are shared by all eight lanes." : "Same pattern slot across every row. Draw hits toggles the shared step trigger (notes and CC); an empty step adds a hit. Select steps or Shift-click selects without changing it. Enter or the row’s Edit button opens notes. Pitch sets new hits.";
      if(activeGroup.rows.some(r=>r.track===track))$("drum-page").value=Math.floor(step/16);
      const size=window.innerWidth&&window.innerWidth<=1350 ? window.innerWidth<=650?4:8 : 16;
      $("drum-overlay").dataset.pageSize=size;if($("drum-rows").style.setProperty)$("drum-rows").style.setProperty("--drum-columns",size);
      const pager=$("drum-page");pager.replaceChildren();for(let page=0;page<64/size;page++)option(pager,page,"Steps "+(page*size+1)+"–"+(page*size+size));pager.value=Math.floor(step/size);
      const page=Number(pager.value)||0;$("drum-rows").replaceChildren();
      for(let rowIndex=0;rowIndex<activeGroup.rows.length;rowIndex++){
        const r=activeGroup.rows[rowIndex],present=p.patterns[r.track].has(slot),row=node("div"),length=present ? (p.pattern(r.track,slot)[4]&15)*16 : 0,fx=present ? p.effects(r.track,slot) : null,selectedRow=r.track===track&&(!single||r.noteSlot===editor.getNoteSelection());row.className="drum-row"+(selectedRow?" selected-row":"");
        const label=node("div");label.className="drum-row-label";
        let defaultPitch=60,foundPitches=new Set();if(present)for(let st=0;st<64;st++){const data=p.step(r.track,slot,st),n=single ? data.notes[r.noteSlot] : data.notes.find(n=>n.enabled);if(n&&n.enabled){if(!foundPitches.size)defaultPitch=n.pitch;foundPitches.add(n.pitch);}}
        const key=r.track+":"+slot+(single ? ":"+r.noteSlot : ""),pitch=node("input");pitch.type="number";pitch.min=0;pitch.max=127;pitch.id=single ? "drum-note-pitch-"+r.track+"-"+r.noteSlot : "drum-pitch-"+r.track;pitch.value=pitches.has(key)?pitches.get(key):defaultPitch;
        const select=node("button",r.name+(single ? "" : " · T"+(r.track+1)));select.id=single ? "drum-note-row-"+r.track+"-"+r.noteSlot : "drum-row-"+r.track;select.onclick=()=>choose(r,slot,step);label.append(select);
        pitch.setAttribute("aria-label","Pitch for new "+r.name+" hits");pitch.title="Pitch for new hits; existing notes keep their pitches.";
        const pitchLabel=node("span",F.noteName(Number(pitch.value)));pitchLabel.id=single ? pitch.id+"-name" : "drum-pitch-name-"+r.track;
        pitch.oninput=()=>{const n=pitch.valueAsNumber;pitchLabel.textContent=Number.isInteger(n)&&n>=0&&n<=127?F.noteName(n):"—";};
        pitch.onchange=()=>{const value=pitch.valueAsNumber;if(!Number.isInteger(value)||value<0||value>127){editor.toast("Drum pitch must be 0–127.",true);pitch.value=pitches.has(key)?pitches.get(key):defaultPitch;pitch.oninput();}else pitches.set(key,value);};
        const control=node("div");control.className="drum-pitch";control.append(window.SquidNumbers ? window.SquidNumbers.wrap(pitch) : pitch,pitchLabel);label.append(control);
        const info=p.track(r.track),status=node("small",(present?"":"Empty slot · ")+(F.PORTS[info.port]||"Legacy")+(info.channel ? " Ch "+info.channel : "")+(info.mute?" · Mute":"")+(info.solo?" · Solo":""));
        if(info.color!==null)label.style.borderLeftColor=F.TRACK_COLORS[info.color].hex;
        if(present){status.textContent+=" · "+length+" steps"+(fx.fixed?" · Fixed "+fx.fixedSteps:"")+(fx.probability?" · Prob "+fx.rate+"%":"")+(fx.swing?" · Swing "+fx.swing+"%":"")+(fx.arp?" · Arp":"")+(fx.scale?" · Scale "+fx.scale:"")+(single&&foundPitches.size>1?" · Varied pitches":"")+(single&&info.mono&&r.noteSlot>0?" · Mono: lane inaudible":"");}
        if(single){status.className="shared-status";status.textContent=foundPitches.size>1?"Varied pitches":info.mono&&r.noteSlot>0?"Mono: lane inaudible":"";if(status.textContent)status.className="";}label.append(status);row.append(label);
        const grid=node("div");grid.className="drum-cells";
        for(let local=0;local<size;local++){
          const st=page*size+local,data=present?p.step(r.track,slot,st):null,notes=data?(single ? data.notes.filter((n,i)=>i===r.noteSlot&&n.enabled) : data.notes.filter(n=>n.enabled)):[],hit=notes.length&&(single||data.enabled);
          const outside=present && (st>=length || (fx.fixed && st>=fx.fixedSteps)),button=node("button");button.append(node("span",String(st+1)));button.id=cellId(r,st);button.className="drum-cell"+(single?" single-note-cell":"")+(hit?" hit":"")+(data&&!data.enabled?" inactive":"")+(selectedRow&&st===step?" selected":"")+(local%4===0?" beat-start":"")+(outside?" outside":"");
          const description=r.name+", step "+(st+1)+", "+(hit?"hit":"off")+(notes.length?single ? ", "+F.noteName(notes[0].pitch) : ", "+notes.length+" stored notes":"")+(data&&!data.enabled?single ? ", step skipped for all lanes" : ", step skipped":"")+(present && st>=length?", outside pattern length":"")+(fx && fx.fixed && st>=fx.fixedSteps?", beyond fixed length":"");
          button.tabIndex=selectedRow&&st===step?0:-1;button.setAttribute("aria-label",description);button.title=description;button.setAttribute("aria-pressed",!!hit);if(selectedRow&&st===step)button.setAttribute("aria-current","step");
          if(data)editor.decorateStep(button,single ? {...data,notes:data.notes.map((n,i)=>({...n,enabled:i===r.noteSlot&&n.enabled}))} : data);
          const location=[r.track,slot,st];
          button.onclick=event=>{if(!editor.commit())return;choose(r,slot,st);if(event&&(event.shiftKey||$("drum-interaction")&&$("drum-interaction").value==="select"))return;editor.change(()=>single ? toggleNoteHit(editor.getProject(),...location,r.noteSlot,pitches.has(key)?pitches.get(key):defaultPitch) : toggleHit(editor.getProject(),...location,pitches.has(key)?pitches.get(key):defaultPitch));};
          button.onkeydown=event=>{
            if(event.altKey || event.metaKey || event.ctrlKey)return;
            if(event.key==="Enter"){event.preventDefault();if(present)openRow(r,slot,st);return;}
            if(event.key===" "){event.preventDefault();button.onclick();return;}
            if(single&&["Backspace","Delete"].includes(event.key)){event.preventDefault();if(present&&editor.commit()){choose(r,slot,st);editor.change(()=>editor.getProject().setNote(r.track,slot,st,r.noteSlot,{enabled:false}));}return;}
            let destRow=r,destStep=st;
            if(event.key==="ArrowLeft")destStep=Math.max(0,st-1);else if(event.key==="ArrowRight")destStep=Math.min(63,st+1);
            else if(event.key==="ArrowUp")destRow=activeGroup.rows[Math.max(0,rowIndex-1)];
            else if(event.key==="ArrowDown")destRow=activeGroup.rows[Math.min(activeGroup.rows.length-1,rowIndex+1)];
            else if(event.key==="Home")destStep=page*size;else if(event.key==="End")destStep=page*size+size-1;else return;
            event.preventDefault();if(!editor.commit())return;choose(destRow,slot,destStep);const focus=$(cellId(destRow,destStep));if(focus)focus.focus();
          };grid.append(button);
        }
        row.append(grid);const edit=node("button","Edit");edit.id=single ? "drum-note-edit-"+r.track+"-"+r.noteSlot : "drum-edit-"+r.track;edit.disabled=!present;edit.setAttribute("aria-label","Edit "+r.name+" notes at step "+(step+1));edit.onclick=()=>openRow(r,slot,step);row.append(edit);$("drum-rows").append(row);
      }
    }
    if($("drum-interaction"))$("drum-interaction").onchange=()=>{const [t,s,st]=editor.getSelection();editor.select(t,s,st);};
    window.addEventListener("resize",()=>{const [t,s,st]=editor.getSelection();if(!$("drum-overlay").hidden)editor.select(t,s,st);});
    $("editor-view").onchange=()=>{if(!editor.commit())return;const value=$("editor-view").value,group=groups(editor.getProject()).find(g=>String(g.id)===value),[t,s,st]=editor.getSelection();if(/^notes:\d+$/.test(value)){const dest=Number(value.slice(6));editor.select(dest,s,dest===t ? st : 0);}else if(group&&!group.rows.some(r=>r.track===t))editor.select(group.rows[0].track,s,0);else editor.select(t,s,st);};
    $("split-drums").onclick=()=>{if(!editor.commit())return;const [t,s,st]=editor.getSelection();if(editor.change(()=>{const p=editor.getProject();p.setTrack(t,"name",singleNameFor(p.track(t).name));})){render();$("editor-view").value="notes:"+t;editor.select(t,s,st);}};
    $("drum-page").onchange=()=>{const [t,s]=editor.getSelection();editor.select(t,s,Number($("drum-page").value)*Number($("drum-overlay").dataset.pageSize||16));};
    function selectedTracks(){return Array.from({length:16},(_,t)=>t).filter(t=>$("group-track-"+t).checked);}
    function existingGroup(){return groups(editor.getProject()).find(g=>g.id===$("drum-group-number").valueAsNumber);}
    function previewRouting(){
      const p=editor.getProject(),existing=existingGroup(),button=$("normalise-drum-group");
      $("drum-normalise-choice").hidden=!!existing;button.hidden=!existing;button.disabled=true;
      if(!existing && !$("drum-normalise-new").checked){$("drum-normalise-preview").textContent="Each participating track keeps its routing and program settings.";return true;}
      try{const plan=routingPlan(p,existing ? existing.rows.map(r=>r.track) : selectedTracks()),info=plan.settings,off=value=>value===255 ? "Off" : value;
        $("drum-normalise-preview").textContent=(existing ? "Group "+existing.id+" · " : "Selected tracks · ")+"Copy from T"+(plan.source+1)+" · "+info.name+" to tracks "+plan.tracks.map(t=>t+1).join(", ")+": "+
          F.PORTS[info.port]+" · Ch "+info.channel+" · Delay "+info.delay+" ms · Bank MSB "+off(info.bankMSB)+" / LSB "+off(info.bankLSB)+" · Program "+off(info.program)+" · CCs "+info.ccNumbers.join(", ");
        button.disabled=false;return true;
      }catch(error){$("drum-normalise-preview").textContent=error.message;return false;}
    }
    function previewNames(){
      $("drum-normalise-status").textContent="";const routingValid=previewRouting();
      try{const id=$("drum-group-number").valueAsNumber,p=editor.getProject(),selected=selectedTracks(),names=selected.map(t=>"T"+(t+1)+": "+nameFor(p.track(t).name,id));
        if(!names.length)throw new Error("Select at least one track.");
        $("drum-group-preview").textContent=names.join("\n");$("apply-drum-group").disabled=!existingGroup() && $("drum-normalise-new").checked && !routingValid;
      }catch(error){$("drum-group-preview").textContent=error.message;$("apply-drum-group").disabled=true;}
    }
    $("group-drums").onclick=()=>{if(!editor.commit())return;const p=editor.getProject(),[current]=editor.getSelection(),all=groups(p),currentGroup=all.find(g=>g.rows.some(r=>r.track===current));
      $("drum-group-tracks").replaceChildren();$("drum-group-number").value=currentGroup ? currentGroup.id : Array.from({length:99},(_,i)=>i+1).find(id=>!all.some(g=>g.id===id));$("drum-normalise-new").checked=true;
      for(let t=0;t<16;t++){const label=node("label"),check=node("input");label.className="check-label";check.type="checkbox";check.id="group-track-"+t;check.checked=currentGroup?currentGroup.rows.some(r=>r.track===t):t===current;check.onchange=previewNames;label.append(check,node("span","T"+(t+1)+" · "+p.track(t).name));$("drum-group-tracks").append(label);}
      previewNames();$("drum-group-dialog").showModal();};
    $("drum-group-number").onchange=$("drum-normalise-new").onchange=previewNames;$("close-drum-group").onclick=()=>{$("drum-group-dialog").close();$("create-drum-view").focus();};
    $("apply-drum-group").onclick=()=>{previewNames();if($("apply-drum-group").disabled)return;const id=$("drum-group-number").valueAsNumber;
      const normalise=!existingGroup() && $("drum-normalise-new").checked;
      const ok=editor.change(()=>{const p=editor.getProject(),selected=selectedTracks();if(normalise)normaliseRouting(p,selected);for(const t of selected)p.setTrack(t,"name",nameFor(p.track(t).name,id));});
      if(ok){render();$("editor-view").value=String(id);$("editor-view").onchange();$("drum-group-dialog").close();const focus=$(editor.stepButtonId());if(focus)focus.focus();}};
    $("normalise-drum-group").onclick=()=>{
      if(!editor.commit())return;const group=existingGroup();if(!group || !previewRouting())return;
      const tracks=group.rows.map(r=>r.track),source=tracks[0],sourceName=editor.getProject().track(source).name;
      if(editor.change(()=>normaliseRouting(editor.getProject(),tracks))){previewNames();$("drum-normalise-status").textContent="Normalised group "+group.id+" to T"+(source+1)+" · "+sourceName+". Undo restores the previous settings.";}
    };
    render();return render;
  }
  return {groups,nameFor,isSingleTrack,singleNameFor,guessPitch,toggleHit,toggleNoteHit,normaliseRouting,sceneState,setScene,setup};
});
