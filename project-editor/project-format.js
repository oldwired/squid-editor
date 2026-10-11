/* SQUID .prj codec. Browser + Node; preserves opaque bytes on existing files. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SquidProject = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PAGE = 4096, TRACKS = 16, SLOTS = 64, MAX_SIZE = PAGE * (1 + TRACKS * SLOTS);
  const PORTS = ["None", "MIDI 1", "MIDI 2", "USB", "CV/GATE 1", "CV/GATE 2"];
  // Display swatches sampled from the operating manual's Track Color chart
  // (p. 147). These describe its illustration, not calibrated hardware LEDs.
  const TRACK_COLORS = [
    ["Red","#ff0000"],["Orange","#ff4a00"],["Amber","#ff9c00"],["Yellow","#fffe00"],
    ["Lime","#b6ff00"],["Chartreuse","#89ff00"],["Green","#01ff00"],["Mint","#00ffc8"],
    ["Cyan","#00ffff"],["Sky blue","#009eff"],["Blue","#0017ff"],["Violet","#8d00ff"],
    ["Purple","#ea00ff"],["Magenta","#ff00ff"],["Pink","#ff009d"],["Rose","#ff0067"]
  ].map(([name,hex])=>({name,hex}));
  const DIRECTIONS = [
    [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
    [0,4,8,12,1,5,9,13,2,6,10,14,3,7,11,15],
    [0,1,2,3,7,6,5,4,8,9,10,11,15,14,13,12],
    [0,1,2,3,7,11,15,14,13,12,8,4,5,6,10,9],
    [0,4,8,12,13,14,15,11,7,3,2,1,5,9,10,6],
    [0,2,1,3,4,6,5,7,8,10,9,11,12,14,13,15],
    [3,2,1,0,7,6,5,4,11,10,9,8,15,14,13,12],
    [3,7,11,15,2,6,10,14,1,5,9,13,0,4,8,12],
    [3,2,1,0,4,5,6,7,11,10,9,8,12,13,14,15],
    [3,2,1,0,4,8,12,13,14,15,11,7,6,5,9,10],
    [3,7,11,15,14,13,12,8,4,0,1,2,6,10,9,5],
    [3,1,2,0,7,5,6,4,11,9,10,8,15,13,14,12]
  ];
  const DIRECTION_NAMES = ["Right", "Down", "Zigzag", "Clockwise", "Counterclockwise",
    "Interleaved", "Right · mirrored", "Down · mirrored", "Zigzag · mirrored",
    "Clockwise · mirrored", "Counterclockwise · mirrored", "Interleaved · mirrored"];
  const SCALES = [
    ["Chromatic",[0,1,2,3,4,5,6,7,8,9,10,11]],["Ionian / major",[0,2,4,5,7,9,11]],
    ["Dorian",[0,2,3,5,7,9,10]],["Phrygian",[0,1,3,5,7,8,10]],
    ["Lydian",[0,2,4,6,7,9,11]],["Mixolydian",[0,2,4,5,7,9,10]],
    ["Aeolian / minor",[0,2,3,5,7,8,10]],["Locrian",[0,1,3,5,6,8,10]],
    ["Major pentatonic",[0,2,4,7,9]],["Minor pentatonic",[0,3,5,7,10]],
    ["Whole tone",[0,2,4,6,8,10]],["Diminished",[0,2,3,5,6,8,9,11]],
    ["Combination diminished",[0,1,3,4,6,7,9,10]],["Altered",[0,1,3,4,6,8,10]],
    ["Major blues",[0,2,3,4,7,9]],["Minor blues",[0,3,5,6,7,10]],
    ["Raga Bhairav",[0,1,4,5,7,8,11]],["Raga Gamanasrama",[0,1,4,6,7,9,11]],
    ["Raga Todi",[0,1,3,6,7,8,11]],["Hawaiian",[0,2,3,7,9]],
    ["Ryukyu",[0,4,5,7,11]],["Japanese Miyakobushi",[0,1,5,7,8]],
    ["Harmonic minor",[0,2,3,5,7,8,11]]
  ].map(([name,notes])=>({name,notes}));
  const HARMONIZER_PRESETS = [
    ["M",[4,7]],["m",[3,7]],["7",[4,7,10]],["M7",[4,7,11]],
    ["m7",[3,7,10]],["mM7",[3,7,11]],["6",[4,7,9]],["m6",[3,7,9]],
    ["9",[4,7,10,14]],["M9",[4,7,11,14]],["m9",[3,7,10,14]],
    ["69",[4,7,9,14]],["m69",[3,7,9,14]],["sus4",[5,7]],
    ["7sus4",[5,7,10]],["dim",[3,6]],["aug",[4,8]],["aug7",[4,8,10]],
    ["add9",[4,7,14]],["7+5",[4,8,10]],["7−5",[4,6,10]],
    ["m7−5",[3,6,10]],["7 (#9)",[4,7,10,15]],["7−9",[4,7,10,13]]
  ].map(([name,intervals])=>({name,intervals}));
  const ARP_RATES = ["1/2","1/4","1/8 dotted","1/8","1/8 triplet","1/16","1/16 triplet","1/32"];
  const SPEED_CONTROL = [[0,"Off"],[1,"Half speed"],...Array.from({length:6},(_,i)=>[i+2,"Gate hold from "+i+"/6"]),[8,"Double speed"],[9,"Continue previous control"]];
  const ROLLS = [[0,"Off"],...[0,8,16].flatMap((flag)=>["1/4","1/8","1/16","1/32"].map((name,i)=>[flag+i+1,name+(flag===8 ? " triplet" : flag===16 ? " dotted" : "")])),[21,"Continue previous roll"]];
  function integer(value, min, max, label) {
    const n = value === null || value === undefined || (typeof value === "string" && !value.trim()) ? NaN : Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(label + " must be " + min + "–" + max + ".");
    return n;
  }
  function u16(b, a) { return (b[a] << 8) | b[a + 1]; }
  function put16(b, a, v) { b[a] = v >>> 8; b[a + 1] = v; }
  function u32(b, a) { return (b[a] * 0x1000000 + (b[a+1] << 16) + (b[a+2] << 8) + b[a+3]) >>> 0; }
  function put32(b, a, v) { b[a] = v >>> 24; b[a+1] = v >>> 16; b[a+2] = v >>> 8; b[a+3] = v; }
  function text(b, a, n) {
    let result = "";
    for (let i = a; i < a+n && b[i]; i++) result += String.fromCharCode(b[i]);
    return result;
  }
  function putText(b, a, n, value) {
    if (typeof value !== "string" || value.length >= n || /[^\x20-\x7e]/.test(value))
      throw new Error("Use up to " + (n-1) + " printable ASCII characters.");
    b.fill(0, a, a+n);
    for (let i = 0; i < value.length; i++) b[a+i] = value.charCodeAt(i);
  }
  function field(word, start, width) { return (word >>> start) & (2 ** width - 1); }
  function replaceField(word, start, width, value) {
    const mask = ((2 ** width - 1) << start) >>> 0;
    return ((word & ~mask) | (value << start)) >>> 0;
  }
  function trackBase(t) { return 0x2c + integer(t, 0, 15, "Track") * 0xe8; }
  function settingsBase(t) { return trackBase(t) + 0x88; }
  function packedRead(b,base,start,width) {
    let n=0; for(let i=0;i<width;i++) n=n*2+((b[base+((start+i)>>3)]>>(7-((start+i)&7)))&1); return n;
  }
  function packedWrite(b,base,start,width,value) {
    for(let i=0;i<width;i++) { const at=base+((start+i)>>3), bit=1<<(7-((start+i)&7));
      b[at]=(value>>(width-i-1))&1 ? b[at]|bit : b[at]&~bit; }
  }
  function validatePattern(p) {
    const magic = text(p, 0, 4);
    if (p.length !== PAGE || !["seq2", "seq3"].includes(magic))
      throw new Error("Only complete seq2/seq3 pattern pages are supported.");
    integer(p[4] & 15, 1, 4, "Pattern pages");
    for (let s = 0; s < 64; s++) {
      const word = u32(p, 8 + s*4);
      const mask = field(word, 14, 8);
      for (let slot = 0; slot < 8; slot++) {
        if (!(mask & (1 << slot))) continue;
        const n = 0x290 + s*32 + slot*4;
        integer(p[n], 0, 127, "Note");
        integer(p[n+1], 0, 127, "Velocity");
        integer(u16(p, n+2), 0, 511, "Gate");
      }
    }
  }
  function rebuildTraversal(p) {
    const pages = p[4] & 15, code = u32(p, 0xe28);
    const order = DIRECTIONS[code] || DIRECTIONS[0], inverse = [];
    order.forEach(function (local, position) { inverse[local] = position; });
    const active = [];
    for (let page = 0; page < pages; page++) {
      if (!u16(p, 0x108 + page*2)) continue;
      order.forEach(function (local, position) {
        const step = page*16+local;
        if (u32(p, 8+step*4) & 0x80000000) active.push({position: page*16+position, step: step});
      });
    }
    for (let step = 0; step < 64; step++) {
      if (!active.length) { p[0xe34+step] = step; p[0xe74+step] = step; continue; }
      let next = active[0].step, previous = active[active.length-1].step;
      const position = (step >> 4)*16+inverse[step & 15];
      if (step < pages*16) {
        const after = active.find(function (x) { return x.position > position; });
        if (after) next = after.step;
        for (const x of active) if (x.position < position) previous = x.step;
      }
      p[0xe34+step] = next; p[0xe74+step] = previous;
    }
  }
  function blankPattern(pages) {
    pages = integer(pages, 1, 4, "Pages");
    const p = new Uint8Array(PAGE);
    putText(p, 0, 5, "seq3"); p[4] = pages; p[5] = 2;
    for (let s = 0; s < 64; s++) {
      put32(p, 8+s*4, 0x80000000);
      p[0x110+s*6] = 1;
      for (let n = 0; n < 8; n++) {
        const at = 0x290+s*32+n*4;
        p[at] = 60; p[at+1] = 100; put16(p, at+2, 7);
      }
      p[0xbd0+s*9] = 8;
      p.fill(64, 0xbd0+s*9+3, 0xbd0+s*9+9);
    }
    p.fill(255, 0x108, 0x110);
    p.set([0,16,64,0,0,1,100,0], 0xe10);
    put32(p, 0xe18, 5); p[0xe22] = 50; p[0xe25] = 16;
    rebuildTraversal(p);
    return p;
  }
  class Project {
    constructor(header, patterns) { this.header = header; this.patterns = patterns; }
    get warnings() {
      const warnings = [], tempo = u16(this.header,0xfb0);
      if (tempo < 300 || tempo > 3000) warnings.push("Stored tempo is outside 30–300 BPM; displaying Manager’s 120 BPM fallback. Original bytes are preserved until tempo is edited.");
      for (let t=0;t<16;t++) for (const [s,p] of this.patterns[t]) {
        if (Array.from({length:64},(_,i)=>u32(p,8+i*4)&511).some(Boolean))
          warnings.push("Track "+(t+1)+", pattern "+(s+1)+": unknown low step flags are preserved.");
      }
      return warnings;
    }
    static parse(input) {
      // Node Buffers implement slice() as a borrowed view. Own plain bytes so
      // editing never mutates an imported buffer or the caller's ArrayBuffer.
      const bytes = Uint8Array.from(input instanceof Uint8Array ? input : new Uint8Array(input));
      if (bytes.length < PAGE || bytes.length > MAX_SIZE || bytes.length % PAGE)
        throw new Error("A project needs one 4 KiB header and complete 4 KiB pattern pages.");
      if (u32(bytes, 0) !== 0x83490004) throw new Error("Unsupported project format. Open a format-4 .prj export from SQUID Manager.");
      const header = bytes.slice(0, PAGE), patterns = [], expected = bytes.length / PAGE;
      let page = 1;
      for (let t = 0; t < 16; t++) {
        const name = "trk" + String(t+1).padStart(2,"0"), signature = text(header, settingsBase(t), 8);
        if (![name, name+"V3"].includes(signature)) throw new Error("Unsupported track settings: " + signature + ".");
        const slots = new Map(), base = trackBase(t);
        for (let s = 0; s < 64; s++) {
          if (!(header[base+(s>>3)] & (0x80 >> (s&7)))) continue;
          if (page >= expected) throw new Error("The occupancy bitmap asks for more pattern pages than the file contains.");
          const data = bytes.slice(page*PAGE, (page+1)*PAGE); validatePattern(data);
          slots.set(s, data); page++;
        }
        patterns.push(slots);
      }
      if (page !== expected) throw new Error("Unexpected trailing pages: the project bitmap and file size disagree.");
      return new Project(header, patterns);
    }
    static create(name) {
      // Construct every field explicitly; no device export or factory demo is
      // used as a template. Unassigned sectors/scenes use the format sentinel.
      const h = new Uint8Array(PAGE), project = new Project(h, Array.from({length:16}, function () { return new Map(); }));
      put32(h, 0, 0x83490004);
      project.name = name || "Untitled project"; project.bpm = 120;
      put16(h, 0x26, 0); put32(h, 0x28, 0xffffffff);
      h.fill(255, 0xeac, 0xfac); h.fill(0, 0xfac, 0xfb0);
      // Standard chord choices for this editor, independent of factory presets.
      const chords = [[4,7],[3,7],[4,7,10],[3,7,10],[4,7,11],[3,7,10,14]];
      for (let t = 0; t < 16; t++) {
        const base = trackBase(t);
        h.fill(0, base, base+8); h.fill(255, base+8, base+0x88);
        const settings = settingsBase(t);
        putText(h,settings,8,"trk"+String(t+1).padStart(2,"0")+"V3");
        // Unexposed V3 setting below the current-pattern bits; retain its
        // initialization value for compatibility while constructing the header.
        h[settings+0x0a] = 1;
        // Uniform packed defaults; only channel/color/name vary per track.
        project.setTrack(t,"color",t);
        project.setTrack(t, "name", "Track " + String(t+1).padStart(2,"0"));
        project.setTrack(t, "port", 3); project.setTrack(t, "channel", t+1);
        project.setTrack(t, "delay", 0);
        ["bankMSB", "bankLSB", "program"].forEach(function (key) { project.setTrack(t, key, 255); });
        for (let lane = 0; lane < 5; lane++) project.setTrack(t,"cc"+lane,lane);
        chords.forEach(function (intervals,index) { project.setHarmonizer(t,index,intervals); });
      }
      return project;
    }
    get name() { return text(this.header, 4, 33); }
    set name(value) {
      if (typeof value !== "string" || !value.trim()) throw new Error("Give the project a name.");
      putText(this.header, 4, 33, value);
    }
    get bpm() { const n=u16(this.header,0xfb0); return n>=300 && n<=3000 ? n/10 : 120; }
    set bpm(value) {
      const n = typeof value === "string" && !value.trim() ? NaN : Number(value);
      if (!Number.isFinite(n) || n<30 || n>300) throw new Error("Tempo must be 30–300 BPM.");
      put16(this.header,0xfb0,Math.round(n*10));
    }
    get count() { return this.patterns.reduce(function (n, slots) { return n+slots.size; }, 0); }
    track(t) {
      const base = settingsBase(t), h = this.header, signature = text(h, base, 8), isV3 = signature.endsWith("V3");
      return {name: text(h, base+0x14, 32), signature: signature, isV3: isV3,
        port: isV3 ? h[base+8] >>> 3 : null,
        channel: isV3 ? (((h[base+8]&7)<<1) | (h[base+9]>>>7))+1 : null,
        mute: isV3 ? !!(h[base+9]&64) : null, solo: isV3 ? !!(h[base+9]&32) : null,
        color: isV3 ? (h[base+9]>>1)&15 : null,
        mono: isV3 ? !!(h[base+0xf]&8) : null,
        selectedPattern: isV3 ? packedRead(h,base+8,15,6) : null,
        harmonizer:Array.from({length:6},(_,i)=>Array.from({length:4},(_,n)=>(u16(h,base+0x34+i*2)>>(12-n*4))&15)),
        ccNumbers: isV3 ? Array.from({length:5},(_,i)=>packedRead(h,base+8,25+i*7,7)) : null,
        delay: h[base+0x10], bankMSB: h[base+0x11], bankLSB: h[base+0x12], program: h[base+0x13]};
    }
    setTrack(t, key, value) {
      const base = settingsBase(t), h = this.header;
      if (key === "name") return putText(h, base+0x14, 32, value);
      if (!this.track(t).isV3) throw new Error("Routing/control edits require V3 track settings.");
      if (key === "mute" || key === "solo") {
        const bit=key==="mute" ? 64 : 32; h[base+9]=value ? h[base+9]|bit : h[base+9]&~bit; return;
      }
      if (key === "color") {h[base+9]=(h[base+9]&0xe1)|(integer(value,0,15,"Track color")<<1);return;}
      if (key === "mono") {h[base+0xf]=value ? h[base+0xf]|8 : h[base+0xf]&0xf7;return;}
      if (key === "selectedPattern") {packedWrite(h,base+8,15,6,integer(value,0,63,"Selected pattern"));return;}
      if (/^cc[0-4]$/.test(key)) { packedWrite(h,base+8,25+Number(key[2])*7,7,integer(value,0,127,"CC number")); return; }
      if (key === "port") { h[base+8] = (h[base+8]&7) | (integer(value,0,5,"Output")<<3); return; }
      if (key === "channel") {
        const ch = integer(value,1,16,"Channel")-1;
        h[base+8] = (h[base+8]&0xf8) | (ch>>>1);
        h[base+9] = (h[base+9]&0x7f) | ((ch&1)<<7); return;
      }
      const offsets = {delay:0x10, bankMSB:0x11, bankLSB:0x12, program:0x13};
      if (!(key in offsets)) throw new Error("Unknown track control.");
      const n = integer(value,0,255,key==="delay" ? "Delay" : "Bank/program");
      h[base+offsets[key]] = key === "delay" ? integer(n,0,63,"Delay") :
        (n === 255 ? 255 : integer(n,0,127,"Bank/program"));
    }
    pattern(t, slot) {
      integer(t,0,15,"Track"); integer(slot,0,63,"Pattern slot");
      const p = this.patterns[t].get(slot);
      if (!p) throw new Error("This pattern slot is empty.");
      return p;
    }
    setHarmonizer(t,index,intervals) {
      index=integer(index,0,5,"Harmonizer button");
      if (!this.track(t).isV3) throw new Error("Harmonizer editing requires V3 track settings.");
      if (!Array.isArray(intervals) || intervals.length>4) throw new Error("Use up to four intervals in addition to the root.");
      const values=intervals.map(n=>integer(n,0,15,"Chord interval")).filter(Boolean).sort((a,b)=>a-b);
      if (new Set(values).size!==values.length) throw new Error("Chord intervals must be different.");
      let word=0;for(let n=0;n<4;n++)word|=(values[n]||0)<<(12-n*4);
      put16(this.header,settingsBase(t)+0x34+index*2,word);
    }
    patternSet(index) {
      const base=0xeac+integer(index,0,15,"Pattern set")*16;
      const entries=Array.from(this.header.slice(base,base+16),b=>({slot:(b&127)===127 ? null : b&127,mute:!!(b&128)}));
      return {enabled:entries.some(e=>e.slot!==null),entries};
    }
    setPatternSet(index,entries) {
      const base=0xeac+integer(index,0,15,"Pattern set")*16;
      if (!Array.isArray(entries) || entries.length!==16) throw new Error("A pattern set needs all 16 track entries.");
      // Serialized SH bytes differ from Manager's native bitfield: mute is bit 7.
      const bytes=entries.map(e=>e.slot===null ? 255 : integer(e.slot,0,63,"Scene pattern")|(e.mute ? 128 : 0));
      this.header.set(bytes,base);
    }
    setPatternSetTrack(index,t,key,value) {
      const at=0xeac+integer(index,0,15,"Pattern set")*16+integer(t,0,15,"Track");
      if(key==="slot"){
        const old=this.header[at];
        this.header[at]=value===null ? 255 : integer(value,0,63,"Scene pattern")|((old&127)===127 ? 0 : old&128);
      }
      else if(key==="mute")this.header[at]=value ? this.header[at]|128 : this.header[at]&127;
      else throw new Error("Unknown pattern-set control.");
    }
    clearPatternSet(index) {const base=0xeac+integer(index,0,15,"Pattern set")*16;this.header.fill(255,base,base+16);}
    copyPatternSet(from,to) {
      const a=0xeac+integer(from,0,15,"Source pattern set")*16,b=0xeac+integer(to,0,15,"Destination pattern set")*16;
      if(from===to)throw new Error("Choose a different pattern set.");
      if(this.patternSet(to).enabled)throw new Error("Choose an empty destination pattern set.");
      this.header.set(this.header.slice(a,a+16),b);
    }
    recallPatternSet(index) {
      const scene=this.patternSet(index);
      if(!scene.enabled)throw new Error("This pattern set is empty.");
      for(let t=0;t<16;t++)if(scene.entries[t].slot!==null){
        integer(scene.entries[t].slot,0,63,"Scene pattern");
        if(!this.track(t).isV3)throw new Error("Recall requires V3 settings on participating tracks.");
      }
      scene.entries.forEach((e,t)=>{if(e.slot!==null){this.setTrack(t,"selectedPattern",e.slot);this.setTrack(t,"mute",e.mute);this.setTrack(t,"solo",false);}});
      return scene.entries;
    }
    addPattern(t, slot, source) {
      integer(t,0,15,"Track"); integer(slot,0,63,"Pattern slot");
      if (this.patterns[t].has(slot)) throw new Error("Choose an empty pattern slot.");
      const p = source ? Uint8Array.from(source) : blankPattern(1); validatePattern(p);
      this.patterns[t].set(slot, p);
      const base = trackBase(t);
      this.header[base+(slot>>3)] |= 0x80 >> (slot&7);
      put16(this.header, base+8+slot*2, 0xffff);
    }
    deletePattern(t, slot) {
      this.pattern(t,slot); this.patterns[t].delete(slot);
      const base = trackBase(t);
      this.header[base+(slot>>3)] &= ~(0x80 >> (slot&7));
      put16(this.header, base+8+slot*2, 0xffff);
    }
    step(t, slot, step) {
      integer(step,0,63,"Step");
      const p = this.pattern(t,slot), word = u32(p,8+step*4), mask = field(word,14,8), notes = [];
      for (let n = 0; n < 8; n++) {
        const at = 0x290+step*32+n*4;
        const offsets=Array.from({length:6},(_,i)=>i).filter(i=>p[0x110+step*6+i]&(1<<n));
        notes.push({enabled: !!(mask&(1<<n)), pitch:p[at], velocity:p[at+1], gate:u16(p,at+2),
          offset:offsets[0] || 0, offsets:offsets});
      }
      return {enabled: !!(word&0x80000000), count:field(word,28,2)+1, divide:field(word,26,2)+1,
        tie:!!(word&0x40000000),harmonizer:field(word,23,3),
        slide: !!(word&(1<<22)), notes:notes, ccMask:field(word,9,5),
        cc:Array.from(p.slice(0xa90+step*5,0xa95+step*5)),
        transpose:p[0xbd0+step*9],speedControl:p[0xbd1+step*9],roll:p[0xbd2+step*9],
        groove:Array.from(p.slice(0xbd3+step*9,0xbd9+step*9))};
    }
    setStep(t, slot, step, key, value) {
      integer(step,0,63,"Step");
      const p = this.pattern(t,slot), at = 8+step*4;
      let word = u32(p,at);
      if (key === "enabled") {
        word = replaceField(word,31,1,value ? 1 : 0);
        const bitAt = 0x108+(step>>4)*2, bit = 1<<(step&15), bitmap = u16(p,bitAt);
        put16(p,bitAt,value ? bitmap|bit : bitmap&~bit);
      } else if (key === "count" || key === "divide") {
        word = replaceField(word,key === "count" ? 28 : 26,2,integer(value,1,4,key)-1);
      } else if (key === "slide" || key === "tie") word = replaceField(word,key==="slide" ? 22 : 30,1,value ? 1 : 0);
      else if(key==="harmonizer")word=replaceField(word,23,3,integer(value,0,6,"Harmonizer"));
      else if (key === "transpose") p[0xbd0+step*9] = integer(value,0,16,"Transpose");
      else if(key==="speedControl" || key==="roll") {
        const codes=key==="roll" ? ROLLS : SPEED_CONTROL,n=integer(value,0,key==="roll" ? 21 : 9,"Automation code");
        if(!codes.some(x=>x[0]===n))throw new Error("Choose a supported automation code.");
        p[(key==="roll" ? 0xbd2 : 0xbd1)+step*9]=n;
      } else if(/^groove[0-5]$/.test(key))p[0xbd3+step*9+Number(key[6])]=integer(value,-64,63,"Groove Bend")+64;
      else throw new Error("Unknown step control.");
      put32(p,at,word);
      if (key === "enabled") rebuildTraversal(p);
    }
    setNote(t, slot, step, noteSlot, patch) {
      integer(step,0,63,"Step"); integer(noteSlot,0,7,"Note slot");
      const p = this.pattern(t,slot), at = 0x290+step*32+noteSlot*4, flagAt = 8+step*4;
      // Validate the whole edit before writing anything.
      const values = {};
      for (const key of ["pitch","velocity","gate"])
        if (key in patch) values[key] = integer(patch[key],0,key === "gate" ? 511 : 127,key[0].toUpperCase()+key.slice(1));
      if ("offset" in patch) values.offset = integer(patch.offset,0,5,"Offset");
      if (patch.enabled) {
        integer("pitch" in values ? values.pitch : p[at],0,127,"Pitch");
        integer("velocity" in values ? values.velocity : p[at+1],0,127,"Velocity");
        integer("gate" in values ? values.gate : u16(p,at+2),0,511,"Gate");
      }
      if ("pitch" in values) p[at] = values.pitch;
      if ("velocity" in values) p[at+1] = values.velocity;
      if ("gate" in values) put16(p,at+2,values.gate);
      if ("enabled" in patch) {
        let word = u32(p,flagAt), mask = field(word,14,8), bit = 1<<noteSlot;
        mask = patch.enabled ? mask|bit : mask&~bit;
        put32(p,flagAt,replaceField(word,14,8,mask));
        // Offset masks are retained for disabled notes, just like pitch/gate.
        if (patch.enabled && !Array.from(p.slice(0x110+step*6,0x116+step*6)).some(x=>x&bit)) p[0x110+step*6] |= bit;
      }
      if ("offset" in values) {
        for (let i=0;i<6;i++) p[0x110+step*6+i]&=~(1<<noteSlot);
        p[0x110+step*6+values.offset]|=1<<noteSlot;
      }
    }
    setCC(t, slot, step, lane, value, enabled) {
      integer(step,0,63,"Step"); integer(lane,0,4,"CC lane"); integer(value,0,127,"CC value");
      const p = this.pattern(t,slot), at = 8+step*4, word = u32(p,at), bit = 1<<lane;
      p[0xa90+step*5+lane] = Number(value);
      const mask = field(word,9,5);
      put32(p,at,replaceField(word,9,5,enabled ? mask|bit : mask&~bit));
    }
    clearStep(t, slot, step) {
      for (let n = 0; n < 8; n++) this.setNote(t,slot,step,n,{enabled:false});
      for (let lane = 0; lane < 5; lane++) this.setCC(t,slot,step,lane,0,false);
    }
    clearAutomation(t,slot,step) {
      integer(step,0,63,"Step");const p=this.pattern(t,slot),a=0xbd0+step*9;
      p[a]=8;p[a+1]=p[a+2]=0;p.fill(64,a+3,a+9);
    }
    copyStep(t,slot,step) {
      integer(step,0,63,"Step"); const p=this.pattern(t,slot);
      return [[8,4],[0x110,6],[0x290,32],[0xa90,5],[0xbd0,9]].map(([base,size])=>p.slice(base+step*size,base+(step+1)*size));
    }
    pasteStep(t,slot,step,data) {
      integer(step,0,63,"Step"); const p=this.pattern(t,slot), fields=[[8,4],[0x110,6],[0x290,32],[0xa90,5],[0xbd0,9]];
      if (!data || data.length!==5 || fields.some((x,i)=>data[i].length!==x[1])) throw new Error("Invalid step clipboard.");
      fields.forEach(([base,size],i)=>p.set(data[i],base+step*size));
      this.setStep(t,slot,step,"enabled",!!(u32(p,8+step*4)&0x80000000));
    }
    transferPattern(fromTrack,fromSlot,toTrack,toSlot,move) {
      if (fromTrack===toTrack && fromSlot===toSlot) throw new Error("Choose a different destination.");
      const source=this.pattern(fromTrack,fromSlot); this.addPattern(toTrack,toSlot,source);
      if (move) this.deletePattern(fromTrack,fromSlot);
    }
    setPattern(t, slot, key, value) {
      const p = this.pattern(t,slot);
      if (key === "pages") {
        p[4] = (p[4]&0xf0) | integer(value,1,4,"Pages"); rebuildTraversal(p);
      } else if (key === "direction") {
        put32(p,0xe28,integer(value,0,11,"Direction")); rebuildTraversal(p);
      } else if (key === "speed") {
        if (text(p,0,4) !== "seq3") throw new Error("Pattern speed editing requires seq3.");
        p[5] = integer(value,0,4,"Speed");
      } else if (key === "fixedLength") {
        const length=value===null ? 0 : integer(value,1,64,"Fixed length");
        p[0xe24]=length ? 1 : 0; if(length)p[0xe25]=length;
      } else if(["fixed","probability","arp","reverse","switchBack"].includes(key)) {
        p[{fixed:0xe24,probability:0xe23,arp:0xe14,reverse:0xe2c,switchBack:0xe2d}[key]]=value ? 1 : 0;
      } else if(key==="arpRate" || key==="arpStyle") {
        put32(p,key==="arpRate" ? 0xe18 : 0xe1c,integer(value,0,key==="arpRate" ? 7 : 3,key==="arpRate" ? "Arpeggiator rate" : "Arpeggiator style"));
      } else if(key==="modDepth")p[0xe12]=integer(value,-64,63,"Modulation depth")+64;
      else if(key in {fixedSteps:1,rate:1,swing:1,modShape:1,modLength:1,scale:1,key:1,arpOctaves:1,arpGate:1}) {
        const spec={fixedSteps:[0xe25,1,64,"Fixed length"],rate:[0xe22,0,100,"Probability"],swing:[0xe13,0,100,"Swing"],
          modShape:[0xe10,0,5,"Modulation shape"],modLength:[0xe11,2,64,"Modulation length"],scale:[0xe20,0,22,"Scale"],
          key:[0xe21,0,11,"Key"],arpOctaves:[0xe15,1,3,"Arpeggiator range"],arpGate:[0xe16,1,100,"Arpeggiator gate"]}[key];
        p[spec[0]]=integer(value,spec[1],spec[2],spec[3]);
      } else throw new Error("Unknown pattern control.");
    }
    effects(t,slot) {
      const p=this.pattern(t,slot);
      return {fixed:!!p[0xe24],fixedSteps:p[0xe25],probability:!!p[0xe23],rate:p[0xe22],
        swing:p[0xe13],speedMod:Array.from(p.slice(0xe10,0xe13)),
        modShape:p[0xe10],modLength:p[0xe11],modDepth:p[0xe12]-64,
        reverse:!!p[0xe2c],switchBack:!!p[0xe2d],
        scale:p[0xe20],key:p[0xe21],arp:!!p[0xe14],arpOctaves:p[0xe15],arpGate:p[0xe16],arpRate:u32(p,0xe18),arpStyle:u32(p,0xe1c)};
    }
    serialize() {
      const result = new Uint8Array((1+this.count)*PAGE); result.set(this.header);
      let page = 1;
      for (let t = 0; t < 16; t++)
        for (let slot = 0; slot < 64; slot++) {
          const p = this.patterns[t].get(slot);
          if (p) result.set(p,page++*PAGE);
        }
      return result;
    }
  }
  function noteName(pitch) {
    const names = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
    return names[pitch%12] + (Math.floor(pitch/12)-1);
  }
  return {Project:Project,PAGE:PAGE,PORTS:PORTS,TRACK_COLORS:TRACK_COLORS,DIRECTIONS:DIRECTIONS,
    DIRECTION_NAMES:DIRECTION_NAMES,SCALES,HARMONIZER_PRESETS,ARP_RATES,SPEED_CONTROL,ROLLS,blankPattern:blankPattern,rebuildTraversal:rebuildTraversal,
    TRANSPOSE:[5,7,10,12,1,2,3,4,0,-4,-3,-2,-1,-12,-10,-7,-5],
    u16:u16,u32:u32,noteName:noteName};
});
