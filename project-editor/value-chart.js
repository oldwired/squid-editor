(function(root,factory){
  const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.SquidValueChart=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  function slots(data,target){return target==="all" ? data.notes.flatMap((n,i)=>n.enabled ? [i] : []) : data.notes[Number(target)]&&data.notes[Number(target)].enabled ? [Number(target)] : [];}
  function read(project,t,s,st,lane,target){
    const data=project.step(t,s,st);
    if(/^cc[0-4]$/.test(lane)){const i=Number(lane[2]);return {editable:true,enabled:!!(data.ccMask&(1<<i)),value:data.cc[i],min:data.cc[i],max:data.cc[i],count:1};}
    if(!["velocity","gate"].includes(lane)||!(target==="all"||/^[0-7]$/.test(String(target))))throw new Error("Choose a value lane and note target.");
    const values=slots(data,target).map(i=>data.notes[i][lane]);
    return {editable:!!values.length,enabled:!!values.length,value:values.length ? Math.round(values.reduce((a,b)=>a+b,0)/values.length) : 0,
      min:values.length ? Math.min(...values) : 0,max:values.length ? Math.max(...values) : 0,count:values.length};
  }
  function write(project,t,s,st,lane,target,value){
    const max=lane==="gate" ? 511 : 127;
    if(!Number.isInteger(value)||value<0||value>max)throw new Error((lane==="gate" ? "Gate" : "Value")+" must be "+(lane==="gate" ? "0.125–64 steps, in eighths." : "0–127 (whole numbers)."));
    const data=project.step(t,s,st);read(project,t,s,st,lane,target);
    if(/^cc[0-4]$/.test(lane))project.setCC(t,s,st,Number(lane[2]),value,true);
    else for(const n of slots(data,target))project.setNote(t,s,st,n,{[lane]:value});
  }
  function format(lane,value){return lane==="gate" ? ((value+1)/8).toFixed(3) : String(value);}
  function fromHeight(lane,fraction,scale){
    fraction=Math.max(0,Math.min(1,fraction));
    return lane==="gate" ? Math.max(0,Math.min(511,Math.round(fraction*scale*8)-1)) : Math.round(fraction*127);
  }
  function setup(editor){
    const $=id=>document.getElementById(id),plot=$("value-plot"),node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
    let gesture=null,bars=[],scale=2,lastNote=null,lastNoteTrack=null;
    const lane=()=>$("value-lane").value,target=()=>$("value-target").value;
    function height(value){return Math.min(100,lane()==="gate" ? (value+1)/8/scale*100 : value/127*100);}
    function describe(st,info){
      const value=!info.enabled ? "No "+(lane().startsWith("cc") ? "CC event" : "active note") : info.min!==info.max ? format(lane(),info.min)+"–"+format(lane(),info.max)+"; mean "+format(lane(),info.value) : format(lane(),info.value);
      return "Step "+(st+1)+", "+(lane()==="gate" ? "gate in steps" : lane().startsWith("cc") ? "CC value" : "velocity")+", "+value;
    }
    function paint(bar,value){
      const info=value===undefined ? bar.info : {...bar.info,enabled:true,value,min:value,max:value};
      bar.fill.style.height=(info.enabled ? height(info.value) : 0)+"%";
      bar.range.hidden=!info.enabled||info.min===info.max;
      bar.range.style.bottom=height(info.min)+"%";bar.range.style.height=Math.max(1,height(info.max)-height(info.min))+"%";
      bar.label.textContent=info.enabled ? format(lane(),info.value) : "·";
      bar.el.setAttribute("aria-valuenow",info.enabled ? (lane()==="gate" ? (info.value+1)/8 : info.value) : (lane()==="gate" ? .125 : 0));
      bar.el.setAttribute("aria-valuetext",describe(bar.st,info));bar.el.title=describe(bar.st,info);
      bar.el.className="value-bar"+(info.enabled ? "" : " vacant")+(bar.info.editable ? "" : " readonly")+(bar.selected ? " selected" : "")+(bar.outside ? " outside" : "")+(bar.skipped ? " skipped" : "")+(value!==undefined ? " drawing" : "");
    }
    function cancel(){
      if(!gesture)return;gesture=null;
      $("value-chart-status").textContent="Drawing cancelled.";bars.forEach(b=>paint(b));
      const [t,s,st]=editor.getSelection(),p=editor.getProject();if(p.patterns[t].has(s)){
        const info=read(p,t,s,st,lane(),target());$("value-number").value=info.enabled ? lane()==="gate" ? (info.value+1)/8 : info.value : "";
      }
    }
    function finish(){
      if(!gesture)return;const g=gesture;gesture=null;
      const p=editor.getProject();
      if(p!==g.project||!p.patterns[g.t].has(g.s)||p.pattern(g.t,g.s).some((n,i)=>n!==g.before[i])){
        editor.toast("The pattern changed while drawing. Please draw again.",true);render();return;
      }
      const changed=editor.change(()=>{for(const [st,value] of g.values)write(p,g.t,g.s,st,g.lane,g.target,value);});
      if(changed){editor.select(g.t,g.s,g.last);const el=$("value-bar-"+g.last);if(el)el.focus();}
      $("value-chart-status").textContent=g.values.size+(g.values.size===1 ? " step" : " steps")+" drawn · one undo restores the values.";
    }
    function draw(bar,event){
      if(!bar.info.editable)return;const rect=bar.track.getBoundingClientRect();
      const value=fromHeight(gesture.lane,1-(event.clientY-rect.top)/rect.height,gesture.scale);
      const previous=gesture.sample;
      if(previous&&previous.top===rect.top&&previous.st!==bar.st){
        const low=Math.min(previous.st,bar.st),high=Math.max(previous.st,bar.st);
        for(const item of bars)if(item.st>=low&&item.st<=high&&item.info.editable){
          const v=Math.round(previous.value+(value-previous.value)*(item.st-previous.st)/(bar.st-previous.st));
          gesture.values.set(item.st,v);paint(item,v);
        }
      }else{gesture.values.set(bar.st,value);paint(bar,value);}
      gesture.sample={st:bar.st,value,top:rect.top};gesture.last=bar.st;
      $("value-number").value=gesture.lane==="gate" ? (value+1)/8 : value;
      $("value-chart-status").textContent="Step "+(bar.st+1)+": "+format(gesture.lane,value)+(gesture.lane==="gate" ? " steps" : "")+" · release to apply, Escape to cancel.";
    }
    plot.onpointerdown=event=>{
      if(event.button!==0)return;let el=event.target;
      while(el&&el!==plot&&el.dataset.valueStep===undefined)el=el.parentElement;
      if(!el||el===plot)return;const st=Number(el.dataset.valueStep),bar=bars.find(b=>b.st===st);
      if(!bar||!editor.commit())return;event.preventDefault();
      const [t,s]=editor.getSelection();editor.select(t,s,st);
      if(!bar.info.editable){$("value-bar-"+st).focus();return;}
      const p=editor.getProject();gesture={project:p,t,s,lane:lane(),target:target(),scale,before:p.pattern(t,s).slice(),values:new Map(),last:st,pointer:event.pointerId};
      plot.setPointerCapture(event.pointerId);$("value-bar-"+st).focus();draw(bars.find(b=>b.st===st),event);
    };
    plot.onpointermove=event=>{
      if(!gesture||event.pointerId!==gesture.pointer)return;
      const bar=bars.find(b=>{const r=b.track.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top-24&&event.clientY<=r.bottom+20;});
      if(bar)draw(bar,event);
    };
    plot.onpointerup=event=>{if(gesture&&event.pointerId===gesture.pointer){finish();if(plot.hasPointerCapture(event.pointerId))plot.releasePointerCapture(event.pointerId);}};
    plot.onpointercancel=plot.onlostpointercapture=cancel;
    plot.onkeydown=event=>{if(!gesture)return;if(event.key==="Escape"||((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="z")){event.preventDefault();cancel();}else if(event.metaKey||event.ctrlKey)finish();};
    window.addEventListener("blur",cancel);
    $("show-value-chart").onchange=()=>{cancel();render();};
    for(const id of ["value-lane","value-target","value-scale"])$(id).onchange=()=>{cancel();$("value-chart-status").textContent="";render();};
    $("value-number").onchange=()=>{const value=$("value-number").valueAsNumber,[t,s,st]=editor.getSelection();
      editor.change(()=>write(editor.getProject(),t,s,st,lane(),target(),lane()==="gate" ? value*8-1 : value));};
    function render(){
      const [t,s,selected]=editor.getSelection(),p=editor.getProject();
      const note=editor.getNoteSelection ? editor.getNoteSelection() : null;
      if(note!==lastNote || (note!==null&&t!==lastNoteTrack)){cancel();if(note!==null)$("value-target").value=String(note);lastNote=note;lastNoteTrack=t;}
      if(gesture&&(gesture.project!==p||gesture.t!==t||gesture.s!==s))cancel();
      if(!gesture)$("value-chart-status").textContent="";
      $("value-chart").hidden=!$("show-value-chart").checked;
      if($("value-chart").hidden){plot.replaceChildren();bars=[];return;}
      const cc=lane().startsWith("cc"),gate=lane()==="gate",present=p.patterns[t].has(s),input=$("value-number");
      $("value-chart").className="value-chart"+(cc ? " cc-values" : "");
      $("value-target-control").hidden=cc;$("value-scale-control").hidden=!gate;
      input.min=gate ? .125 : 0;input.max=gate ? 64 : 127;input.step=gate ? .125 : 1;input.disabled=!present;
      $("value-chart-context").textContent=p.track(t).name+" · Pattern "+String(s+1).padStart(2,"0")+(cc&&p.track(t).ccNumbers ? " · CC "+p.track(t).ccNumbers[Number(lane()[2])] : note!==null ? target()==="all" ? " · All active notes" : " · Note "+(Number(target())+1) : "");
      $("value-chart-hint").textContent="Drag to draw · ←/→ steps · ↑/↓ values (Shift: larger change) · Enter: notes · Escape: steps. "+(cc ? "Editing an empty bar enables its CC event." : "Empty note steps stay empty. "+(target()==="all" ? "Bars show the mean; thin ranges show differing chord values. Edits set every active note to the drawn value." : "Only the selected note slot changes."));
      plot.replaceChildren();bars=[];
      if(!present){input.value="";$("value-chart-status").textContent="This pattern slot is empty.";return;}
      const drum=!$("drum-overlay").hidden,length=(p.pattern(t,s)[4]&15)*16,size=Number($("drum-overlay").dataset.pageSize||16),start=drum ? Number($("drum-page").value)*size : 0,end=drum ? start+size : $("show-stored-steps").checked || $("step-page-select").value==="all" ? 64 : length,fx=p.effects(t,s);
      const infos=Array.from({length:end-start},(_,i)=>read(p,t,s,start+i,lane(),target()));
      if(!gesture){scale=$("value-scale").value==="auto" ? Math.min(64,Math.max(2,2**Math.ceil(Math.log2(Math.max(.125,...infos.filter(n=>n.enabled).map(n=>(n.max+1)/8)))))) : Number($("value-scale").value);}
      const current=read(p,t,s,selected,lane(),target());input.disabled=!current.editable;input.value=current.enabled ? gate ? (current.value+1)/8 : current.value : "";
      for(let page=0;page<Math.ceil((end-start)/(drum?size:16));page++){
        const group=node("div"),heading=node("div","Steps "+(start+page*(drum?size:16)+1)+"–"+(start+(page+1)*(drum?size:16))+(gate ? " · scale "+scale+(scale===1 ? " step" : " steps")+" · dashed line: 1.000 (next step)" : "")),row=node("div");group.className="value-page";heading.className="step-page-label";row.className="step-page value-page-bars";group.append(heading,row);
        let beat;
        for(let local=0;local<(drum?size:16);local++){
          if(local%4===0){beat=node("div");beat.className="step-beat";row.append(beat);}
          const st=start+page*(drum?size:16)+local,data=p.step(t,s,st),info=infos[st-start],el=node("div"),label=node("span"),track=node("div"),fill=node("span"),range=node("span");
          el.id="value-bar-"+st;el.dataset.valueStep=st;el.setAttribute("role","slider");el.setAttribute("aria-label","Step "+(st+1)+" "+(gate ? "gate" : cc ? "CC lane "+(Number(lane()[2])+1) : "velocity"));
          el.setAttribute("aria-valuemin",gate ? .125 : 0);el.setAttribute("aria-valuemax",gate ? 64 : 127);el.setAttribute("aria-orientation","vertical");el.setAttribute("aria-disabled",!info.editable);el.tabIndex=st===selected ? 0 : -1;
          label.className="value-bar-number";track.className="value-bar-track";fill.className="value-bar-fill";range.className="value-bar-range";track.id="value-track-"+st;track.append(fill,range);el.append(label,track,node("span",String(st+1).padStart(2,"0")));
          if(gate){const marker=node("span");marker.className="value-gate-marker";marker.style.bottom=(100/scale)+"%";marker.setAttribute("aria-hidden","true");track.append(marker);}
          const bar={st,info,el,label,track,fill,range,selected:st===selected,outside:st>=length||(fx.fixed&&st>=fx.fixedSteps),skipped:!data.enabled};bars.push(bar);paint(bar,gesture&&gesture.values.has(st) ? gesture.values.get(st) : undefined);
          el.onkeydown=event=>{
            if(event.altKey||event.metaKey||event.ctrlKey)return;
            if(gesture){if(event.key==="Escape"){event.preventDefault();cancel();}return;}
            if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){
              event.preventDefault();const next=event.key==="Home" ? start : event.key==="End" ? end-1 : Math.max(start,Math.min(end-1,st+(event.key==="ArrowRight" ? 1 : -1)));
              if(editor.commit()){editor.select(t,s,next);$("value-bar-"+next).focus();}
            }else if(["ArrowUp","ArrowDown"].includes(event.key)){
              event.preventDefault();if(!info.editable)return;const amount=event.shiftKey ? gate ? 8 : 10 : 1,value=Math.max(0,Math.min(gate ? 511 : 127,info.value+(event.key==="ArrowUp" ? amount : -amount)));
              if(editor.change(()=>write(p,t,s,st,lane(),target(),value))){editor.select(t,s,st);$("value-bar-"+st).focus();}
            }else if(event.key==="Enter"){event.preventDefault();editor.openNotes(t,s,st);}
            else if(event.key==="Escape"){event.preventDefault();const button=$(editor.stepButtonId ? editor.stepButtonId(t,st) : drum ? "drum-step-"+t+"-"+st : "step-"+st);if(button)button.focus();}
          };beat.append(el);
        }
        plot.append(group);
      }
    }
    render();return render;
  }
  return {read,write,format,fromHeight,setup};
});
