(function(root){
  "use strict";
  root.SquidControls={setup:function(editor){
    const F=root.SquidProject,$=id=>document.getElementById(id);
    const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
    const numberControl=input=>root.SquidNumbers ? root.SquidNumbers.wrap(input) : input;
    const option=(select,value,label)=>{const el=node("option",label);el.value=value;select.append(el);};
    function selectValue(el,value){
      el.querySelectorAll("option[data-unknown]").forEach(n=>n.remove());
      if(!Array.from(el.children).some(o=>String(o.value)===String(value))){option(el,value,"Stored "+value+" (preserved)");el.lastElementChild.dataset.unknown="true";}
      el.value=value;
    }
    F.SCALES.forEach((s,i)=>option($("fx-scale"),i,s.name));
    for(let k=0;k<12;k++)option($("fx-key"),k,F.noteName(k).replace(/-1$/,""));
    ["Triangle 1","Triangle 2","Sine","Cosine","Saw","Square"].forEach((name,i)=>option($("fx-modShape"),i,name));
    F.ARP_RATES.forEach((name,i)=>option($("fx-arpRate"),i,name));
    ["Up","Down","Up + Down","Random"].forEach((name,i)=>option($("fx-arpStyle"),i,name));
    const fxKeys=["fixed","fixedSteps","probability","rate","swing","scale","key","reverse","switchBack","modShape","modLength","modDepth","arp","arpRate","arpStyle","arpOctaves","arpGate"];
    fxKeys.forEach(key=>{$("fx-"+key).onchange=()=>{
      const el=$("fx-"+key),value=el.type==="checkbox" ? el.checked : el.type==="number" ? el.valueAsNumber : el.value;
      const [t,s]=editor.getSelection();editor.change(()=>editor.getProject().setPattern(t,s,key,value));
    };});
    for(const [key,codes] of [["speedControl",F.SPEED_CONTROL],["roll",F.ROLLS]]){
      codes.forEach(([value,name])=>option($("step-"+key),value,name));
      $("step-"+key).onchange=()=>{const value=$("step-"+key).value,[t,s,st]=editor.getSelection();editor.change(()=>editor.getProject().setStep(t,s,st,key,value));};
    }
    for(let i=0;i<6;i++){
      const label=node("label",i+"/6"),input=node("input");input.type="number";input.min=-64;input.max=63;input.id="step-groove-"+i;
      input.setAttribute("aria-label","Groove Bend at "+i+"/6");
      input.onchange=()=>{const value=input.valueAsNumber,[t,s,st]=editor.getSelection();editor.change(()=>editor.getProject().setStep(t,s,st,"groove"+i,value));};
      label.append(numberControl(input));$("groove-samples").append(label);
    }
    $("clear-automation").onclick=()=>{if(!editor.commit())return;const [t,s,st]=editor.getSelection();editor.change(()=>editor.getProject().clearAutomation(t,s,st));};
    function harmonizer(t){
      const info=editor.getProject().track(t);$("harmonizer-chords").replaceChildren();
      info.harmonizer.forEach((intervals,i)=>{
        const row=node("div"),heading=node("label","Chord "+(i+1)),select=node("select");row.className="harmonizer-row";
        select.id="chord-preset-"+i;select.setAttribute("aria-label","Harmonizer chord "+(i+1)+" preset");
        option(select,"custom","User chord / root only");F.HARMONIZER_PRESETS.forEach((p,n)=>option(select,n,p.name));
        const active=intervals.filter(Boolean),preset=F.HARMONIZER_PRESETS.findIndex(p=>p.intervals.join(",")===active.join(","));select.value=preset<0 ? "custom" : preset;
        select.disabled=!info.isV3;select.onchange=()=>{const value=select.value;if(value!=="custom")editor.change(()=>editor.getProject().setHarmonizer(t,i,F.HARMONIZER_PRESETS[Number(value)].intervals));};
        heading.append(select);row.append(heading);
        intervals.forEach((value,n)=>{
          const label=node("label","+ semitones "+(n+1)),input=node("input");input.type="number";input.min=0;input.max=15;input.value=value;input.disabled=!info.isV3;input.id="chord-"+i+"-"+n;
          input.setAttribute("aria-label","Chord "+(i+1)+" interval "+(n+1));input.onchange=()=>{
            const values=Array.from({length:4},(_,j)=>$("chord-"+i+"-"+j).valueAsNumber);editor.change(()=>editor.getProject().setHarmonizer(t,i,values));
          };label.append(numberControl(input));row.append(label);
        });$("harmonizer-chords").append(row);
      });
    }
    let sceneIndex=0,overviewTrack=0;
    function renderScenes(){
      const p=editor.getProject(),scene=p.patternSet(sceneIndex);$("scene-bank").replaceChildren();
      for(let n=0;n<16;n++){
        const stored=p.patternSet(n),button=node("button",String(n+1).padStart(2,"0"));button.id="scene-"+n;
        button.className="pattern-slot"+(stored.enabled ? " occupied" : "")+(n===sceneIndex ? " selected" : "");
        button.tabIndex=n===sceneIndex ? 0 : -1;button.setAttribute("aria-pressed",n===sceneIndex);button.setAttribute("aria-label","Pattern set "+(n+1)+(stored.enabled ? "" : ", empty"));
        button.onclick=()=>{sceneIndex=n;render();$("scene-"+n).focus();};
        button.onkeydown=e=>{if(e.altKey||e.metaKey||e.ctrlKey)return;const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-8,ArrowDown:8};
          let next;if(e.key in offsets)next=Math.max(0,Math.min(15,n+offsets[e.key]));else if(e.key==="Home")next=0;else if(e.key==="End")next=15;else return;
          e.preventDefault();sceneIndex=next;render();$("scene-"+next).focus();};
        $("scene-bank").append(button);
      }
      const overview=$("scene-overview");if(overview){overview.replaceChildren();const table=node("table"),head=node("tr");head.append(node("th","Track / set"));for(let n=0;n<16;n++){const th=node("th",String(n+1).padStart(2,"0"));th.setAttribute("scope","col");head.append(th);}table.append(head);for(let t=0;t<16;t++){const row=node("tr"),name=node("th","T"+(t+1)+" · "+p.track(t).name);name.setAttribute("scope","row");row.append(name);for(let n=0;n<16;n++){const e=p.patternSet(n).entries[t],td=node("td"),button=node("button",e.slot===null?"—":String(e.slot+1).padStart(2,"0")+(e.mute?" · M":""));td.className=n===sceneIndex?"current":"";button.id="scene-cell-"+t+"-"+n;button.tabIndex=t===overviewTrack&&n===sceneIndex?0:-1;button.className=e.slot===null?"":e.mute?"muted":"assigned";button.setAttribute("aria-label","Set "+(n+1)+", track "+(t+1)+", "+(e.slot===null?"no assignment":"pattern "+(e.slot+1)+(e.mute?", muted":"")));button.onclick=()=>{overviewTrack=t;sceneIndex=n;render();$("scene-cell-"+t+"-"+n).focus();};
          button.onkeydown=event=>{if(event.altKey||event.metaKey||event.ctrlKey)return;let track=t,set=n;switch(event.key){case "ArrowLeft":set=Math.max(0,n-1);break;case "ArrowRight":set=Math.min(15,n+1);break;case "ArrowUp":track=Math.max(0,t-1);break;case "ArrowDown":track=Math.min(15,t+1);break;case "Home":set=0;break;case "End":set=15;break;default:return;}event.preventDefault();overviewTrack=track;sceneIndex=set;render();$("scene-cell-"+track+"-"+set).focus();};td.append(button);row.append(td);}table.append(row);}overview.append(table);}
      $("scene-title").textContent="Set "+(sceneIndex+1)+(scene.enabled ? "" : " · empty");
      $("recall-scene").disabled=$("delete-scene").disabled=$("copy-scene").disabled=!scene.enabled;
      const drums=root.SquidDrums,groups=drums ? drums.groups(p) : [],members=new Set(groups.flatMap(g=>g.rows.map(r=>r.track)));
      $("scene-drum-capture-control").hidden=$("scene-drum-help").hidden=!groups.length;
      const expanded=new Set(groups.filter(g=>$("scene-members-"+g.id)&&$("scene-members-"+g.id).open).map(g=>g.id));
      $("scene-entries").replaceChildren();
      function member(entry,t,parent){
        const row=node("div"),label=node("label",String(t+1).padStart(2,"0")+" · "+p.track(t).name),select=node("select"),muteLabel=node("label","Mute"),mute=node("input");row.className="scene-entry";muteLabel.className="check-label";
        select.id="scene-pattern-"+t;select.setAttribute("aria-label","Pattern set track "+(t+1)+" pattern");option(select,"none","No assignment");
        for(let s=0;s<64;s++)option(select,s,"Pattern "+String(s+1).padStart(2,"0")+(p.patterns[t].has(s) ? "" : " · empty slot"));
        selectValue(select,entry.slot===null ? "none" : entry.slot);
        select.onchange=()=>{const value=select.value;editor.change(()=>p.setPatternSetTrack(sceneIndex,t,"slot",value==="none" ? null : value));};
        mute.type="checkbox";mute.id="scene-mute-"+t;mute.checked=entry.mute;mute.disabled=entry.slot===null;mute.setAttribute("aria-label","Pattern set track "+(t+1)+" mute");
        mute.onchange=()=>{const value=mute.checked;editor.change(()=>p.setPatternSetTrack(sceneIndex,t,"mute",value));};
        label.append(select);muteLabel.append(mute);row.append(label,muteLabel);parent.append(row);
      }
      for(const group of groups){
        const state=drums.sceneState(p,sceneIndex,group),panel=node("section"),heading=node("div"),title=node("strong","Drum group "+group.id+" · "+group.rows.length+" tracks"),label=node("label","Group pattern"),select=node("select"),muteLabel=node("label","Mute group"),mute=node("input");
        panel.className="scene-drum-group";heading.className="scene-drum-heading";select.id="scene-group-pattern-"+group.id;select.setAttribute("aria-label","Drum group "+group.id+" scene pattern");
        if(state.slot==="mixed"){option(select,"mixed","Mixed assignments (preserved)");select.lastElementChild.disabled=true;}
        option(select,"none","No assignment");
        for(let s=0;s<64;s++){const count=group.rows.filter(r=>p.patterns[r.track].has(s)).length;option(select,s,"Pattern "+String(s+1).padStart(2,"0")+" · "+count+"/"+group.rows.length+" tracks");}
        selectValue(select,state.slot===null ? "none" : state.slot);select.onchange=()=>{const value=select.value;editor.change(()=>drums.setScene(p,sceneIndex,group,"slot",value==="none" ? null : value));};
        mute.type="checkbox";mute.id="scene-group-mute-"+group.id;mute.checked=state.mute===true;mute.indeterminate=state.mute==="mixed";mute.disabled=!state.assigned;mute.setAttribute("aria-label","Drum group "+group.id+" scene mute");mute.title=state.mute==="mixed" ? "Mixed mute states; click to mute assigned members." : "Mute or unmute all assigned members.";
        mute.onchange=()=>{const value=mute.checked;editor.change(()=>drums.setScene(p,sceneIndex,group,"mute",value));};
        label.append(select);muteLabel.className="check-label";muteLabel.append(mute);heading.append(title,label,muteLabel);panel.append(heading);
        const details=node("details"),summary=node("summary","Individual tracks"+(state.slot==="mixed" ? " · mixed patterns" : "")+(state.mute==="mixed" ? " · mixed mutes" : "")),entries=node("div");details.id="scene-members-"+group.id;details.open=expanded.has(group.id);entries.className="scene-entries scene-member-entries";
        for(const r of group.rows)member(scene.entries[r.track],r.track,entries);
        details.append(summary,entries);panel.append(details);$("scene-entries").append(panel);
      }
      scene.entries.forEach((entry,t)=>{if(!members.has(t))member(entry,t,$("scene-entries"));});
      const previous=$("scene-copy-destination").value;$("scene-copy-destination").replaceChildren();
      for(let n=0;n<16;n++)if(n!==sceneIndex&&!p.patternSet(n).enabled)option($("scene-copy-destination"),n,"Set "+(n+1));
      if(Array.from($("scene-copy-destination").children).some(x=>String(x.value)===String(previous)))$("scene-copy-destination").value=previous;
      else $("scene-copy-destination").value=$("scene-copy-destination").children[0] ? $("scene-copy-destination").children[0].value : "";
      $("copy-scene").disabled=!scene.enabled || !$("scene-copy-destination").children.length;
      const empty=scene.entries.flatMap((e,t)=>e.slot!==null&&!p.patterns[t].has(e.slot) ? [t+1] : []);
      $("scene-status").textContent=empty.length ? "Empty pattern slots on tracks "+empty.join(", ")+". Assignments are retained; recall does not create patterns." : "";
    }
    $("pattern-sets").onclick=()=>{if(!editor.commit())return;overviewTrack=editor.getSelection()[0];$("pattern-sets-dialog").showModal();render();$("scene-"+sceneIndex).focus();};
    $("close-pattern-sets").onclick=()=>{$("pattern-sets-dialog").close();$("pattern-sets").focus();};
    $("capture-scene").onclick=()=>{if(!editor.commit())return;const p=editor.getProject(),selections=editor.getTrackSelections();
      if($("scene-drum-capture").checked&&root.SquidDrums){const [current]=editor.getSelection();for(const group of root.SquidDrums.groups(p)){
        const source=group.rows.find(r=>r.track===current)||group.rows[0],shared=selections[source.track];for(const r of group.rows)selections[r.track]=shared;
      }}
      editor.change(()=>p.setPatternSet(sceneIndex,selections.map((s,t)=>({slot:p.patterns[t].has(s) ? s : null,mute:!!p.track(t).mute}))));};
    $("delete-scene").onclick=()=>{if(editor.commit())editor.change(()=>editor.getProject().clearPatternSet(sceneIndex));};
    $("copy-scene").onclick=()=>{if(editor.commit()){const to=Number($("scene-copy-destination").value);if(editor.change(()=>editor.getProject().copyPatternSet(sceneIndex,to)))sceneIndex=to;}};
    $("recall-scene").onclick=()=>{if(editor.commit()&&editor.recallSet(sceneIndex)){
      const [t]=editor.getSelection(),drums=root.SquidDrums,group=drums&&drums.groups(editor.getProject()).find(g=>g.rows.some(r=>r.track===t));let mixed=false;
      if(group){const state=drums.sceneState(editor.getProject(),sceneIndex,group);mixed=state.slot==="mixed";
        if(state.assigned){$("editor-view").value=mixed ? "track" : String(group.id);$("editor-view").onchange();}}
      $("pattern-sets-dialog").close();editor.toast("Recalled pattern set "+(sceneIndex+1)+(mixed ? "; Track view shows the group's individual assignments." : "; undo restores the project and selections."));
    }};
    $("pattern-sets-dialog").onkeydown=event=>{if(!(event.metaKey||event.ctrlKey))return;const key=event.key.toLowerCase();
      if(key==="z"||key==="y"){event.preventDefault();$(key==="y"||event.shiftKey ? "redo" : "undo").click();}};
    function render(){
      const focused=document.activeElement&&document.activeElement.id,p=editor.getProject(),[t,s,st]=editor.getSelection(),present=p.patterns[t].has(s);
      harmonizer(t);$("transform-pattern").disabled=!present;
      const fx=present ? p.effects(t,s) : null;
      fxKeys.forEach(key=>{const el=$("fx-"+key);el.disabled=!present;
        if(fx){if(el.type==="checkbox")el.checked=fx[key];else if(el.tagName==="SELECT")selectValue(el,fx[key]);else el.value=fx[key];}
      });
      $("pattern-sets").textContent="Pattern sets… ("+Array.from({length:16},(_,n)=>p.patternSet(n).enabled).filter(Boolean).length+"/16)";
      if(present){const data=p.step(t,s,st);for(const key of ["speedControl","roll"])selectValue($("step-"+key),data[key]);
        data.groove.forEach((v,i)=>{$("step-groove-"+i).value=v-64;});
      }
      if($("pattern-sets-dialog").open)renderScenes();
      if(focused&&$(focused)&&!$(focused).disabled)$(focused).focus({preventScroll:true});
    }
    render();return render;
  }};
})(window);
