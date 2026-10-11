(function(root){
  'use strict';
  let current=null;
  const $=id=>document.getElementById(id);
  root.SquidWorkbench={reveal(tab='step'){if(current)current.reveal(tab);},welcome(){if(current)current.welcome();},setup(editor){
    const F=root.SquidProject,node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
    let tab='step',drawer=false,origin=null,lastSlot=null,lastTrack=null,allSteps=false;
    const inspector=$('details-inspector'),tabs=['step','pattern','track'];
    const narrow=()=>root.matchMedia&&root.matchMedia('(max-width: 1100px)').matches;
    function updatePanels(){for(const key of tabs){$('details-'+key).hidden=key!==tab;const button=$('details-tab-'+key);button.setAttribute('aria-selected',key===tab);button.tabIndex=key===tab?0:-1;}inspector.dataset.open=String(drawer);$('show-details').setAttribute('aria-expanded',!narrow()||drawer);}
    function reveal(key){if(!drawer)origin=document.activeElement&&document.activeElement.id;tab=key;drawer=true;updatePanels();if(narrow())requestAnimationFrame(()=>{const cell=$(editor.stepButtonId());if(!cell)return;const box=cell.getBoundingClientRect(),panel=inspector.getBoundingClientRect();if(box.bottom>panel.top-12)root.scrollBy({top:box.bottom-panel.top+16,behavior:'smooth'});});}
    current={reveal,welcome};
    function closeDetails(){drawer=false;updatePanels();const target=$(origin)||$(editor.stepButtonId());if(target)target.focus();}
    for(const [i,key] of tabs.entries()){
      const button=$('details-tab-'+key);button.onclick=()=>{if(editor.commit()){reveal(key);button.focus();}};
      button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;if(editor.commit()){reveal(tabs[next]);$('details-tab-'+tabs[next]).focus();}};
    }
    $('show-details').onclick=()=>{if(editor.commit()){reveal('step');$('details-tab-step').focus();}};$('close-details').onclick=closeDetails;
    inspector.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('note-panel').hidden)return;if(e.key==='Escape'){e.preventDefault();closeDetails();}});
    $('track-route').onclick=()=>{if(editor.commit()){reveal('track');$('track-port').focus();}};$('track-route').onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();$('track-route').onclick();}};
    $('pattern-effects').onclick=()=>{if(editor.commit()){reveal('pattern');$('details-tab-pattern').focus();}};
    $('pattern-effects').onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();$('pattern-effects').onclick();}};
    $('pattern-effects').setAttribute('role','button');$('pattern-effects').tabIndex=0;$('pattern-effects').title='Open pattern setup';
    $('bank-page').onchange=()=>{if(!editor.commit())return;const [t,s]=editor.getSelection(),start=Number($('bank-page').value)*16;editor.select(t,start<=s&&s<start+16?s:start,0);};
    $('bank-overview').onchange=render;
    function stepPage(delta){if(!editor.commit())return;const [t,s,st]=editor.getSelection(),p=editor.getProject(),present=p.patterns[t].has(s),pages=present&& !$('show-stored-steps').checked?(p.pattern(t,s)[4]&15):4;editor.select(t,s,Math.max(0,Math.min(pages-1,Math.floor(st/16)+delta))*16);}
    $('previous-page').onclick=()=>stepPage(-1);$('next-page').onclick=()=>stepPage(1);
    $('step-page-select').onchange=()=>{const value=$('step-page-select').value;if(!editor.commit()){render();return;}allSteps=value==='all';const [t,s,st]=editor.getSelection();editor.select(t,s,allSteps?st:Number(value)*16);};
    for(const key of ['velocity','gate','cc'])$('lane-'+key).onclick=()=>{if(!editor.commit())return;$('show-value-chart').checked=true;$('value-lane').value=key==='cc'?($('value-lane').value.startsWith('cc')?$('value-lane').value:'cc0'):key;$('value-lane').onchange();render();};
    $('create-drum-view').onclick=()=>{if(editor.commit()){$('split-drums').disabled=root.SquidDrums.isSingleTrack(editor.getProject(),editor.getSelection()[0]);$('create-drum-dialog').showModal();}};$('close-create-drum').onclick=()=>{$('create-drum-dialog').close();$('create-drum-view').focus();};
    for(const id of ['split-drums','group-drums'])$(id).addEventListener('click',()=>{$('create-drum-dialog').close();if(!$('drum-group-dialog').open){const cell=$(editor.stepButtonId());if(cell)cell.focus();}});
    $('midi-settings').onclick=()=>{if(editor.commit())$('midi-dialog').showModal();};$('close-midi-settings').onclick=()=>{$('midi-dialog').close();$('midi-settings').focus();};
    for(const scope of ['pattern','snapshot','bank'])$('export-scope-'+scope).onclick=()=>{$('export-scope').value=scope;$('export-scope').onchange();for(const k of ['pattern','snapshot','bank'])$('export-scope-'+k).setAttribute('aria-pressed',scope===k);};
    // Native details menus and dialogs provide keyboard navigation and modal isolation.
    for(const menu of document.querySelectorAll('.action-menu'))menu.addEventListener('click',e=>{if(e.target.tagName==='BUTTON')menu.open=false;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const menu of document.querySelectorAll('.action-menu[open]'))menu.open=false;});
    for(const [id,action] of [['welcome-new','new-project'],['welcome-open','open-project'],['welcome-device','hardware-manager'],['welcome-demo',null],['close-welcome',null]])$(id).onclick=()=>{$('welcome-dialog').close();try{root.sessionStorage.setItem('squid-welcome','seen');}catch(_){}if(action)$(action).click();else $('track-0').focus();};
    function welcome(){try{if(root.sessionStorage.getItem('squid-welcome'))return;}catch(_){}if(!document.querySelector('dialog[open]'))$('welcome-dialog').showModal();}
    function render(){const p=editor.getProject(),[t,s,st]=editor.getSelection(),color=F.TRACK_COLORS[p.track(t).color??0].hex;
      document.documentElement.style.setProperty('--track-accent',color);
      if(t!==lastTrack||s!==lastSlot){$('bank-page').value=Math.floor(s/16);lastTrack=t;lastSlot=s;}
      for(let n=0;n<64;n++){const button=$('pattern-'+n);if(!button)continue;button.hidden=!$('bank-overview').checked&&Math.floor(n/16)!==Number($('bank-page').value);const starting=p.track(t).selectedPattern===n;button.dataset.starting=String(starting);button.title+=''+(starting?' · Starting pattern':'');if(starting)button.setAttribute('aria-label',button.getAttribute('aria-label')+', starting pattern');}
      const present=p.patterns[t].has(s),pages=present?(allSteps||$('show-stored-steps').checked?4:p.pattern(t,s)[4]&15):1,select=$('step-page-select');select.replaceChildren();for(let n=0;n<pages;n++){const opt=node('option',String(n*16+1).padStart(2,'0')+'–'+(n*16+16));opt.value=n;select.append(opt);}const all=node('option','All 64 · four rows');all.value='all';select.append(all);select.value=allSteps?'all':Math.floor(st/16);select.disabled=!present;
      $('previous-page').disabled=allSteps||!present||st<16;$('next-page').disabled=allSteps||!present||Math.floor(st/16)>=pages-1;
      for(const parent of [$('step-grid'),$('value-plot')]){parent.dataset.allSteps=String(allSteps&&$('drum-overlay').hidden);for(const [i,group] of Array.from(parent.children).entries())group.hidden=parent.id==='value-plot'&&!$('drum-overlay').hidden?false:!allSteps&&i!==Math.floor(st/16);}
      const drum=!$('drum-overlay').hidden;document.querySelector('.step-navigation').hidden=drum;
      for(const key of ['velocity','gate','cc'])$('lane-'+key).setAttribute('aria-pressed',$('show-value-chart').checked&&(key==='cc'?$('value-lane').value.startsWith('cc'):$('value-lane').value===key));
      $('show-details').textContent='Edit step '+String(st+1).padStart(2,'0');$('clear-step').textContent=editor.getNoteSelection()!==null?'Clear Note '+(editor.getNoteSelection()+1)+' at step '+(st+1):'Clear notes & CC at step '+(st+1);
      const virtual=$('virtual-parts');virtual.replaceChildren();for(const group of root.SquidDrums.groups(p)){const button=node('button','Drum group '+group.id+' · '+group.rows.length+' tracks');button.className='virtual-part';button.setAttribute('aria-pressed',group.rows.some(r=>r.track===t));button.onclick=()=>{if(editor.commit())editor.select(group.rows[0].track,s,st);};virtual.append(button);}
      updatePanels();
    }
    if(root.matchMedia)root.matchMedia('(max-width: 1100px)').addEventListener('change',()=>{updatePanels();if(drawer)reveal(tab);});
    render();return render;
  }};
})(window);
