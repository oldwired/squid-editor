(function(root){
  "use strict";
  root.SquidTransforms={setup:function(editor){
    const $=id=>document.getElementById(id),E=root.SquidEditFunctions;let location=null,draft=null,editingAnchors=false;
    const ids=["operation","parameter","order","anchors","start","end","min","max","chance","seed","scale","fill","reset-offset"];
    function preview(){
      const interpolate=$("transform-operation").value==="interpolate";
      $("interpolation-controls").hidden=!interpolate;$("randomizer-controls").hidden=interpolate;$("transform-reroll").hidden=interpolate;
      const active=$("transform-parameter").value==="active";
      $("transform-min").disabled=$("transform-max").disabled=active;$("transform-chance").disabled=!active;
      $("transform-scale").disabled=$("transform-parameter").value!=="pitch";
      $("transform-reset-offset").disabled=active||$("transform-parameter").value.startsWith("cc");
      draft=null;$("apply-transform").disabled=true;if($("transform-visual"))$("transform-visual").replaceChildren();
      try{
        if(!location)return;const [t,s]=location;
        draft=E.prepare(editor.getProject(),t,s,{operation:$("transform-operation").value,parameter:$("transform-parameter").value,order:$("transform-order").value,
          anchors:$("transform-anchors").value,start:$("transform-start").valueAsNumber,end:$("transform-end").valueAsNumber,
          min:$("transform-min").valueAsNumber,max:$("transform-max").valueAsNumber,chance:$("transform-chance").valueAsNumber,
          seed:$("transform-seed").value,scale:$("transform-scale").checked,fill:$("transform-fill").checked,resetOffset:$("transform-reset-offset").checked});
        const r=draft.report;$("transform-preview").textContent=r.changed+" steps will change · "+r.affected+" note/CC/step values across "+r.steps+" steps.\n"+(r.order==="direction" ? "Follows one pass of the stored direction, including Reverse. Switch Back does not add another pass." : "Follows numerical grid order.")+"\nApply is one undoable edit; pattern settings and other parameters are retained.";
        visual();$("apply-transform").disabled=!r.changed;
      }catch(error){$("transform-preview").textContent=error.message;}
    }
    function visual(){
      if(!$("transform-visual")||!draft)return;const p=editor.getProject(),next=root.SquidProject.Project.parse(draft.bytes),[t,s]=location,key=$("transform-parameter").value,length=(p.pattern(t,s)[4]&15)*16,host=$("transform-visual");host.replaceChildren();
      const read=(project,st)=>{const d=project.step(t,s,st),notes=d.notes.filter(n=>n.enabled);if(key==="active")return d.enabled?1:0;if(key.startsWith("cc"))return d.cc[Number(key[2])];if(!notes.length)return 0;return key==="pitch"?d.notes[0].pitch:notes.reduce((v,n)=>v+(key==="gate"?(n.gate+1)/8:n.velocity),0)/notes.length;};
      const values=Array.from({length},(_,st)=>[read(p,st),read(next,st)]),max=key==="gate"?Math.max(1,...values.flat()):key==="active"?1:127;
      for(let st=0;st<length;st++){const col=document.createElement("div");col.className="transform-column";col.dataset.step=st%4===0?st+1:"";col.title="Step "+(st+1)+": before "+values[st][0].toFixed(3)+", after "+values[st][1].toFixed(3);col.setAttribute("aria-label",col.title);for(let n=0;n<2;n++){const bar=document.createElement("span");bar.className=n?"transform-after":"transform-before";bar.style.height=(values[st][n]/max*100)+"%";col.append(bar);}host.append(col);}
      if($("transform-operation").value==="interpolate"){
        const pairs=$("transform-anchors").value.split(",").map(v=>v.trim().split(":").map(Number));
        pairs.forEach((pair,i)=>{const col=host.children[pair[0]-1];if(!col)return;const handle=document.createElement("button");handle.className="anchor-handle";handle.id="anchor-handle-"+i;handle.textContent="●";handle.setAttribute("role","slider");handle.setAttribute("aria-label","Anchor "+(i+1)+", step "+pair[0]);handle.setAttribute("aria-valuemin",key==="gate"?.125:0);handle.setAttribute("aria-valuemax",key==="gate"?64:127);handle.setAttribute("aria-valuenow",pair[1]);handle.title="Drag vertically or use ↑/↓ to change anchor value";handle.style.bottom=(pair[1]/max*100)+"%";
          let drag=null;const commit=value=>{pairs[i][1]=value;$("transform-anchors").value=pairs.map(v=>v.join(":")).join(", ");preview();const target=document.getElementById(handle.id);if(target)target.focus({preventScroll:true});};
          handle.onkeydown=e=>{if(["ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();commit(Math.max(key==="gate"?.125:0,Math.min(key==="gate"?64:127,pair[1]+(e.key==="ArrowUp"?1:-1)*(key==="gate"?.125:1)*(e.shiftKey?8:1))));}else if(e.key==="Escape"&&drag){e.preventDefault();drag=null;handle.style.bottom=(pair[1]/max*100)+"%";}};
          handle.onpointerdown=e=>{e.preventDefault();drag={id:e.pointerId,value:pair[1],rect:col.getBoundingClientRect()};handle.setPointerCapture(e.pointerId);};
          handle.onpointermove=e=>{if(!drag)return;const min=key==="gate"?.125:0,limit=key==="gate"?64:127,unit=key==="gate"?.125:1;drag.value=Math.max(min,Math.min(limit,Math.round((drag.rect.bottom-e.clientY)/drag.rect.height*max/unit)*unit));handle.style.bottom=(drag.value/max*100)+"%";handle.title=String(drag.value);};
          handle.onpointerup=()=>{if(drag){const value=drag.value;drag=null;commit(value);}};handle.onpointercancel=handle.onlostpointercapture=()=>{drag=null;handle.style.bottom=(pair[1]/max*100)+"%";};col.append(handle);
        });
      }
      if(!editingAnchors)anchorControls();
    }
    function anchorControls(){
      const host=$("transform-anchor-controls");if(!host||!location)return;host.replaceChildren();const pairs=$("transform-anchors").value.split(",").map(v=>v.trim().split(":").map(Number));if(pairs.some(v=>v.length!==2||v.some(n=>!Number.isFinite(n))))return;
      const [t,s]=location,length=(editor.getProject().pattern(t,s)[4]&15)*16,key=$("transform-parameter").value,gate=key==="gate";
      pairs.forEach((pair,i)=>{const row=document.createElement("div");row.className="anchor-row";const stepLabel=document.createElement("label"),valueLabel=document.createElement("label");stepLabel.textContent="Anchor "+(i+1)+" · step";valueLabel.textContent=gate?"Gate (steps)":"Value";
        const step=document.createElement("input"),value=document.createElement("input"),slider=document.createElement("input"),remove=document.createElement("button");step.type=value.type="number";step.min=1;step.max=length;step.value=pair[0];step.id="anchor-step-"+i;step.setAttribute("aria-label","Anchor "+(i+1)+" step");value.min=gate?.125:0;value.max=gate?64:127;value.step=gate?.125:1;value.value=pair[1];value.id="anchor-value-"+i;value.setAttribute("aria-label","Anchor "+(i+1)+" value");slider.type="range";slider.min=value.min;slider.max=value.max;slider.step=value.step;slider.value=pair[1];slider.setAttribute("aria-label","Anchor "+(i+1)+" value");
        const update=()=>{pairs[i]=[step.valueAsNumber,value.valueAsNumber];$("transform-anchors").value=pairs.map(v=>v.join(":")).join(", ");editingAnchors=true;preview();editingAnchors=false;};
        step.onchange=update;value.onchange=()=>{slider.value=value.value;update();};slider.oninput=()=>{value.value=slider.value;update();};remove.textContent="×";remove.disabled=pairs.length<=2;remove.setAttribute("aria-label","Remove anchor "+(i+1));remove.onclick=()=>{pairs.splice(i,1);$("transform-anchors").value=pairs.map(v=>v.join(":")).join(", ");preview();};stepLabel.append(root.SquidNumbers.wrap(step));valueLabel.append(root.SquidNumbers.wrap(value));row.append(stepLabel,valueLabel,slider,remove);host.append(row);
      });$("transform-add-anchor").disabled=pairs.length>=5;
    }
    if($("transform-add-anchor"))$("transform-add-anchor").onclick=()=>{const text=$("transform-anchors").value,pairs=text.split(",");if(pairs.length>=5)return;const [t,s]=location,length=(editor.getProject().pattern(t,s)[4]&15)*16,used=new Set(pairs.map(p=>Number(p.split(":")[0])));let step=Math.round(length/2);while(used.has(step)&&step<length)step++;if(used.has(step))return;const value=Number(pairs[0].split(":")[1]);$("transform-anchors").value=text+", "+step+":"+value;preview();};
    function defaults(){
      if(!location)return;const [t,s]=location,length=(editor.getProject().pattern(t,s)[4]&15)*16,key=$("transform-parameter").value;
      const values=key==="pitch" ? [48,72] : key==="gate" ? [.25,2] : key==="velocity" ? [64,127] : [0,127];
      $("transform-min").value=values[0];$("transform-max").value=values[1];$("transform-anchors").value="1:"+values[0]+", "+length+":"+values[1];
      $("transform-start").value=1;$("transform-end").value=length;preview();
    }
    $("transform-pattern").onclick=()=>{if(!editor.commit())return;location=editor.getSelection();defaults();$("transform-dialog").showModal();};
    $("close-transform").onclick=()=>{$("transform-dialog").close();$("transform-pattern").focus();};
    ids.forEach(id=>{$("transform-"+id).oninput=preview;$("transform-"+id).onchange=preview;});
    $("transform-parameter").onchange=()=>{
      if($("transform-parameter").value==="active")$("transform-operation").value="randomize";
      defaults();
    };
    $("transform-reroll").onclick=()=>{$("transform-seed").value=String(Date.now());preview();};
    $("apply-transform").onclick=()=>{preview();if(draft&&editor.applyBytes(draft.bytes)){$("transform-dialog").close();$("transform-pattern").focus();editor.toast("Applied "+draft.report.changed+" changed steps; undo restores the pattern.");}};
  }};
})(window);
