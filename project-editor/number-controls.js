(function(root){
  "use strict";
  const controls=new WeakMap();let commit=()=>true,afterStep=()=>{};
  function labelFor(input){
    const label=input.labels&&input.labels[0],text=label&&Array.from(label.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join(" ").trim();
    return input.getAttribute("aria-label")||text||input.id||"Value";
  }
  function wrap(input){
    if(controls.has(input))return controls.get(input).wrapper;
    if(!input.getAttribute("aria-label"))input.setAttribute("aria-label",labelFor(input));
    const wrapper=document.createElement("span"),arrows=document.createElement("span"),buttons=[];
    wrapper.className="number-control";arrows.className="number-arrows";
    input.dataset.numberEnhanced="true";
    for(const direction of [1,-1]){
      const button=document.createElement("button"),label=(direction>0 ? "Increase " : "Decrease ")+labelFor(input);
      button.type="button";button.tabIndex=-1;button.className=direction>0 ? "number-increase" : "number-decrease";
      button.textContent=direction>0 ? "▲" : "▼";button.title=label;button.setAttribute("aria-label",label);
      if(input.id){button.id=input.id+(direction>0 ? "-increase" : "-decrease");button.setAttribute("aria-controls",input.id);}
      // Leave the input focused; the arrows do not add stops to the Tab order.
      button.onmousedown=event=>event.preventDefault();
      button.onclick=()=>{
        if(input.disabled||input.readOnly||!commit())return;
        const field=input.id ? document.getElementById(input.id) : input;
        if(!field||field.disabled||field.readOnly||field.isConnected===false)return;
        field.focus({preventScroll:true});const before=field.value;
        if(direction>0)field.stepUp();else field.stepDown();
        if(field.value!==before){field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new Event("change",{bubbles:true}));afterStep(field.id);}
      };
      arrows.append(button);buttons.push(button);
    }
    const parent=input.parentNode;if(parent)parent.insertBefore(wrapper,input);
    wrapper.append(input,arrows);controls.set(input,{wrapper,buttons});syncInput(input);return wrapper;
  }
  function syncInput(input){const control=controls.get(input);if(control)for(const button of control.buttons)button.disabled=!!(input.disabled||input.readOnly);}
  function sync(){for(const input of document.querySelectorAll('input[type="number"]'))syncInput(input);}
  root.SquidNumbers={wrap,sync,labelFor,setCommitter:(fn,after)=>{commit=fn;afterStep=after;}};
  for(const input of document.querySelectorAll('input[type="number"]'))wrap(input);
  if(root.MutationObserver)new root.MutationObserver(records=>{for(const record of records)if(record.target.tagName==="INPUT")syncInput(record.target);}).observe(document.body,{subtree:true,attributes:true,attributeFilter:["disabled","readonly"]});
})(window);
