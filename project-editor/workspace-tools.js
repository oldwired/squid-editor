(function(root){
  "use strict";
  root.SquidTools={setup:function(editor){
    const F=root.SquidProject,M=root.SquidMusic,G=root.SquidGenerators,$=id=>document.getElementById(id);
    const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
    const option=(select,value,label)=>{const el=node("option",label);el.value=value;select.append(el);};
    const number=id=>{const input=$(id),n=input.valueAsNumber;if(!Number.isFinite(n))throw new Error((root.SquidNumbers ? root.SquidNumbers.labelFor(input) : input.parentElement.textContent.trim())+" needs a number.");return n;};
    const stamp=()=>new Date().toISOString().replace(/[-:]/g,"").replace("T","_").replace(".","_").replace("Z","");
    const safe=text=>String(text).replace(/[<>:"/\\|?*\x00-\x1f]/g,"_");
    function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),a=node("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);editor.toast("Export requested: "+name);}
    function tracks(select,current){select.replaceChildren();for(let t=0;t<16;t++)option(select,t,(t+1)+" · "+editor.getProject().track(t).name);select.value=current;}
    function open(id){if(!editor.commit())return false;$(id).showModal();return true;}
    for(const [close,dialog] of [["close-transfer","transfer-dialog"],["close-export-midi","export-midi-dialog"],["close-import-midi","import-midi-dialog"],["close-generator","generator-dialog"],["close-session","session-dialog"]])
      $(close).onclick=()=>{$(dialog).close();stopAudio();};
    $("transfer-pattern").onclick=()=>{const [t]=editor.getSelection();tracks($("transfer-track"),t);$("transfer-error").textContent="";open("transfer-dialog");};
    $("apply-transfer").onclick=()=>{
      try{const [t,s]=editor.getSelection(),dest=Number($("transfer-track").value),slot=number("transfer-slot")-1,move=$("transfer-mode").value==="move";
        const ok=editor.change(()=>editor.getProject().transferPattern(t,s,dest,slot,move));if(ok){editor.select(dest,slot);$("transfer-dialog").close();}}
      catch(error){$("transfer-error").textContent=error.message;}
    };
    $("midi-export").onclick=()=>{
      const p=editor.getProject(),[selectedTrack,selectedSlot]=editor.getSelection();$("snapshot-tracks").replaceChildren();
      for(let t=0;t<16;t++){const row=node("label",(t+1)+" · "+p.track(t).name),select=node("select");select.id="snapshot-"+t;option(select,"off","Omit track");
        for(const s of p.patterns[t].keys())option(select,s,"Pattern "+(s+1));
        select.value=p.patterns[t].has(t===selectedTrack?selectedSlot:0) ? (t===selectedTrack?selectedSlot:0) : p.patterns[t].size ? p.patterns[t].keys().next().value : "off";
        row.append(select);$("snapshot-tracks").append(row);}
      $("export-midi-error").textContent="";open("export-midi-dialog");
    };
    $("export-scope").onchange=()=>{$("snapshot-tracks").hidden=$("export-scope").value!=="snapshot";};
    $("apply-export-midi").onclick=()=>{
      try{const p=editor.getProject(),[t,s]=editor.getSelection(),scope=$("export-scope").value,name=safe(p.name)+"_"+stamp();
        if(scope==="bank"){
          const files=[];for(let track=0;track<16;track++)for(const slot of p.patterns[track].keys())files.push({name:"T"+String(track+1).padStart(2,"0")+"_P"+String(slot+1).padStart(2,"0")+".mid",bytes:M.writeSMF([M.patternEvents(p,track,slot)],p.bpm)});
          if(!files.length)throw new Error("There are no patterns to export.");download(M.zip(files),name+"_bank.zip","application/zip");
        } else {
          const parts=scope==="pattern" ? [M.patternEvents(p,t,s)] : Array.from({length:16},(_,t)=>$("snapshot-"+t).value==="off" ? null : M.patternEvents(p,t,Number($("snapshot-"+t).value))).filter(Boolean);
          download(M.writeSMF(parts,p.bpm),name+(scope==="pattern" ? "_T"+(t+1)+"_P"+(s+1) : "_snapshot")+".mid","audio/midi");
        }
      }catch(error){$("export-midi-error").textContent=error.message;}
    };
    let midiSource=null,importDraft=null;
    $("midi-import").onclick=()=>{if(editor.commit())$("midi-file-input").click();};
    $("midi-file-input").onchange=async()=>{
      const file=$("midi-file-input").files[0];$("midi-file-input").value="";if(!file)return;
      try{if(file.size>8*1024*1024)throw new Error("MIDI files are limited to 8 MiB.");
        midiSource=M.readSMF(new Uint8Array(await file.arrayBuffer()));const [t,s]=editor.getSelection();$("import-mappings").replaceChildren();
        midiSource.groups.forEach((g,i)=>{
          const row=node("div");row.className="mapping-row";const label=node("label"),enabled=node("input");enabled.type="checkbox";enabled.id="import-source-"+i;enabled.checked=i<16;
          const text=node("span",g.name+" · Ch "+(g.channel+1)+" · "+g.notes.length+" notes");text.title=text.textContent;label.append(enabled,text);
          const target=node("select");target.id="import-track-"+i;target.setAttribute("aria-label","Destination track for "+g.name+" channel "+(g.channel+1));tracks(target,Math.min(15,t+i));
          const slot=node("input");slot.type="number";slot.min=1;slot.max=64;slot.value=s+1;slot.id="import-slot-"+i;slot.setAttribute("aria-label","First pattern slot for "+g.name+" channel "+(g.channel+1));
          for(const input of [enabled,target,slot])input.onchange=previewImport;
          row.append(label,target,root.SquidNumbers ? root.SquidNumbers.wrap(slot) : slot);$("import-mappings").append(row);
        });
        $("midi-source-summary").textContent=file.name+" · "+midiSource.groups.length+" track/channel sources · "+midiSource.bpm.toFixed(1)+" BPM";
        const sourceEnd=midiSource.groups.reduce((end,g)=>g.notes.reduce((end,n)=>Math.max(end,n.time+n.duration),Math.max(end,g.end)),1);
        $("import-start").value=1;$("import-end").value=Math.ceil(sourceEnd);
        open("import-midi-dialog");previewImport();
      }catch(error){editor.toast(error.message,true);}
    };
    function previewImport(){
      importDraft=null;$("apply-import-midi").disabled=true;if($("import-bank-preview"))$("import-bank-preview").replaceChildren();
      try{if(!midiSource)return;const groups=midiSource.groups.map((g,i)=>$("import-source-"+i).checked ? {...g,targetTrack:Number($("import-track-"+i).value),targetSlot:number("import-slot-"+i)-1,cc:$("import-cc").checked ? g.cc : []} : null).filter(Boolean);
        importDraft=M.prepareImport(editor.getProject(),groups,{start:number("import-start")-1,end:number("import-end"),split:$("import-split").checked,overwrite:$("import-overwrite").checked,quantize:$("import-quantize").value,bpm:$("import-tempo").checked ? midiSource.bpm : undefined,channel:$("import-channel").checked});
        const r=importDraft.report;$("import-preview").textContent=r.notes+" notes · "+r.cc+" CC events · "+r.patterns+" patterns\nDestinations: "+r.targets.join(", ")+"\n"+r.quantized+" onsets quantized · "+r.clipped+" notes cropped · "+r.gateClipped+" durations clamped to 0.125–64 steps\n"+midiSource.warnings.join("\n")+(!$("import-cc").checked ? "\nCCs excluded. Enable Include CCs to import them." : "");
        const host=$("import-bank-preview");if(host){host.replaceChildren();const result=F.Project.parse(importDraft.bytes),original=editor.getProject();for(let t=0;t<16;t++){const slots=[];for(const [s,bytes] of result.patterns[t]){const old=original.patterns[t].get(s);if(!old||bytes.some((v,i)=>v!==old[i]))slots.push(s);}if(!slots.length)continue;const row=node("div");row.className="import-bank-row";row.append(node("strong","T"+(t+1)+" · "+result.track(t).name));for(const s of slots){const cell=node("span","P"+String(s+1).padStart(2,"0")+(original.patterns[t].has(s)?" · replace":" · new"));cell.className="destination-slot"+(original.patterns[t].has(s)?" replaced":"");row.append(cell);}host.append(row);}}
        $("apply-import-midi").disabled=false;
      }catch(error){$("import-preview").textContent=error.message;}
    }
    for(const id of ["import-start","import-end","import-split","import-overwrite","import-quantize","import-tempo","import-channel","import-cc"])$(id).onchange=previewImport;
    $("apply-import-midi").onclick=()=>{previewImport();if(importDraft && editor.applyBytes(importDraft.bytes)){ $("import-midi-dialog").close();editor.toast("Imported "+importDraft.report.notes+" notes; undo restores the project.");}};
    const generator=root.SquidGeneratorUI.setup(editor);
    const stopAudio=generator.stop;
    // Browser-local recovery: bytes, view and name, one opt-in session record.
    let database=null,autosave=false,paused=true,saveTimer=0,recovery=null,saveQueue=Promise.resolve();
    function requestDB(){return new Promise((resolve,reject)=>{if(!root.indexedDB){reject(new Error("Local recovery storage is unavailable."));return;}
      const request=root.indexedDB.open("squid-project-editor",1);request.onupgradeneeded=()=>request.result.createObjectStore("session");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error("Another editor tab is blocking local recovery storage."));});}
    function storage(mode,action){return new Promise((resolve,reject)=>{const transaction=database.transaction("session",mode),store=transaction.objectStore("session");let result;
      const request=action(store);request.onsuccess=()=>{result=request.result;};transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error("Recovery write aborted."));});}
    function persist(){
      if(!autosave||paused||!database)return;
      const record={bytes:editor.getProject().serialize(),selection:editor.getSelection(),name:editor.getProject().name,date:new Date().toISOString()};
      saveQueue=saveQueue.then(()=>storage("readwrite",store=>store.put(record,"current"))).then(()=>{$("autosave-status").textContent="Recovery copy updated at "+new Date(record.date).toLocaleTimeString();recoveryStatus();}).catch(error=>{$("autosave-status").textContent="Autosave failed: "+error.message;$("session-settings").textContent="Recovery · Error";editor.toast("Local autosave failed: "+error.message,true);});
    }
    requestDB().then(async db=>{database=db;recovery=await storage("readonly",store=>store.get("current"));
      if(recovery){F.Project.parse(recovery.bytes);$("restore-summary").textContent=recovery.name+" · "+new Date(recovery.date).toLocaleString();$("restore-dialog").showModal();}
      else {paused=false;if(root.SquidWorkbench)root.SquidWorkbench.welcome();}
    }).catch(error=>{paused=false;$("autosave-status").textContent=error.message;$("autosave-enabled").disabled=true;$("session-settings").textContent="Recovery · Unavailable";$("session-settings").title=error.message;if(root.SquidWorkbench)root.SquidWorkbench.welcome();});
    $("restore-session").onclick=()=>{if(recovery && editor.loadSession(recovery.bytes,"Local recovery: "+recovery.name,recovery.selection)){autosave=true;$("autosave-enabled").checked=true;paused=false;$("restore-dialog").close();persist();}};
    $("later-session").onclick=()=>{$("restore-dialog").close();$("autosave-status").textContent="Recovery copy retained; autosave remains off.";paused=false;};
    async function clearStorage(){clearTimeout(saveTimer);autosave=false;$("autosave-enabled").checked=false;await saveQueue;if(database)await storage("readwrite",store=>store.delete("current"));recovery=null;paused=false;$("autosave-status").textContent="Local recovery copy deleted.";recoveryStatus();}
    $("discard-session").onclick=async()=>{try{await clearStorage();$("restore-dialog").close();}catch(error){editor.toast(error.message,true);}};
    $("clear-autosave").onclick=async()=>{try{await clearStorage();}catch(error){editor.toast(error.message,true);}};
    $("autosave-enabled").onchange=()=>{autosave=$("autosave-enabled").checked;recoveryStatus();if(autosave)persist();else{$("autosave-status").textContent="Autosave off. Existing recovery copy is retained.";clearTimeout(saveTimer);}};
    $("session-settings").onclick=()=>open("session-dialog");
    function recoveryStatus(){ $("session-settings").textContent="Recovery · "+(autosave?"On":"Off");$("session-settings").title=$("autosave-status").textContent; }
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){editor.commit();persist();}});
    // Listen only after explicit connection and arming; no SysEx or MIDI output.
    let access=null,input=null,chord=[],held=new Set(),location=null;
    for(let channel=1;channel<=16;channel++)option($("midi-input-channel"),channel-1,channel);
    function resetChord(){chord=[];held.clear();location=null;}
    function midiStatus(){if($("midi-settings"))$("midi-settings").textContent="MIDI input · "+(input?$("midi-armed").checked?"Armed":"Connected":"Off");}
    function attachInput(){if(input)input.onmidimessage=null;input=access ? access.inputs.get($("midi-device").value) : null;resetChord();
      if(input)input.onmidimessage=message=>{
        if(document.visibilityState==="hidden"){resetChord();return;}
        const [status,pitch,velocity]=message.data,type=status>>4,channel=status&15;
        if(!$("midi-armed").checked || ($("midi-input-channel").value!=="all" && channel!==Number($("midi-input-channel").value)))return;
        const key=channel+":"+pitch;
        if(type===9 && velocity){if(!held.size){location=editor.getSelection();chord=[];}held.add(key);if(!chord.some(n=>n.pitch===pitch))chord.push({pitch,velocity});$("midi-input-status").textContent="Chord: "+chord.map(n=>F.noteName(n.pitch)).join(" ");}
        else if(type===8 || (type===9 && !velocity)){held.delete(key);if(!held.size && chord.length){editor.enterChord(chord,location,$("midi-advance").checked);resetChord();$("midi-input-status").textContent="Chord entered. Listening to "+input.name;}}
      };
      $("midi-input-status").textContent=input ? "Listening to "+input.name+"; arm entry to add notes." : "No MIDI input selected.";midiStatus();
    }
    function refreshInputs(){const selected=$("midi-device").value;$("midi-device").replaceChildren();for(const port of access.inputs.values())if(port.state!=="disconnected")option($("midi-device"),port.id,port.name||port.id);if(access.inputs.has(selected))$("midi-device").value=selected;attachInput();}
    $("connect-midi").onclick=async()=>{try{if(!root.navigator || !root.navigator.requestMIDIAccess)throw new Error("Web MIDI input is unavailable in this browser. Use piano typing or MIDI-file import.");access=access||await root.navigator.requestMIDIAccess({sysex:false});access.onstatechange=refreshInputs;refreshInputs();}catch(error){$("midi-input-status").textContent=error.message;if($("midi-settings")){$("midi-settings").textContent="MIDI input · Unavailable";$("midi-settings").title=error.message;}}};
    $("midi-device").onchange=attachInput;$("midi-input-channel").onchange=resetChord;$("midi-armed").onchange=()=>{resetChord();midiStatus();};
    root.addEventListener("blur",resetChord);
    const renderDrums=root.SquidDrums ? root.SquidDrums.setup(editor) : ()=>{};
    const renderControls=root.SquidControls ? root.SquidControls.setup(editor) : ()=>{};
    const renderValues=root.SquidValueChart ? root.SquidValueChart.setup(editor) : ()=>{};
    const renderHardware=root.SquidHardware ? root.SquidHardware.setup(editor) : ()=>{};
    const renderWorkbench=root.SquidWorkbench ? root.SquidWorkbench.setup(editor) : ()=>{};
    if(root.SquidTransforms)root.SquidTransforms.setup(editor);
    return function(){renderDrums();renderControls();renderValues();renderHardware();renderWorkbench();clearTimeout(saveTimer);if(autosave && !paused)saveTimer=setTimeout(persist,250);};
  }};
})(window);
