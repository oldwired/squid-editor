(function(root){
  "use strict";
  root.SquidHardware={setup:function(editor){
    const H=root.SquidHID,F=root.SquidProject,$=id=>document.getElementById(id),hid=root.navigator&&root.navigator.hid;
    const supported=!!hid&&root.isSecureContext!==false;
    let device=null,transport=null,client=null,list=null,selected=null,busy=false,controller=null,draft=null;
    const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
    const safe=name=>(name||"SQUID project").replace(/[<>:"/\\|?*\x00-\x1f]/g,"_");
    const stamp=()=>new Date().toISOString().replace(/[-:]/g,"").replace("T","_").replace(".","_").replace("Z","");
    function message(text,error=false){$("hardware-status").textContent=text;$("hardware-status").className=error?"hardware-error":"field-hint";}
    function renderList(){
      $("hardware-projects").replaceChildren();
      if(!list){$("hardware-capacity").textContent="";return;}
      $("hardware-capacity").textContent=list.remainingProjects+" project slots · "+list.remainingPatterns+" pattern slots free";
      if(!list.projects.length){$("hardware-projects").append(node("p","No saved projects on the SQUID."));return;}
      for(const project of list.projects){
        const button=node("button");button.type="button";button.className="hardware-project"+(project.id===selected?" selected":"");button.id="hardware-project-"+project.id;
        button.setAttribute("aria-pressed",project.id===selected);button.append(node("span",project.name||"Untitled project"),node("small","ID "+project.id+" · "+project.patterns+" patterns"+(project.id===list.currentId?" · Current":"")));
        button.disabled=busy;button.onclick=()=>{selected=project.id;renderList();update();$("hardware-project-"+project.id).focus();};$("hardware-projects").append(button);
      }
    }
    function update(){
      const connected=!!device&&device.opened&&!!transport&&transport.usable;
      $("hardware-manager").textContent=busy?"SQUID · transferring…":connected?"SQUID · Connected":"SQUID · Not connected";
      $("hardware-manager").setAttribute("aria-expanded",!!$("hardware-dialog").open);
      $("hardware-connect").disabled=!supported||busy||connected;$("hardware-disconnect").disabled=!device||busy;
      $("hardware-refresh").disabled=!connected||busy;$("hardware-open").disabled=$("hardware-save").disabled=!connected||busy||selected===null;
      $("hardware-review-send").disabled=!connected||busy;$("hardware-send").disabled=!connected||busy||!draft;
      $("hardware-cancel").hidden=!busy||!controller;$("hardware-cancel").disabled=!!controller&&controller.signal.aborted;
      $("close-hardware").disabled=busy;
      for(const row of $("hardware-projects").children)if(row.tagName==="BUTTON")row.disabled=busy;
      if(draft&&!busy){const current=editor.getProject().serialize();if(current.length!==draft.bytes.length||current.some((n,i)=>n!==draft.bytes[i])){draft=null;$("hardware-send-review").hidden=true;$("hardware-send").disabled=true;message("The editor project changed. Review it again before sending.");}}
    }
    async function disconnect(){
      const old=device;if(transport)transport.disconnect();transport=null;client=null;device=null;list=null;selected=null;draft=null;$("hardware-send-review").hidden=true;renderList();update();
      if(old&&old.opened)await old.close();
    }
    async function disconnectOnWireError(){if(device&&(!transport||!transport.usable))try{await disconnect();}catch(_){} }
    async function run(action){
      if(busy)return;busy=true;$("hardware-progress").hidden=true;update();
      try{await action();}
      catch(error){message(error.message,true);await disconnectOnWireError();}
      finally{busy=false;controller=null;update();}
    }
    async function refresh(announce=true){
      if(announce)message("Reading SQUID projects…");list=await client.listProjects();if(!list.projects.some(p=>p.id===selected))selected=list.projects.length?list.projects[0].id:null;
      renderList();if(announce)message("Connected · "+list.projects.length+" saved projects");
    }
    function progress(info){
      const bar=$("hardware-progress");bar.hidden=false;bar.max=info.total;bar.value=info.page;
      if(info.phase==="finishing"){controller=null;update();message("SQUID is saving the project…");}
      else if(controller&&controller.signal.aborted)message("Cancelling after the current page…");
      else message(info.phase==="capacity"?"Checking SQUID capacity…":(info.phase==="read"?"Reading":"Sending")+" page "+info.page+" of "+info.total+"…");
    }
    function download(bytes,name){const url=URL.createObjectURL(new Blob([bytes],{type:"application/octet-stream"})),link=node("a");link.href=url;link.download=safe(name)+"_"+stamp()+".prj";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return link.download;}
    $("hardware-manager").onclick=()=>{if(!editor.commit())return;$("hardware-dialog").showModal();update();};
    $("close-hardware").onclick=()=>{$("hardware-dialog").close();update();};
    $("hardware-dialog").addEventListener("cancel",event=>{if(busy)event.preventDefault();});
    $("hardware-dialog").addEventListener("close",update);
    root.addEventListener("beforeunload",event=>{if(busy){event.preventDefault();event.returnValue="";}});
    $("hardware-connect").onclick=()=>run(async()=>{
      if(!supported)throw new Error("Use Chrome or Chromium on localhost or HTTPS for SQUID access.");
      message("Choose your SQUID in the browser's device picker…");
      const devices=await hid.requestDevice({filters:[{vendorId:H.VID,productId:H.PID,usagePage:0xffa0}]});
      if(!devices.length){message("No SQUID selected.");return;}
      device=devices.find(H.isSquid);H.checkReports(device);await device.open();transport=new H.Transport(device);client=new H.Client(transport);await refresh();
    });
    $("hardware-disconnect").onclick=()=>run(async()=>{await disconnect();message("Disconnected.");});
    $("hardware-refresh").onclick=()=>run(refresh);
    for(const [id,open] of [["hardware-open",true],["hardware-save",false]])$(id).onclick=()=>{
      if(open&&!editor.commit())return;const project=list&&list.projects.find(p=>p.id===selected);if(!project)return;
      run(async()=>{controller=new AbortController();update();const bytes=await client.downloadProject(project.id,{signal:controller.signal,onProgress:progress});
        const parsed=F.Project.parse(bytes);
        if(open){if(editor.loadProject(bytes,"SQUID: "+parsed.name)){message("Opened "+parsed.name+" from the SQUID.");$("hardware-dialog").close();}else message("Project received; the current editor project was kept.");}
        else message("Download requested: "+download(bytes,parsed.name));
      });
    };
    $("hardware-cancel").onclick=()=>{if(controller){controller.abort();message("Cancelling after the current page…");update();}};
    $("hardware-review-send").onclick=()=>{
      if(!editor.commit())return;
      try{const bytes=editor.getProject().serialize(),p=F.Project.parse(bytes);draft={bytes,name:p.name};$("hardware-send-summary").textContent='Send “'+p.name+'” · '+p.count+' patterns · '+p.bpm+' BPM · '+bytes.length/1024+' KiB';$("hardware-send-review").hidden=false;message("Review the project below, then send it to the SQUID.");update();}
      catch(error){message(error.message,true);}
    };
    $("hardware-send").onclick=()=>{
      if(!editor.commit())return;update();if(!draft)return;const snapshot=draft;draft=null;$("hardware-send-review").hidden=true;
      run(async()=>{
        controller=new AbortController();update();await client.uploadProject(snapshot.bytes,{signal:controller.signal,onProgress:progress});
        const saved="SQUID confirmed that “"+snapshot.name+"” was saved.";message(saved);
        try{await refresh(false);}
        catch(error){await disconnectOnWireError();message(saved+" Project list refresh failed: "+error.message,true);}
      });
    };
    if(hid)hid.addEventListener("disconnect",event=>{if(event.device===device){if(transport)transport.disconnect();device=null;transport=null;client=null;list=null;selected=null;draft=null;$("hardware-send-review").hidden=true;renderList();message("SQUID disconnected. Reconnect to continue.",true);update();}});
    if(!supported)message(root.isSecureContext===false?"Open this editor on localhost or HTTPS to connect to the SQUID.":"Hardware access needs Chrome or Chromium. File editing remains available.");
    else message("Connect the SQUID by USB and close SQUID Manager, then choose Connect.");
    update();return update;
  }};
})(window);
