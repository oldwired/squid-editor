/* Pure editing plans: no transport, audio, device access or mutation of the source. */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory(require("./project-format.js"),require("./generators.js"));else root.SquidEditFunctions=factory(root.SquidProject,root.SquidGenerators);})(typeof globalThis!=="undefined"?globalThis:this,function(F,G){
  "use strict";
  function number(value,min,max,name,whole=true){
    const n=typeof value==="string"&&!value.trim() ? NaN : Number(value);
    if(!Number.isFinite(n)||n<min||n>max||(whole&&!Number.isInteger(n)))throw new Error(name+" must be "+min+"–"+max+(whole ? " (whole numbers)." : "."));return n;
  }
  function prepare(project,t,s,options){
    const p=F.Project.parse(project.serialize()),data=p.pattern(t,s),length=(data[4]&15)*16,parameter=options.parameter;
    if(!["pitch","gate","velocity","active","cc0","cc1","cc2","cc3","cc4"].includes(parameter))throw new Error("Choose a parameter.");
    if(!["interpolate","randomize"].includes(options.operation))throw new Error("Choose an operation.");
    if(!["direction","numeric"].includes(options.order))throw new Error("Choose a step order.");
    let order=Array.from({length:length},(_,i)=>i);
    if(options.order==="direction"){
      const code=F.u32(data,0xe28);if(!F.DIRECTIONS[code])throw new Error("This stored direction is unsupported; choose numerical order.");
      order=Array.from({length:length/16},(_,page)=>F.DIRECTIONS[code].map(n=>n+page*16)).flat();
      if(p.effects(t,s).reverse)order.reverse();
    }
    const gate=parameter==="gate",min=gate ? .125 : 0,max=gate ? 64 : 127;
    function value(v){const n=number(v,min,max,"Parameter value",!gate);if(gate&&!Number.isInteger(n*8))throw new Error("Gate values must use eighths of a step.");return n;}
    let targets=[],anchors=[],random=G.random(String(options.seed)),pitches=[];
    if(options.operation==="interpolate"){
      if(parameter==="active")throw new Error("Use randomize for step activation.");
      if(typeof options.anchors!=="string")throw new Error("Enter step:value anchors.");
      anchors=options.anchors.split(",").map(part=>{
        const pair=part.trim().split(":");if(pair.length!==2)throw new Error("Use step:value anchors separated by commas.");
        const step=number(pair[0],1,length,"Anchor step")-1;return {step,position:order.indexOf(step),value:value(pair[1])};
      }).sort((a,b)=>a.position-b.position);
      if(anchors.length<2||anchors.length>5||new Set(anchors.map(a=>a.step)).size!==anchors.length)throw new Error("Use two to five different anchor steps.");
      targets=order.slice(anchors[0].position,anchors[anchors.length-1].position+1);
    }else{
      const first=number(options.start,1,length,"First step")-1,last=number(options.end,1,length,"Last step")-1;
      if(first>last)throw new Error("Last step must follow first step.");targets=order.filter(n=>n>=first&&n<=last);
      if(parameter!=="active"){
        const low=value(options.min),high=value(options.max);if(low>high)throw new Error("Maximum must be at least the minimum.");
        if(parameter==="pitch"&&options.scale){
          const fx=p.effects(t,s),scale=F.SCALES[fx.scale];if(!scale||fx.key>11)throw new Error("Choose a supported pattern scale/key first.");
          for(let n=low;n<=high;n++)if(scale.notes.includes((n-fx.key+120)%12))pitches.push(n);
          if(!pitches.length)throw new Error("No scale notes fit this range.");
        }
      }else number(options.chance,0,100,"Active probability",false);
    }
    let affected=0,changed=0;
    for(const st of targets){
      const before=p.copyStep(t,s,st),step=p.step(t,s,st);let result;
      if(options.operation==="interpolate"){
        const position=order.indexOf(st);let left=anchors[0],right=anchors[anchors.length-1];
        for(let i=1;i<anchors.length;i++)if(position<=anchors[i].position){left=anchors[i-1];right=anchors[i];break;}
        result=left.value+(right.value-left.value)*(position-left.position)/(right.position-left.position);
        result=gate ? Math.round(result*8)/8 : Math.round(result);
      }else if(parameter==="active")result=random()*100<Number(options.chance);
      else if(pitches.length)result=pitches[Math.floor(random()*pitches.length)];
      else {const unit=gate ? 8 : 1,lo=Number(options.min)*unit,hi=Number(options.max)*unit;result=(lo+Math.floor(random()*(hi-lo+1)))/unit;}
      if(parameter==="active"){p.setStep(t,s,st,"enabled",result);affected++;}
      else if(parameter.startsWith("cc")){
        const lane=Number(parameter[2]);if((step.ccMask&(1<<lane))||options.fill){p.setCC(t,s,st,lane,result,true);affected++;}
      }else{
        let slots=parameter==="pitch" ? [0] : step.notes.flatMap((n,i)=>n.enabled ? [i] : []);
        if(!slots.length&&options.fill)slots=[0];
        for(const n of slots){const note=step.notes[n];if(!note.enabled&&!options.fill)continue;
          const patch={[parameter]:gate ? Math.round(result*8)-1 : result};
          if(!note.enabled)Object.assign(patch,{enabled:true,pitch:note.pitch<=127 ? note.pitch : 60,velocity:note.velocity<=127 ? note.velocity : 100,gate:note.gate<=511 ? note.gate : 7,[parameter]:gate ? Math.round(result*8)-1 : result});
          if(options.resetOffset)patch.offset=0;p.setNote(t,s,st,n,patch);affected++;
        }
      }
      const after=p.copyStep(t,s,st);if(before.some((b,i)=>b.some((v,n)=>v!==after[i][n])))changed++;
    }
    return {bytes:p.serialize(),report:{steps:targets.length,changed,affected,order:options.order,parameter}};
  }
  return {prepare};
});
