/* SQUID Manager project transport: WebHID report ID 0, 64-byte reports.
 * Uses 64-byte reports with CRC-16/XMODEM and acknowledged page transfers. */
(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory(require("./project-format.js"));
  else root.SquidHID=factory(root.SquidProject);
})(typeof globalThis!=="undefined"?globalThis:this,function(F){
  "use strict";
  const VID=0x2b73,PID=0x0025,REPORT_SIZE=64,CHUNK=60,MAX_BODY=8192;
  const COMMANDS=new Set([0,3,4,5,0x81]);
  const bytes=value=>Uint8Array.from(value instanceof DataView?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):value);
  const view=value=>new DataView(value.buffer,value.byteOffset,value.byteLength);
  function crc16(body){let crc=0;for(const byte of body){crc^=byte<<8;for(let bit=0;bit<8;bit++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff;}return crc;}
  function ackReport(marker,type,index=0){const report=new Uint8Array(REPORT_SIZE);report[0]=marker;report[1]=type;view(report).setUint16(2,index,true);return report;}
  function startReport(type,body){const report=ackReport(0xa0,type);view(report).setUint32(4,body.length,true);view(report).setUint16(8,crc16(body),true);return report;}
  function dataReport(type,index,body){if(body.length>CHUNK)throw new Error("A HID block holds at most 60 bytes.");const report=ackReport(0xa1,type,index);report.set(body,4);return report;}
  function isSquid(device){return device&&device.vendorId===VID&&device.productId===PID;}
  function checkReports(device){
    if(!isSquid(device))throw new Error("Select a TORAIZ SQUID.");
    const collections=[];function visit(list){for(const item of list||[]){collections.push(item);visit(item.children);}}visit(device.collections);
    const size=report=>(report.items||[]).reduce((n,item)=>n+item.reportSize*item.reportCount,0);
    const input=collections.some(c=>(c.inputReports||[]).some(r=>r.reportId===0&&size(r)===512));
    const output=collections.some(c=>(c.outputReports||[]).some(r=>r.reportId===0&&size(r)===512));
    if(!input||!output)throw new Error("This SQUID interface does not expose the expected 64-byte input/output reports.");
  }
  class Transport{
    constructor(device,{timeoutMs=5000,onTrace=()=>{}}={}){
      checkReports(device);this.device=device;this.timeoutMs=timeoutMs;this.onTrace=onTrace;this.pending=null;this.usable=true;this.chain=Promise.resolve();
      this.listener=event=>{
        if(event.reportId!==0||event.device&&event.device!==device)return;
        const report=bytes(event.data);
        this.chain=this.chain.then(()=>this.receive(report)).catch(error=>this.fail(error));
      };
      device.addEventListener("inputreport",this.listener);
    }
    trace(direction,report){this.onTrace({direction,marker:report[0],command:report[1],index:report.length>=4?view(report).getUint16(2,true):null,length:report.length});}
    fail(error){this.usable=false;const p=this.pending;if(!p)return;clearTimeout(p.timer);if(p.ack){clearTimeout(p.ack.timer);p.ack.reject(error);p.ack=null;}p.reject(error);}
    async write(report){
      if(!this.usable||!this.device.opened)throw new Error("SQUID disconnected. Connect again.");this.trace("out",report);let timer;
      try{await Promise.race([this.device.sendReport(0,report),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Sending to SQUID timed out. Reconnect before retrying.")),this.pending?this.pending.timeout:this.timeoutMs);})]);}
      finally{clearTimeout(timer);}
    }
    armResponse(p){clearTimeout(p.timer);p.timer=setTimeout(()=>this.fail(new Error("SQUID response timed out. Close Manager, reconnect and try again.")),p.timeout);}
    async exchange(report,marker,p){
      const index=view(report).getUint16(2,true);
      const ack=new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(new Error("SQUID acknowledgement timed out. Reconnect before retrying.")),p.timeout);p.ack={marker,index,resolve,reject,timer};});
      // The response can arrive before sendReport's promise resolves.
      ack.catch(()=>{});await this.write(report);await ack;
    }
    async command(type,body=new Uint8Array(),{timeoutMs=this.timeoutMs,onProgress=()=>{}}={}){
      if(!COMMANDS.has(type))throw new Error("Unsupported SQUID project command.");
      if(this.pending)throw new Error("Another SQUID request is still running.");
      if(!this.usable)throw new Error("Connect to the SQUID again before retrying.");
      body=bytes(body);if(body.length>4096)throw new Error("A SQUID request is limited to one 4 KiB page.");
      let p;const response=new Promise((resolve,reject)=>{p={type,resolve,reject,timeout:timeoutMs,incoming:null,ack:null,timer:null,onProgress};});
      response.catch(()=>{});this.pending=p;
      try{
        await this.exchange(startReport(type,body),0xa8,p);
        // Manager sends an empty A1 block even for a zero-length request.
        const blocks=Math.max(1,Math.ceil(body.length/CHUNK));
        for(let block=1;block<=blocks;block++){
          await this.exchange(dataReport(type,block,body.subarray((block-1)*CHUNK,block*CHUNK)),block===blocks?0xae:0xa9,p);
          onProgress({direction:"send",bytes:Math.min(body.length,block*CHUNK),total:body.length});
        }
        if(!p.incoming)this.armResponse(p);
        return await response;
      }catch(error){this.fail(error);throw error;}
      finally{clearTimeout(p.timer);if(p.ack)clearTimeout(p.ack.timer);if(this.pending===p)this.pending=null;}
    }
    async receive(report){
      this.trace("in",report);const p=this.pending;if(!p)return;
      if(report.length!==REPORT_SIZE)throw new Error("Unexpected SQUID report length.");
      const marker=report[0],type=report[1],index=view(report).getUint16(2,true);
      if(type!==p.type)throw new Error("Unexpected SQUID response command.");
      if([0xa8,0xa9,0xae,0xaf].includes(marker)){
        if(marker===0xaf)throw new Error("SQUID rejected the transfer or its checksum.");
        // Manager matches ACK markers only. Hardware ACKs carry the next block
        // index; Manager's receiver echoes the acknowledged block's index.
        const ack=p.ack,validIndex=ack&&(index===ack.index||index===ack.index+1);
        if(!ack||ack.marker!==marker||!validIndex)throw new Error("Unexpected SQUID acknowledgement: "+marker.toString(16)+" / "+type.toString(16)+" / "+index+"; expected "+(ack?ack.marker.toString(16)+" / "+ack.index:"none")+".");
        clearTimeout(ack.timer);p.ack=null;ack.resolve();return;
      }
      if(marker===0xa0){
        const length=view(report).getUint32(4,true);
        if(p.incoming||index!==0||!length||length>MAX_BODY){await this.write(ackReport(0xaf,type,index));throw new Error("Invalid SQUID response header or size.");}
        p.incoming={body:new Uint8Array(length),crc:view(report).getUint16(8,true),offset:0,index:1,complete:false};
        this.armResponse(p);await this.write(ackReport(0xa8,type));return;
      }
      const incoming=p.incoming;
      if(marker!==0xa1||!incoming||incoming.complete||index!==incoming.index){await this.write(ackReport(0xaf,type,index));throw new Error("SQUID response blocks arrived out of order.");}
      const count=Math.min(CHUNK,incoming.body.length-incoming.offset);incoming.body.set(report.subarray(4,4+count),incoming.offset);incoming.offset+=count;incoming.index++;
      p.onProgress({direction:"receive",bytes:incoming.offset,total:incoming.body.length});
      if(incoming.offset===incoming.body.length){
        incoming.complete=true;clearTimeout(p.timer);
        if(crc16(incoming.body)!==incoming.crc){await this.write(ackReport(0xaf,type,index));throw new Error("SQUID response checksum did not match. Reconnect before retrying.");}
        await this.write(ackReport(0xae,type,index));p.resolve(incoming.body);
      }else{this.armResponse(p);await this.write(ackReport(0xa9,type,index));}
    }
    disconnect(){this.fail(new Error("SQUID disconnected."));this.device.removeEventListener("inputreport",this.listener);}
  }
  function status(body,operation){
    if(body.length!==1)throw new Error("Unexpected SQUID "+operation+" response.");
    if(body[0]===2)throw new Error("SQUID is busy. Stop playback and finish any save/load operation, then retry.");
    if(body[0]!==1)throw new Error(body[0]===0?"SQUID could not "+operation+" (check free project/pattern space).":"Unknown SQUID "+operation+" status: "+body[0]);
  }
  function decodeProjectList(body){
    body=bytes(body);if(body.length===1){status(body,"list projects");throw new Error("Unexpected SQUID project-list status.");}
    const count=body[0];if(count>128||body.length!==5+count*36)throw new Error("Invalid SQUID project list.");
    const projects=[],ids=new Set();
    for(let i=0;i<count;i++){
      const at=1+i*36,id=body[at],patterns=view(body).getUint16(at+1,false),raw=body.subarray(at+3,at+36),end=raw.indexOf(0);
      if(id>128||patterns>1024||ids.has(id))throw new Error("Invalid SQUID project ID or pattern count.");ids.add(id);
      const name=new TextDecoder().decode(end<0?raw:raw.subarray(0,end));projects.push({id,patterns,name});
    }
    const tail=1+count*36,remainingProjects=body[tail];if(remainingProjects>128)throw new Error("Invalid SQUID project capacity.");
    return {projects,remainingProjects,remainingPatterns:view(body).getUint16(tail+1,false),currentId:body[tail+3]};
  }
  function countPatterns(header){let count=0;for(let t=0;t<16;t++)for(let b=0;b<8;b++){let mask=header[0x2c+t*0xe8+b];while(mask){count+=mask&1;mask>>=1;}}return count;}
  function cancelled(signal){if(signal&&signal.aborted){const error=new Error("Transfer cancelled.");error.name="AbortError";throw error;}}
  class Client{
    constructor(transport){this.transport=transport;this.busy=false;}
    async session(fn){if(this.busy)throw new Error("Another SQUID operation is still running.");this.busy=true;try{return await fn();}finally{this.busy=false;}}
    listProjects(){return this.session(async()=>decodeProjectList(await this.transport.command(0)));}
    async abort(type,body){if(this.transport.usable)try{await this.transport.command(type,body,{timeoutMs:1500});}catch(_){} }
    downloadProject(id,{signal,onProgress=()=>{}}={}){
      return this.session(async()=>{
        if(!Number.isInteger(id)||id<0||id>128)throw new Error("Invalid SQUID project ID.");cancelled(signal);let started=false;
        try{
          started=true;let page=await this.transport.command(3,Uint8Array.of(id,0));
          if(page.length===1){started=false;status(page,"read project");throw new Error("SQUID ended the project before its header.");}
          if(page.length!==F.PAGE||view(page).getUint32(0,false)!==0x83490004)throw new Error("Unsupported SQUID project header.");
          const count=countPatterns(page),result=new Uint8Array((count+1)*F.PAGE);result.set(page);onProgress({phase:"read",page:1,total:count+1});
          for(let i=0;i<count;i++){cancelled(signal);page=await this.transport.command(3,Uint8Array.of(id,1));if(page.length!==F.PAGE)throw new Error("SQUID ended the project before all pattern pages arrived.");result.set(page,(i+1)*F.PAGE);onProgress({phase:"read",page:i+2,total:count+1});}
          cancelled(signal);status(await this.transport.command(3,Uint8Array.of(id,1)),"finish reading project");started=false;
          cancelled(signal);F.Project.parse(result);return result;
        }catch(error){if(started)await this.abort(3,Uint8Array.of(id,2));throw error;}
      });
    }
    uploadProject(input,{signal,onProgress=()=>{}}={}){
      return this.session(async()=>{
        const project=F.Project.parse(input),body=bytes(input),capacity=new Uint8Array(2);view(capacity).setUint16(0,project.count,false);cancelled(signal);let prepared=false;
        try{
          onProgress({phase:"capacity",page:0,total:body.length/F.PAGE});status(await this.transport.command(4,capacity),"accept project");prepared=true;
          for(let page=0;page<body.length/F.PAGE;page++){cancelled(signal);status(await this.transport.command(5,body.subarray(page*F.PAGE,(page+1)*F.PAGE)),"receive project page");onProgress({phase:"write",page:page+1,total:body.length/F.PAGE});}
          cancelled(signal);onProgress({phase:"finishing",page:body.length/F.PAGE,total:body.length/F.PAGE});status(await this.transport.command(5,Uint8Array.of(0)),"save project");prepared=false;return project;
        }catch(error){if(prepared)await this.abort(5,Uint8Array.of(1));throw error;}
      });
    }
  }
  return {VID,PID,REPORT_SIZE,CHUNK,crc16,startReport,dataReport,ackReport,isSquid,checkReports,decodeProjectList,Transport,Client};
});
