/* Original example generated locally from editor defaults, with no bundled .prj. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./project-format.js"));
  else root.SquidExample = factory(root.SquidProject);
})(typeof globalThis !== "undefined" ? globalThis : this, function (F) {
  "use strict";
  function create() {
    const project = F.Project.create("Editor example");
    project.setTrack(0,"name","Kick");
    project.setTrack(1,"name","Snare");
    project.setTrack(8,"name","Bass");
    for (const [track,slot] of [[0,0],[0,1],[1,0],[1,8],[8,0],[8,1]]) project.addPattern(track,slot);
    for (const slot of [0,1]) {
      for (let step = 0; step < 16; step += 4)
        project.setNote(0,slot,step,0,{enabled:true,pitch:36,velocity:100,gate:3});
      for (const step of [4,12])
        project.setNote(1,slot === 0 ? 0 : 8,step,0,{enabled:true,pitch:38,velocity:92,gate:3});
      [48,55,52,57].forEach(function (pitch,index) {
        project.setNote(8,slot,index*4,0,{enabled:true,pitch:pitch+slot*12,velocity:88,gate:15});
      });
    }
    return project;
  }
  return {create};
});
