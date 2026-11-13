const $=id=>document.getElementById(id);
const S={page:"editor",step:"input",ratio:"16:9",library:[],projects:[],projectId:null,overrides:[],output:null,recordedBlob:null,recorder:null,recordChunks:[],transcript:null};
const sample="Technology is transforming the way businesses operate. Companies use data analytics to understand customer behavior and make better financial decisions. In modern cities, smart technology helps improve transportation and infrastructure. Businesses are investing in innovation to increase productivity. Nature reminds us to protect our environment and build a sustainable future.";
const stepNames=["input","scenes","style","preview","export"],pageNames={editor:"Create video",library:"Media library",projects:"My projects",settings:"Settings"};
function toast(s){$("toast").textContent=s;$("toast").classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>$("toast").classList.remove("show"),2700)}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function scenes(){return $("script").value.split(/(?<=[.!?])\s+|\n+/).map(x=>x.trim()).filter(Boolean).slice(0,30)}
function words(){return $("script").value.trim().split(/\s+/).filter(Boolean).length}
function inputMode(){return document.querySelector('input[name="input-mode"]:checked')?.value||"script"}
function syncInputMode(){const m=inputMode();$("script-mode").hidden=m!=="script";$("upload-mode").hidden=m!=="upload";$("record-mode").hidden=m!=="record";$("audio-voice-mode").hidden=m==="script";document.querySelectorAll(".input-mode").forEach(x=>x.classList.toggle("selected",x.querySelector("input").value===m));$("script").required=m==="script";summary()}
function hasValidInput(){const m=inputMode();return m==="script"?!!$("script").value.trim():m==="upload"?!!$("audio").files[0]:!!S.recordedBlob}
function time(s){s=Math.max(0,Math.round(s||0));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")}
async function api(url,opt={}){let r=await fetch(url,opt),d;try{d=await r.json()}catch{d={detail:await r.text()}}if(!r.ok){let x=d.detail||d.error||d;if(typeof x==="object")throw Error(x.error?.message||x.message||JSON.stringify(x));throw Error(x||"Request failed")}return d}
function page(p){S.page=p;document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x.id==="page-"+p));document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.page===p));$("crumb-name").textContent=pageNames[p];$("sidebar").classList.remove("open");if(p==="library")drawLibrary();if(p==="projects")loadProjects();if(p==="settings")health();window.scrollTo({top:0,behavior:"smooth"})}
async function transcribeCurrentAudio(){
 const mode=inputMode();if(mode==="script"||S.transcript)return S.transcript;
 let file=null;if(mode==="upload")file=$("audio").files[0];else if(mode==="record"&&S.recordedBlob)file=new File([S.recordedBlob],"live-recording.webm",{type:S.recordedBlob.type||"audio/webm"});
 if(!file)throw Error(mode==="upload"?"Choose an audio file first.":"Record your voice first.");
 $("scene-list").innerHTML='<div class="empty"><b>Transcribing your audio…</b><p>Speech recognition may take a minute on first use.</p></div>';
 const fd=new FormData();fd.append("audio",file);
 const r=await api("/api/v1/transcribe",{method:"POST",body:fd});S.transcript=r.transcript;$("script").value=r.transcript;updateMeta();return r.transcript;
}
function step(s){if(["scenes","style","preview","export"].includes(s)&&!hasValidInput()){toast(inputMode()==="script"?"Enter a script first.":inputMode()==="upload"?"Choose an audio file first.":"Record your voice first.");s="input"}S.step=s;document.querySelectorAll(".step").forEach(x=>x.classList.toggle("active",x.dataset.step===s));document.querySelectorAll(".step-panel").forEach(x=>x.classList.toggle("active",x.id==="step-"+s));if(s==="scenes"){if(inputMode()!=="script"&&!S.transcript){transcribeCurrentAudio().then(()=>drawScenes()).catch(e=>{$("scene-list").innerHTML=`<div class="notice"><b>!</b><span><strong>Transcription failed</strong><small>${esc(e.message)}</small></span></div>`;toast("Transcription failed: "+e.message)})}else drawScenes();}if(s==="style")syncStyle();if(s==="preview"||s==="export")summary();if(s==="preview"){refreshPreview()}if(s==="export"){$("export-name").textContent=$("project-name").value||"Untitled project";$("export-meta").textContent=`MP4 · ${S.ratio} · Captions ${$("captions-style").checked?"enabled":"off"}`}window.scrollTo({top:0,behavior:"smooth"})}
function setRatio(r){S.ratio=r;document.querySelectorAll("[data-ratio]").forEach(x=>x.classList.toggle("selected",x.dataset.ratio===r));$("ratio-tag").textContent=r==="16:9"?"16:9 LANDSCAPE":r==="9:16"?"9:16 PORTRAIT":"1:1 SQUARE";$("preview").className="preview ratio-"+r.replace(":","-");summary()}
function guess(t){t=t.toLowerCase();const R={Technology:"technology software computer laptop digital ai data internet robot innovation",Finance:"finance financial money stock market investment bank payment profit budget economy",Business:"business company companies team meeting office work employee customer productivity management",City:"city urban traffic transport road building infrastructure street",Nature:"nature environment green forest waterfall river mountain climate sustainable wildlife ecosystem"};let best="General",n=0;for(const [k,v] of Object.entries(R)){let score=v.split(" ").filter(w=>t.includes(w)).length;if(score>n){n=score;best=k}}return best}
function updateMeta(){$("word-count").textContent=words()+" words";$("estimate").textContent="~"+time(words()/2.5);summary()}
function summary(){$("summary-name").textContent=$("project-name").value||"Untitled project";$("summary-scenes").textContent=scenes().length;$("summary-clips").textContent=S.library.length;$("summary-ratio").textContent=S.ratio;$("summary-captions").textContent=$("captions-style").checked?"On":"Off";$("summary-audio").textContent=inputMode()==="script"?"AI narration":inputMode()==="upload"?"Uploaded audio":"Live recording";$("export-name").textContent=$("project-name").value||"Untitled project";$("export-meta").textContent=`MP4 · ${S.ratio} · Captions ${$("captions-style").checked?"enabled":"off"}`}
async function loadLibrary(){try{S.library=await api("/api/v1/library");$("clip-count").textContent=S.library.length;$("mini-count").textContent=S.library.length;drawLibrary();if(S.step==="scenes")drawScenes()}catch(e){$("library-grid").innerHTML=`<div class="empty">Media library error: ${esc(e.message)}</div>`}}
function drawLibrary(){if(!$('library-grid'))return;let q=($('search').value||'').toLowerCase(),f=$('filter').value;let arr=S.library.filter(c=>(f==='all'||c.category===f)&&(`${c.title||''} ${c.name||''} ${c.description||''} ${(c.tags||[]).join(' ')} ${(c.keywords||[]).join(' ')} ${(c.visual_elements||[]).join(' ')} ${(c.mood||[]).join(' ')} ${c.category} ${c.relative_path}`).toLowerCase().includes(q));$('library-count').textContent=`${arr.length} of ${S.library.length} clips`;
if(!arr.length){$('library-grid').innerHTML='<div class="empty">No clips match. Add a video or change your search.</div>';return}
$('library-grid').innerHTML=arr.map(c=>`<article class="media-card"><div class="thumb"><span>${esc(c.category)}</span>▶<small>${c.duration?time(c.duration):'Video'}</small></div><div class="media-info"><strong title="${esc(c.title||c.name)}">${esc(c.title||c.name)}</strong><p>${esc(c.description||'No description')}<br>${esc(c.relative_path||'')} · ${c.size_bytes?Math.round(c.size_bytes/1048576)+' MB':'size unknown'}</p><div class="media-tags">${(c.tags||[]).slice(0,5).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div><small class="license-note">License: ${esc(c.license_status||'needs_verification')}</small><button class="btn quiet" data-use="${esc(c.id)}">Use in scene ↗</button></div></article>`).join('');$('library-grid').querySelectorAll('[data-use]').forEach(b=>b.onclick=()=>{S.pending=b.dataset.use;page('editor');step('scenes');toast('Clip selected as the preferred option for scene 1.')})}
function mediaUrl(c){return "/media/"+String(c.relative_path||"").split("/").map(encodeURIComponent).join("/")}
function drawScenes(){let ss=scenes();if(!ss.length){$('scene-list').innerHTML='<div class="empty">Add a script in Input first.</div>';return}if(!S.library.length){$('scene-list').innerHTML='<div class="notice"><b>!</b><span><strong>No clips indexed</strong><small>Add videos using the Media Library form, then refresh media.</small></span></div>';return}
const rank=(s)=>{let t=s.toLowerCase().match(/[a-z0-9]+/g)||[];let cat=guess(s);return S.library.map(c=>{let text=`${c.title||''} ${c.description||''} ${(c.tags||[]).join(' ')} ${(c.keywords||[]).join(' ')} ${(c.visual_elements||[]).join(' ')} ${(c.mood||[]).join(' ')} ${c.category}`.toLowerCase();let score=t.reduce((n,w)=>n+(w.length>2&&text.includes(w)?1:0),0);if(c.category===cat)score+=2;return {c,score}}).sort((a,b)=>b.score-a.score).map(x=>x.c)};
let previous=null;$('scene-list').innerHTML=ss.map((s,i)=>{let candidate=rank(s),selected=S.overrides[i]||candidate.find(c=>c.id!==previous)?.id||candidate[0]?.id||'',c=S.library.find(x=>x.id===selected);if(c)previous=c.id;return `<article class="scene"><div class="scene-num">${String(i+1).padStart(2,'0')}</div><div class="scene-text"><strong>${esc(s)}</strong><p>Scene ${i+1} · Metadata-based suggestion</p><span class="tag">${esc(guess(s))}</span><span class="tag green">${S.overrides[i]?'Manual selection':'Suggested match'}</span><p class="hint">${esc(c?.description||'')}</p></div><div class="scene-clip"><label>SELECT B-ROLL CLIP</label><select data-scene="${i}">${candidate.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.title||x.name)} · ${esc(x.category)}</option>`).join('')}</select>${c?`<div class="clip-player"><video controls muted playsinline preload="metadata" src="${mediaUrl(c)}"></video><div><b>${esc(c.title||c.name)}</b><small>${esc(c.category)} · ${c.duration?time(c.duration):'duration unknown'}</small><small>${esc((c.tags||[]).slice(0,6).join(', '))}</small></div></div>`:''}<small>${esc(c?.license_status||'')}</small></div></article>`}).join('');$('scene-list').querySelectorAll('[data-scene]').forEach(sel=>sel.onchange=e=>{S.overrides[+e.target.dataset.scene]=e.target.value;drawScenes();toast('Scene selection updated.')});if(S.pending){const i=S.library.findIndex(c=>c.id===S.pending);if(i>=0){S.overrides[0]=S.pending;S.pending=null;drawScenes()}}}
function effects(){return {shadow:$("effect-shadow").checked,outline:$("effect-outline").checked,box:$("effect-box").checked,bold:$("effect-bold").checked,italic:$("effect-italic").checked,glow:$("effect-glow").checked}}
function syncStyle(){S.output=null;let font=$("font").value,size=+$("font-size").value,color=$("caption-color").value||"#ffffff",ef=effects();$("font-size-label").textContent=size;for(let id of ["style-caption","caption-sample"]){let el=$(id);el.style.fontFamily=font;el.style.fontSize=(id==="style-caption"?Math.max(12,size*.7):Math.max(10,size*.45))+"px";el.style.color=color;el.style.fontWeight=ef.bold?"700":"400";el.style.fontStyle=ef.italic?"italic":"normal";el.style.textShadow=ef.glow?`0 0 9px ${color}, 0 0 18px ${color}`:ef.shadow?"1px 2px 3px #000":"none";el.style.webkitTextStroke=ef.outline?"1px #05070c":"0 transparent";el.style.background=ef.box?"#000b":"transparent";el.style.padding=ef.box?"7px 12px":"0";el.style.borderRadius=ef.box?"5px":"0"}$("captions").checked=$("captions-style").checked;summary()}
async function saveProject(show=true){let payload={id:S.projectId,name:$("project-name").value||"Untitled project",script:$("script").value,ratio:S.ratio,captions:$("captions-style").checked,font:$("font").value,font_size:+$("font-size").value,caption_color:$("caption-color").value,caption_effects:effects(),scene_overrides:S.overrides};try{let p=await api("/api/v1/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});S.projectId=p.id;if(show)toast("Project saved.");$("save-top").textContent="Saved ✓";setTimeout(()=>$("save-top").textContent="Save project",1500);return p}catch(e){if(show)toast("Save failed: "+e.message)}}
async function loadProjects(){try{S.projects=await api("/api/v1/projects")}catch{S.projects=[]}let grid=$("projects-grid");if(!S.projects.length){grid.innerHTML='<div class="empty">No saved projects yet. Start a video and press Save project.</div>';return}grid.innerHTML=S.projects.map(p=>`<article class="project-card"><div class="project-art">✦</div><div class="project-info"><h3>${esc(p.name)}</h3><p>${esc((p.script||"No script yet").slice(0,100))}</p><div class="project-actions"><button class="btn primary" data-open="${esc(p.id)}">Open</button><button class="btn quiet" data-delete="${esc(p.id)}">Delete</button></div></div></article>`).join("");grid.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openProject(b.dataset.open));grid.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>deleteProject(b.dataset.delete))}
async function openProject(id){let p=S.projects.find(x=>x.id===id);if(!p)return;S.projectId=p.id;$("project-name").value=p.name;$("script").value=p.script||"";S.overrides=p.scene_overrides||[];setRatio(p.ratio||"16:9");$("captions").checked=$("captions-style").checked=p.captions!==false;$("font").value=p.font||"Arial";$("font-size").value=p.font_size||26;$("caption-color").value=p.caption_color||"#ffffff";updateMeta();syncStyle();page("editor");step("input");toast("Project opened.")}
async function deleteProject(id){if(!confirm("Delete this saved project?"))return;try{await api("/api/v1/projects/"+encodeURIComponent(id),{method:"DELETE"});loadProjects();toast("Project deleted.")}catch(e){toast(e.message)}}
function newProject(){S.projectId=null;S.overrides=[];S.output=null;S.transcript=null;document.querySelector('input[name="input-mode"][value="script"]').checked=true;syncInputMode();$("project-name").value="Untitled project";$("script").value="";$("audio").value="";S.recordedBlob=null;$("recorded-audio").hidden=true;$("record-status").textContent="Microphone is ready when you are.";$("downloads").innerHTML="";$("preview").innerHTML='<div class="empty-preview"><span>▶</span><b>Your story starts here</b><p>Your rendered video will appear in this canvas.</p><small>PREVIEW READY</small></div>';updateMeta();page("editor");step("input")}
async function health(){try{let h=await api("/api/v1/health");$("health-dot").classList.toggle("bad",!h.ffmpeg||!h.ffprobe);$("health-text").textContent=h.ffmpeg&&h.ffprobe?"Render engine ready":"FFmpeg setup needed";$("footer-status").textContent=h.ffmpeg&&h.ffprobe?"FFmpeg ready":"FFmpeg missing";$("engine-status").innerHTML=[["API server",true,"Connected"],["FFmpeg",h.ffmpeg,h.ffmpeg?"Installed":"Not found"],["FFprobe",h.ffprobe,h.ffprobe?"Installed":"Not found"],["B-roll library",h.clip_count>0,h.clip_count+" clips indexed"]].map(x=>`<div class="engine-row"><i class="${x[1]?"":"bad"}"></i><b>${x[0]}</b><span>${x[2]}</span></div>`).join("")}catch(e){$("health-dot").classList.add("bad");$("health-text").textContent="API unavailable";$("engine-status").textContent="Backend unavailable: "+e.message}}
function refreshPreview() {
    const makePreview = (videoHtml, captionText = "", rendered = false) => {
        const showCaption =
            !rendered &&
            $("captions-style").checked &&
            !!captionText;

        const color = $("caption-color").value || "#ffffff";
        const size = Math.min(+$("font-size").value || 26, 48);
        const font = $("font").value || "Arial";
        const ef = effects();

        const caption = showCaption
            ? `<div class="draft-caption-overlay" style="
                position:absolute;
                left:5%;
                right:5%;
                bottom:7%;
                z-index:9999;
                text-align:center;
                pointer-events:none;
                font-family:${esc(font)};
                font-size:clamp(12px, ${size}px, 5vw);
                font-weight:${ef.bold ? 700 : 400};
                font-style:${ef.italic ? "italic" : "normal"};
                line-height:1.3;
                color:${esc(color)};
                text-shadow:${
                    ef.glow
                        ? `0 0 9px ${color}, 0 0 18px ${color}`
                        : ef.shadow
                        ? "1px 2px 4px #000"
                        : "none"
                };
                -webkit-text-stroke:${
                    ef.outline ? "1px #05070c" : "0 transparent"
                };
            ">
                <span style="
                    display:inline-block;
                    max-width:100%;
                    padding:${ef.box ? "7px 12px" : "2px 4px"};
                    border-radius:${ef.box ? "5px" : "0"};
                    background:${ef.box ? "#000b" : "transparent"};
                    overflow-wrap:anywhere;
                ">${esc(captionText)}</span>
            </div>`
            : "";

        return `<div style="
            position:relative;
            isolation:isolate;
            width:100%;
            height:100%;
            min-height:180px;
            overflow:hidden;
            background:#05070b;
        ">${videoHtml}${caption}</div>`;
    };

    // After export, show the actual rendered video without an extra overlay.
    if (S.output?.video_url) {
        const video = `<video controls playsinline
            src="${S.output.video_url}"
            style="width:100%;height:100%;object-fit:contain">
        </video>`;

        $("review-preview").innerHTML = makePreview(video, "", true);
        $("preview").innerHTML = makePreview(video, "", true);
        return;
    }

    const ss = scenes();

    if (!S.library.length || !ss.length) {
        const empty = `<div class="empty-preview">
            <span>▶</span>
            <b>Add a script and media to preview</b>
            <p>Your selected B-roll will appear here before export.</p>
        </div>`;

        $("review-preview").innerHTML = empty;
        $("preview").innerHTML = empty;
        return;
    }

    const sceneIndex = 0;
    const category = guess(ss[sceneIndex]);

    const candidates = [
        ...S.library.filter(c => c.category === category),
        ...S.library.filter(c => c.category !== category)
    ];

    const clip =
        S.library.find(c => c.id === S.overrides[sceneIndex]) ||
        candidates[0];

    if (!clip) return;

    const video = `<video controls muted playsinline
        preload="metadata"
        style="width:100%;height:100%;object-fit:contain;display:block"
        src="${mediaUrl(clip)}">
    </video>`;

    const markup = makePreview(video, ss[sceneIndex]);

    $("review-preview").innerHTML = markup;
    $("preview").innerHTML = markup;
    $("preview-time").textContent = "Draft preview · Scene 1";
    $("review-open").disabled = true;
    $("open-video").disabled = true;
}
async function renderVideo(){
 const mode=inputMode();
 if(!hasValidInput()){toast(mode==="script"?"Enter a script first.":mode==="upload"?"Choose an audio file first.":"Record your voice first.");step("input");return}
 if(!S.library.length){toast("No B-roll clips found. Add dataset files first.");page("library");return}
 syncStyle();await saveProject(false);
 $("render-final").disabled=true;$("generate-preview").disabled=true;$("render-review").disabled=true;
 $("render-final").textContent="Rendering…";$("export-status").className="status";$("export-status").textContent=mode==="script"?"Generating narration and rendering video…":"Transcribing audio and rendering video…";
 $("progress-wrap").hidden=false;$("progress-label").textContent=mode==="script"?"Generating voice and captions":"Transcribing speech and rendering";$("progress-number").textContent="Working";$("progress-bar").style.width="12%";$("downloads").innerHTML="";
 $("review-preview").innerHTML='<div class="empty-preview"><span>◌</span><b>Preparing your video…</b><p>Transcription, narration and rendering may take a few minutes.</p></div>';
 try{
  const d=new FormData();d.append("input_mode",mode);d.append("script",mode==="script"?$("script").value.trim():"");
  d.append("audio_voice_mode",mode==="script"?"original":$("audio-voice").value);d.append("transcript_text",mode==="script"?"":(S.transcript||""));
  d.append("ratio",S.ratio);d.append("captions",$("captions-style").checked?"on":"off");
  d.append("font",$("font").value);d.append("font_size",$("font-size").value);d.append("caption_color",$("caption-color").value);
  d.append("caption_effects",JSON.stringify(effects()));d.append("voice",$("voice").value);d.append("scene_overrides",JSON.stringify(S.overrides));
  if(mode==="upload")d.append("audio",$("audio").files[0]);
  if(mode==="record")d.append("audio",new File([S.recordedBlob],"live-recording.webm",{type:S.recordedBlob.type||"audio/webm"}));
  $("progress-bar").style.width="35%";
  const r=await api("/api/v1/generate",{method:"POST",body:d});S.output=r;
  if(r.transcript){$("script").value=r.transcript;updateMeta()}
  $("progress-bar").style.width="100%";$("progress-number").textContent="100%";$("progress-label").textContent="Render complete";
  $("export-status").className="status success";$("export-status").textContent="Video generated successfully. Play the preview to hear the narration and verify captions.";
  const items=[["Download final video (MP4)",r.video_url],["Download captions (SRT)",r.captions_url],["Download transcript (TXT)",`/outputs/${r.job_id}/transcript.txt`],["Download timeline (JSON)",r.timeline_url],["Download manifest (JSON)",r.manifest_url]];
  $("downloads").innerHTML=items.map(x=>`<a href="${x[1]}" download>↓ &nbsp; ${x[0]} <span style="margin-left:auto">↗</span></a>`).join("");
  const v=`<video controls playsinline preload="metadata" src="${r.video_url}?v=${Date.now()}" style="width:100%;height:100%;object-fit:contain;background:#05070b"></video>`;
  $("preview").innerHTML=v;$("review-preview").innerHTML=v;
  $("open-video").disabled=false;$("open-video").onclick=()=>window.open(r.video_url,"_blank");
  $("review-open").disabled=false;$("review-open").onclick=()=>window.open(r.video_url,"_blank");
  $("preview-time").textContent="Rendered video · Audio included";
  $("caption-sample").textContent=$("captions-style").checked?"Captions burned into video":"Captions disabled in video; SRT exported separately";
  toast("Render completed.");loadProjects();
 }catch(e){
  $("export-status").className="status error";$("export-status").textContent="Render failed: "+e.message;$("progress-label").textContent="Render failed";$("progress-number").textContent="Error";$("progress-bar").style.width="0";
  $("review-preview").innerHTML=`<div class="empty-preview"><span>!</span><b>Could not render preview</b><p>${esc(e.message)}</p></div>`;toast("Render failed. See the error message.");
 }finally{$("render-final").disabled=false;$("generate-preview").disabled=false;$("render-review").disabled=false;$("render-final").textContent="✦ Render final video"}
}
function bind() {
    const mediaForm = $("media-form");

    if (mediaForm) {
        mediaForm.onsubmit = async e => {
            e.preventDefault();

            const status = $("media-form-status");
            const btn = $("media-add-submit");

            if (!mediaForm.reportValidity()) return;

            btn.disabled = true;
            btn.textContent = "Adding video…";
            status.textContent = "Uploading video and saving metadata…";

            try {
                const fd = new FormData(mediaForm);
                const result = await api("/api/v1/library", {
                    method: "POST",
                    body: fd
                });

                await loadLibrary();
                mediaForm.reset();

                status.textContent =
                    `Added ${result.title || result.filename}. Technical metadata extracted.`;

                toast("Video and metadata added to the library.");
            } catch (err) {
                status.textContent = "Could not add video: " + err.message;
                toast("Upload failed: " + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = "Add to media library ↗";
            }
        };
    }

    // Input mode selection
    document.querySelectorAll('input[name="input-mode"]').forEach(x => {
        x.onchange = () => {
            S.output = null;
            S.transcript = null;
            syncInputMode();
            refreshPreview();
        };
    });

    // Navigation
    document.querySelectorAll("[data-page]").forEach(b => {
        b.onclick = e => {
            e.preventDefault();
            page(b.dataset.page);
        };
    });

    document.querySelectorAll("[data-step]").forEach(b => {
        b.onclick = () => step(b.dataset.step);
    });

    document.querySelectorAll("[data-next]").forEach(b => {
        b.onclick = () => step(b.dataset.next);
    });

    document.querySelectorAll("[data-prev]").forEach(b => {
        b.onclick = () => step(b.dataset.prev);
    });

    // Aspect ratio selection
    document.querySelectorAll("[data-ratio]").forEach(b => {
        b.onclick = () => setRatio(b.dataset.ratio);
    });

    // Script input
    $("script").oninput = () => {
        S.output = null;

        if (inputMode() === "script") {
            S.transcript = null;
        }

        updateMeta();
        refreshPreview();
    };

    // Audio upload
    $("audio").onchange = () => {
        S.output = null;
        S.transcript = null;
        S.recordedBlob = null;

        if ($("audio").files[0]) {
            document.querySelector(
                'input[name="input-mode"][value="upload"]'
            ).checked = true;

            syncInputMode();
        }

        summary();
        refreshPreview();
    };

    // Start audio recording
    $("record-start").onclick = async () => {
        try {
            if (
                !navigator.mediaDevices?.getUserMedia ||
                !window.MediaRecorder
            ) {
                throw Error(
                    "Live recording is not supported in this browser. " +
                    "Try Chrome or Edge, or upload an audio file."
                );
            }

            document.querySelector(
                'input[name="input-mode"][value="record"]'
            ).checked = true;

            syncInputMode();

            const stream =
                await navigator.mediaDevices.getUserMedia({ audio: true });

            S.recordChunks = [];
            S.transcript = null;

            S.recorder = new MediaRecorder(stream);

            S.recorder.ondataavailable = e => {
                if (e.data.size) {
                    S.recordChunks.push(e.data);
                }
            };

            S.recorder.onstop = () => {
                S.recordedBlob = new Blob(S.recordChunks, {
                    type: S.recorder.mimeType || "audio/webm"
                });

                S.transcript = null;

                $("recorded-audio").src =
                    URL.createObjectURL(S.recordedBlob);

                $("recorded-audio").hidden = false;

                $("record-status").textContent =
                    "Recording ready. Transcript will be generated automatically.";

                stream.getTracks().forEach(t => t.stop());

                $("audio").value = "";

                S.output = null;

                document.querySelector(
                    'input[name="input-mode"][value="record"]'
                ).checked = true;

                syncInputMode();
                summary();
                refreshPreview();
            };

            S.recorder.start();

            $("record-start").disabled = true;
            $("record-stop").disabled = false;

            $("record-status").textContent =
                "Recording… speak clearly, then press Stop.";
        } catch (e) {
            toast(e.message);
            $("record-status").textContent = e.message;
        }
    };

    // Stop audio recording
    $("record-stop").onclick = () => {
        if (S.recorder && S.recorder.state !== "inactive") {
            S.recorder.stop();

            $("record-start").disabled = false;
            $("record-stop").disabled = true;
        }
    };

    // Insert sample script
    $("sample").onclick = () => {
        document.querySelector(
            'input[name="input-mode"][value="script"]'
        ).checked = true;

        syncInputMode();
        $("script").value = sample;

        updateMeta();
        refreshPreview();

        toast("Sample script inserted.");
    };

    // Caption font
    $("font").onchange = () => {
        syncStyle();
        refreshPreview();
    };

    // Caption font size
    $("font-size").oninput = () => {
        syncStyle();
        refreshPreview();
    };

    // Caption text color
    $("caption-color").oninput = () => {
        syncStyle();
        refreshPreview();
    };

    // Preset caption colors
    document.querySelectorAll("[data-color]").forEach(b => {
        b.onclick = () => {
            $("caption-color").value = b.dataset.color;

            syncStyle();
            refreshPreview();
        };
    });

    // Caption effects
    [
        "effect-shadow",
        "effect-outline",
        "effect-box",
        "effect-bold",
        "effect-italic",
        "effect-glow"
    ].forEach(id => {
        const control = $(id);

        if (control) {
            control.onchange = () => {
                syncStyle();
                refreshPreview();
            };
        }
    });

    // Main captions toggle
    $("captions").onchange = () => {
        $("captions-style").checked = $("captions").checked;

        summary();
        refreshPreview();
    };

    // Caption style panel toggle
    $("captions-style").onchange = () => {
        $("captions").checked = $("captions-style").checked;

        summary();
        refreshPreview();
    };

    // Save project
    $("save-top").onclick = () => saveProject();
    $("save-bottom").onclick = () => saveProject();

    // Render video
    $("render-final").onclick = renderVideo;
    $("generate-preview").onclick = renderVideo;

    $("render-review").onclick = () => {
        step("export");
        renderVideo();
    };

    // Refresh media library and scene suggestions
    const refreshMedia = async () => {
        await loadLibrary();
        drawScenes();
        refreshPreview();
        toast("Media refreshed.");
    };

    $("refresh-library").onclick = refreshMedia;
    $("refresh-scenes").onclick = refreshMedia;

    // Search and category filter
    $("search").oninput = drawLibrary;
    $("filter").onchange = drawLibrary;

    // Project controls
    $("new-project").onclick = newProject;
    $("check-health").onclick = health;

    $("menu").onclick = () => {
        $("sidebar").classList.toggle("open");
    };

    // Default caption size
    $("default-size").oninput = () => {
        $("default-size-label").textContent = $("default-size").value;
    };

    // Save preferences
    $("save-settings").onclick = () => {
        const p = {
            ratio: $("default-ratio").value,
            font: $("default-font").value,
            size: $("default-size").value,
            captions: $("default-captions").checked
        };

        localStorage.setItem("incubrix-prefs", JSON.stringify(p));

        setRatio(p.ratio);

        $("font").value = p.font;
        $("font-size").value = p.size;

        $("captions").checked = p.captions;
        $("captions-style").checked = p.captions;

        syncStyle();
        refreshPreview();

        $("settings-saved").textContent = "Saved";

        toast("Preferences saved.");
    };
}
async function init(){bind();syncInputMode();let p=JSON.parse(localStorage.getItem("incubrix-prefs")||"{}");if(p.ratio)setRatio(p.ratio);if(p.font)$("font").value=p.font;if(p.size)$("font-size").value=p.size;if(p.captions!==undefined)$("captions").checked=$("captions-style").checked=p.captions;$("default-ratio").value=p.ratio||"16:9";$("default-font").value=p.font||"Arial";$("default-size").value=p.size||26;$("default-size-label").textContent=p.size||26;$("default-captions").checked=p.captions!==false;syncStyle();updateMeta();await Promise.all([loadLibrary(),health(),loadProjects()])}
init();
