from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from datetime import datetime, timezone
import asyncio, json, re, shutil, subprocess, uuid, os, time, logging, math

BASE=Path(__file__).resolve().parent.parent
STATIC=Path(__file__).resolve().parent/"static"
DATA=BASE/"data"/"stock_clips"; OUT=BASE/"outputs"; PROJECTS=BASE/"projects"; MEDIA_JSON=BASE/"data"/"media_library.json"
DATA.mkdir(parents=True,exist_ok=True); OUT.mkdir(exist_ok=True); PROJECTS.mkdir(exist_ok=True)
EXTS={".mp4",".mov",".mkv",".webm"}
logging.basicConfig(level=os.getenv("LOG_LEVEL","INFO"))
ASR_MODEL=os.getenv("ASR_MODEL","small")
app=FastAPI(title="Incubrix Pro",version="2.0.0")
app.mount("/static",StaticFiles(directory=STATIC),name="static")
app.mount("/media",StaticFiles(directory=DATA),name="media")

def run(args):
    p=subprocess.run(args,capture_output=True,text=True)
    if p.returncode: raise RuntimeError((p.stderr or p.stdout or "Command failed")[-1800:])
    return p.stdout
CATEGORY_RULES={
    "Technology": "technology software computer laptop digital ai data internet robot cyber innovation online virtual reality vr",
    "Finance": "finance financial money stock market investment bank payment profit budget economy investor risk bills calculator expenses trading",
    "Business": "business company companies team meeting office work employee customer productivity management corporate handshake partnership",
    "City": "city urban traffic transport road building infrastructure drainage street skyline aerial times square vehicles",
    "Nature": "nature environment green forest waterfall river mountain climate sustainable wildlife plant earth ecosystem trees water",
}
STOP_WORDS={"the","a","an","and","or","to","of","in","on","for","is","are","with","as","by","this","that","it","be","from","while","into","their","we","our","you","your","they","them","was","were","will","can","could","would","should","at","about","than","then","also","through","one","all","has","have","had","its","not","but","both","very","more","most"}
SYNONYMS={
 "forest":{"woods","trees","woodland","greenery","vegetation","wildlife","nature"},"woods":{"forest","trees","woodland"},
 "waterfall":{"water","river","flowing","stream","nature"},"river":{"water","flowing","stream","waterfall"},
 "city":{"urban","buildings","street","traffic","skyline"},"urban":{"city","street","buildings","infrastructure"},
 "traffic":{"vehicles","cars","road","transport","street"},"vehicles":{"traffic","cars","transport","road"},
 "finance":{"money","financial","investment","budget","stocks","market"},"money":{"finance","financial","cash","bills","budget"},
 "stock":{"market","trading","investment","finance","charts"},"market":{"stock","trading","investment","finance"},
 "business":{"company","office","team","meeting","professional","work"},"meeting":{"business","team","discussion","collaboration","office"},
 "office":{"business","workplace","company","employees","meeting"},"handshake":{"partnership","agreement","deal","trust","business"},
 "technology":{"digital","computer","software","innovation","ai","laptop"},"laptop":{"computer","typing","keyboard","technology","software"},
 "vr":{"virtual","reality","headset","immersive","technology"},"computer":{"technology","laptop","software","digital"},
 "night":{"dark","lights","evening","illuminated"},"day":{"daytime","sunny","bright"},
 "calm":{"peaceful","relaxing","serene","quiet"},"peaceful":{"calm","relaxing","serene","nature"},
}
def words(text):
    return {w for w in re.findall(r"[a-z0-9]+",str(text or "").lower()) if len(w)>2 and w not in STOP_WORDS}
def expanded_words(text):
    base=words(text); expanded=set(base)
    for w in list(base): expanded.update(SYNONYMS.get(w,set()))
    return expanded
def category(text):
    t=expanded_words(text); scores={k:len(t & set(v.split())) for k,v in CATEGORY_RULES.items()}
    best=max(scores,key=scores.get)
    return best if scores[best] else "General"
def read_metadata():
    try:
        data=json.loads(MEDIA_JSON.read_text(encoding="utf-8"))
        if isinstance(data,dict) and isinstance(data.get("videos"),list): return data
    except Exception: pass
    return {"version":"1.0","videos":[]}
def write_metadata(data):
    MEDIA_JSON.parent.mkdir(parents=True,exist_ok=True)
    tmp=MEDIA_JSON.with_suffix('.json.tmp'); tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8'); tmp.replace(MEDIA_JSON)
def _split_csv(value):
    if isinstance(value,list): return [str(x).strip() for x in value if str(x).strip()]
    return [x.strip() for x in str(value or '').replace(';',',').split(',') if x.strip()]
def _probe(p):
    info={"duration":None,"width":None,"height":None,"fps":None,"video_codec":None,"audio_codec":None}
    if not shutil.which('ffprobe'): return info
    try:
        raw=run(["ffprobe","-v","error","-show_entries","format=duration:stream=codec_type,codec_name,width,height,r_frame_rate","-of","json",str(p)])
        d=json.loads(raw); info['duration']=round(float(d.get('format',{}).get('duration',0)),2) or None
        for stream in d.get('streams',[]):
            if stream.get('codec_type')=='video':
                info['width']=stream.get('width'); info['height']=stream.get('height'); info['video_codec']=stream.get('codec_name')
                fr=stream.get('r_frame_rate','0/1').split('/')
                try: info['fps']=round(float(fr[0])/float(fr[1]),3) if float(fr[1]) else None
                except Exception: pass
            elif stream.get('codec_type')=='audio': info['audio_codec']=stream.get('codec_name')
    except Exception: pass
    return info
def _default_metadata(p, rel, folder, probe):
    stem=p.stem.replace('_',' ').replace('-',' '); cat=folder.title() if folder.lower() in {x.lower() for x in CATEGORY_RULES} else category(stem)
    title=stem.title()
    tags=words(stem+' '+cat)
    return {"id":str(rel).replace('\\','/'),"filename":p.name,"path":"data/stock_clips/"+str(rel).replace('\\','/'),"category":cat,
      "title":title,"description":"Please verify this description against the actual video content.","tags":sorted(tags),"keywords":sorted(tags),"visual_elements":[],"mood":[],
      "source":"Unknown","creator":"Unknown","license_status":"needs_verification","license_name":"Unknown","attribution_required":"verify","attribution_text":"",
      "rights_notes":"Confirm commercial-use rights before production use.","usage_restrictions":"Unverified; do not assume commercial rights.","language":"","location":"","date_recorded":"","ai_generated":False,"notes":"Metadata inferred from filename; verify against footage.","enabled":True,"metadata_verified":False,
      "technical":probe,"size_bytes":p.stat().st_size}
def library():
    out=[]
    if not DATA.exists(): return out
    catalog=read_metadata(); by_path={str(x.get('path','')).replace('\\','/').removeprefix('data/stock_clips/'):x for x in catalog['videos'] if x.get('path')}
    by_filename={x.get('filename'):x for x in catalog['videos'] if x.get('filename')}
    for p in DATA.rglob('*'):
        if p.suffix.lower() not in EXTS or 'watermarked_preview' in p.name.lower(): continue
        rel=p.relative_to(DATA); rels=str(rel).replace('\\','/'); folder=rel.parts[0] if len(rel.parts)>1 else ''
        probe=_probe(p); meta=by_path.get(rels) or by_filename.get(p.name) or _default_metadata(p,rel,folder,probe)
        # Files on disk are authoritative for path and technical properties.
        meta=dict(meta); meta.update({"id":rels,"filename":p.name,"path":str(p.resolve()),"relative_path":rels,"size_bytes":p.stat().st_size,
            "duration":probe.get('duration'),"technical":probe,"source":meta.get('source') or 'Unknown',"license_status":meta.get('license_status') or 'needs_verification'})
        if not meta.get('enabled',True): continue
        searchable=' '.join(str(meta.get(k,'')) for k in ['title','description','category','filename','tags','keywords','visual_elements','mood','notes'])
        meta['tokens']=expanded_words(searchable)
        out.append(meta)
    return out
def public_library():
    result=[]
    for x in library():
        result.append({k:v for k,v in x.items() if k not in {'path','tokens'}})
    return result
def split(script):
    a=[s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+",script.strip()) if s.strip()]
    return a[:30]
def _score_clip(scene,c):
    st=words(scene); expanded=expanded_words(scene); meta_tokens=c.get('tokens',set())
    title=expanded_words(c.get('title','')); desc=expanded_words(c.get('description',''))
    tags=expanded_words(' '.join(map(str,c.get('tags',[]))))
    visual=expanded_words(' '.join(map(str,c.get('visual_elements',[]))))
    keywords=expanded_words(' '.join(map(str,c.get('keywords',[]))))
    cat=category(scene); score=0.0
    score += 3.0*len(st & title) + 2.2*len(st & tags) + 2.0*len(st & visual) + 1.8*len(st & keywords) + 1.0*len(st & desc)
    score += 0.65*len((expanded-st) & meta_tokens)
    if cat!='General' and c.get('category','').lower()==cat.lower(): score += 2.5
    # Avoid category-only matches being mistaken for strong relevance.
    union=max(1,len(st | meta_tokens)); normalized=score/(len(st)**0.55 * union**0.20)
    return normalized,cat

def choose(scene,lib,used=None,previous_id=None):
    if used is None: used=set()
    if not lib:return None,0,category(scene),"No footage available"
    ranked=[]
    for c in lib:
        score,cat=_score_clip(scene,c)
        if c['id'] in used: score-=0.22
        if c['id']==previous_id: score-=1000
        ranked.append((score,c,cat))
    ranked.sort(key=lambda x:x[0],reverse=True)
    score,c,cat=ranked[0]
    # When possible, prefer any alternative to the immediately previous clip.
    if c['id']==previous_id and len(ranked)>1:
        alt=next((x for x in ranked if x[1]['id']!=previous_id),None)
        if alt: score,c,cat=alt
    confidence=max(0.0,min(1.0,score/10.0))
    reason=f"Metadata relevance score; title, description, tags, visual elements and category considered (topic: {cat})"
    if confidence<0.12: reason += "; low-confidence match—review recommended"
    return c,round(confidence,3),cat,reason

def duration(p):
    return max(.1,float(run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",str(p)]).strip()))
def stamp(sec):
    ms=round(sec*1000); h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); s,ms=divmod(ms,1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"
def wrap_caption(text):
    lines=[]; line=""
    for w in text.split():
        if line and len(line)+len(w)+1>38: lines.append(line); line=w
        else: line=(line+" "+w).strip()
    if line:lines.append(line)
    return r"\N".join(lines[:2])
async def tts(text,path,voice):
    import edge_tts
    await edge_tts.Communicate(text,voice=voice).save(str(path))
def render(folder,script,audio,ratio,burn,font,size,color,overrides,effects):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"): raise RuntimeError("FFmpeg and FFprobe must be installed and available in PATH.")
    lib=library()
    if not lib: raise RuntimeError(f"No clips found. Add videos to {DATA}/Category/")
    scenes=split(script)
    if not scenes: raise RuntimeError("A script/transcript is required.")
    total=duration(audio); used=set(); chosen=[]
    previous_id=None
    for i,s in enumerate(scenes):
        requested=next((x for x in lib if i<len(overrides) and x["id"]==overrides[i]),None)
        if requested and requested["id"]!=previous_id:
            c=requested; score,cat=1.0,c["category"]; reason="Manually selected by user"
        else:
            c,score,cat,reason=choose(s,lib,used,previous_id)
            if requested and requested["id"]==previous_id:
                reason="Repeated consecutive clip prevented; selected next-best metadata match"
        if c:
            chosen.append((s,c,score,cat,reason)); used.add(c["id"]); previous_id=c["id"]
    weights=[max(1,len(x[0].split())) for x in chosen]; ds=[total*x/sum(weights) for x in weights]
    w,h={"16:9":(1920,1080),"9:16":(1080,1920),"1:1":(1080,1080)}[ratio]
    segments=[]; timeline=[]; subs=[]; cursor=0
    for i,((s,c,score,cat,reason),d) in enumerate(zip(chosen,ds),1):
        seg=folder/f"segment_{i:02}.mp4"
        vf=f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps=30,setsar=1,format=yuv420p"
        run(["ffmpeg","-y","-stream_loop","-1","-i",c["path"],"-t",f"{d:.3f}","-an","-vf",vf,"-c:v","libx264","-preset","veryfast","-crf","23",str(seg)])
        segments.append(seg)
        timeline.append({"scene":i,"narration":s,"start":round(cursor,3),"end":round(cursor+d,3),"clip":c.get("name") or c.get("title") or c.get("filename") or Path(c.get("path", "unknown_clip")).name,"clip_id":c["id"],"category":cat,"source":c.get("source","Unknown"),"license":c.get("license_status","needs_verification"),"attribution":c.get("attribution_text") or "Verify original source requirements","ai_generated":False,"selection_reason":reason,"relevance_score":score})
        subs.append(f"{i}\n{stamp(cursor)} --> {stamp(cursor+d)}\n{wrap_caption(s)}\n"); cursor+=d
    concat=folder/"concat.txt"; concat.write_text("".join(f"file '{p.as_posix()}'\n" for p in segments),encoding="utf-8")
    silent=folder/"silent.mp4"
    run(["ffmpeg","-y","-f","concat","-safe","0","-i",str(concat),"-c:v","libx264","-preset","veryfast","-crf","23","-pix_fmt","yuv420p",str(silent)])
    srt=folder/"captions.srt"; srt.write_text("\n".join(subs),encoding="utf-8")
    output=folder/f"video_{ratio.replace(':','_')}.mp4"
    if burn:
        esc=str(srt.resolve()).replace("\\","/").replace(":","\\:")
        hexcolor=(color or "#ffffff").lstrip("#")
        colour=f"&H00{hexcolor[4:6]}{hexcolor[2:4]}{hexcolor[0:2]}&" if len(hexcolor)==6 else "&H00FFFFFF&"
        outline=(3 if effects.get("glow",False) else 2) if effects.get("outline",True) or effects.get("glow",False) else 0
        shadow=2 if effects.get("shadow",True) else 0
        border=3 if effects.get("box",False) else 1
        bold=-1 if effects.get("bold",True) else 0
        italic=-1 if effects.get("italic",False) else 0
        style=f"FontName={font},FontSize={size},PrimaryColour={colour},OutlineColour=&H000000&,BorderStyle={border},Outline={outline},Shadow={shadow},Bold={bold},Italic={italic},Alignment=2,MarginV=35"
        run(["ffmpeg","-y","-i",str(silent),"-i",str(audio),"-vf",f"subtitles='{esc}':force_style='{style}'","-map","0:v:0","-map","1:a:0","-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","192k","-t",f"{total:.3f}","-movflags","+faststart",str(output)])
    else:
        run(["ffmpeg","-y","-i",str(silent),"-i",str(audio),"-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","192k","-t",f"{total:.3f}","-movflags","+faststart",str(output)])
    (folder/"timeline.json").write_text(json.dumps(timeline,indent=2),encoding="utf-8")
    (folder/"manifest.json").write_text(json.dumps({"app":"Incubrix Pro","ratio":ratio,"duration_seconds":round(total,2),"video":output.name,"captions_burned_in":burn,"scene_count":len(timeline),"created_at":datetime.now(timezone.utc).isoformat()},indent=2),encoding="utf-8")
    return output,timeline

class Project(BaseModel):
    id:str|None=None; name:str="Untitled project"; script:str=""; ratio:str="16:9"; captions:bool=True
    font:str="Arial"; font_size:int=26; caption_color:str="white"; scene_overrides:list[str]=[]

@app.get("/")
def home(): return FileResponse(STATIC/"index.html")
@app.get("/health")
@app.get("/api/v1/health")
def health(): return {"status":"ok","ffmpeg":bool(shutil.which("ffmpeg")),"ffprobe":bool(shutil.which("ffprobe")),"clip_count":len(library())}
@app.get("/ready")
def ready():
    ok=bool(shutil.which("ffmpeg") and shutil.which("ffprobe") and DATA.exists())
    return {"status":"ready" if ok else "not_ready","ready":ok}
@app.get("/api/v1/library")
def get_library(): return public_library()

@app.post("/api/v1/library")
async def add_library_video(
    video: UploadFile = File(...), category_name: str = Form(...), title: str = Form(...),
    description: str = Form(""), tags: str = Form(""), keywords: str = Form(""), visual_elements: str = Form(""),
    mood: str = Form(""), source: str = Form("Unknown"), creator: str = Form("Unknown"),
    license_status: str = Form("needs_verification"), license_name: str = Form("Unknown"),
    attribution_required: str = Form("verify"), attribution_text: str = Form(""), rights_notes: str = Form(""),
    usage_restrictions: str = Form(""), language: str = Form(""), location: str = Form(""),
    date_recorded: str = Form(""), ai_generated: str = Form("false"), notes: str = Form("")
):
    allowed_categories={"Business","City","Finance","Nature","Technology","General"}
    cat=category_name.strip().title()
    if cat not in allowed_categories: raise HTTPException(400,detail={"error":{"code":"INVALID_CATEGORY","message":"Choose a supported category.","retryable":False,"details":{}}})
    ext=Path(video.filename or "video.mp4").suffix.lower()
    if ext not in EXTS: raise HTTPException(400,detail={"error":{"code":"UNSUPPORTED_VIDEO_FORMAT","message":"Supported formats: MP4, MOV, MKV, WEBM.","retryable":False,"details":{}}})
    raw=await video.read()
    if not raw: raise HTTPException(400,detail="Uploaded video is empty")
    if len(raw)>500*1024*1024: raise HTTPException(413,detail="Video exceeds 500 MB upload limit")
    target_dir=DATA/cat; target_dir.mkdir(parents=True,exist_ok=True)
    safe_stem=re.sub(r"[^A-Za-z0-9_-]+","_",Path(video.filename or "video").stem).strip("_-") or "video"
    target=target_dir/f"{safe_stem}{ext}"
    if target.exists(): target=target_dir/f"{safe_stem}_{uuid.uuid4().hex[:6]}{ext}"
    target.write_bytes(raw)
    probe=_probe(target)
    if not probe.get('duration'):
        target.unlink(missing_ok=True)
        raise HTTPException(422,detail={"error":{"code":"INVALID_VIDEO","message":"The uploaded file could not be read as a video. Check the format and FFmpeg/FFprobe installation.","retryable":False,"details":{}}})
    rel=str(target.relative_to(DATA)).replace('\\','/')
    entry={"id":rel,"filename":target.name,"path":"data/stock_clips/"+rel,"category":cat,"title":title.strip() or target.stem.replace('_',' ').title(),
      "description":description.strip(),"tags":_split_csv(tags),"keywords":_split_csv(keywords),"visual_elements":_split_csv(visual_elements),"mood":_split_csv(mood),
      "source":source.strip() or "Unknown","creator":creator.strip() or "Unknown","license_status":license_status.strip() or "needs_verification",
      "license_name":license_name.strip() or "Unknown","attribution_required":attribution_required.strip() or "verify","attribution_text":attribution_text.strip(),
      "rights_notes":rights_notes.strip(),"usage_restrictions":usage_restrictions.strip(),"language":language.strip(),"location":location.strip(),
      "date_recorded":date_recorded.strip(),"ai_generated":ai_generated.lower() in {"true","1","yes","on"},"notes":notes.strip(),"enabled":True,"metadata_verified":True,
      "technical":probe,"duration":probe.get('duration'),"size_bytes":target.stat().st_size,"created_at":datetime.now(timezone.utc).isoformat()}
    catalog=read_metadata(); videos=[x for x in catalog['videos'] if x.get('path')!=entry['path']]
    videos.append(entry); catalog['videos']=videos; catalog['version']='1.0'; write_metadata(catalog)
    return {k:v for k,v in entry.items() if k not in {'path'}}

@app.get("/api/v1/library/metadata")
def get_library_metadata():
    return read_metadata()
@app.get("/api/v1/projects")
def get_projects():
    out=[]
    for p in PROJECTS.glob("*.json"):
        try:out.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception:pass
    return sorted(out,key=lambda x:x.get("updated_at",""),reverse=True)
@app.post("/api/v1/projects")
def save_project(data:Project):
    d=data.model_dump(); d["id"]=d["id"] or uuid.uuid4().hex[:12]; d["updated_at"]=datetime.now(timezone.utc).isoformat()
    (PROJECTS/f'{d["id"]}.json').write_text(json.dumps(d,indent=2),encoding="utf-8")
    return d
@app.delete("/api/v1/projects/{pid}")
def remove_project(pid:str):
    p=PROJECTS/f"{pid}.json"
    if not p.exists():raise HTTPException(404,"Project not found")
    p.unlink(); return {"deleted":True}
def transcribe_audio(audio_path: Path) -> str:
    """Transcribe uploaded or browser-recorded audio with faster-whisper."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("Automatic audio transcription needs faster-whisper. Install requirements.txt and retry.") from exc
    model=WhisperModel(ASR_MODEL, device=os.getenv("ASR_DEVICE","cpu"), compute_type=os.getenv("ASR_COMPUTE_TYPE","int8"))
    segments, info=model.transcribe(str(audio_path), vad_filter=True, beam_size=5)
    text=" ".join(seg.text.strip() for seg in segments).strip()
    if not text:
        raise RuntimeError("No speech was detected. Please use a clear voice recording; silent or music-only audio cannot produce captions.")
    return text

@app.post("/api/v1/transcribe")
async def transcribe_endpoint(audio: UploadFile = File(...)):
    ext=Path(audio.filename or "voice.webm").suffix.lower()
    if ext not in {".mp3",".wav",".m4a",".aac",".ogg",".webm"}:
        raise HTTPException(400,detail={"error":{"code":"UNSUPPORTED_AUDIO_FORMAT","message":"Supported audio: mp3, wav, m4a, aac, ogg, webm.","retryable":False,"details":{}}})
    temp_dir=OUT/("transcribe_"+uuid.uuid4().hex[:10]); temp_dir.mkdir(parents=True,exist_ok=True)
    path=temp_dir/("input"+ext)
    try:
        path.write_bytes(await audio.read())
        dur=duration(path)
        if dur>600:
            raise HTTPException(400,detail={"error":{"code":"AUDIO_TOO_LONG","message":"Audio must be 10 minutes or shorter.","retryable":False,"details":{"duration_seconds":dur}}})
        transcript=await asyncio.to_thread(transcribe_audio,path)
        return {"transcript":transcript,"duration_seconds":dur,"model":ASR_MODEL}
    except HTTPException:
        raise
    except Exception as e:
        logging.exception("Transcription failed")
        raise HTTPException(422,detail={"error":{"code":"TRANSCRIPTION_FAILED","message":str(e),"retryable":False,"details":{}}})
    finally:
        shutil.rmtree(temp_dir,ignore_errors=True)

@app.post("/api/v1/generate")
async def generate(script:str=Form(""),input_mode:str=Form("script"),audio_voice_mode:str=Form("original"),transcript_text:str=Form(""),ratio:str=Form("16:9"),captions:str=Form("on"),font:str=Form("Arial"),font_size:int=Form(26),caption_color:str=Form("#ffffff"),caption_effects:str=Form("{}"),voice:str=Form("en-IN-NeerjaNeural"),scene_overrides:str=Form("[]"),audio:UploadFile|None=File(None)):
    if ratio not in {"16:9","9:16","1:1"}: raise HTTPException(400,detail={"error":{"code":"INVALID_ASPECT_RATIO","message":"Unsupported aspect ratio.","retryable":False,"details":{"allowed":["16:9","9:16","1:1"]}}})
    if not library(): raise HTTPException(400,detail={"error":{"code":"NO_MEDIA","message":f"No clips found under {DATA}.","retryable":False,"details":{}}})
    job=uuid.uuid4().hex[:10]; folder=OUT/job; folder.mkdir()
    started=time.time()
    try:
        transcript=""
        if input_mode not in {"script","upload","record"}:
            raise HTTPException(400,detail={"error":{"code":"INVALID_INPUT_MODE","message":"Choose script, upload or record input mode.","retryable":False,"details":{}}})
        if input_mode=="script":
            transcript=script.strip()
            if not transcript:
                raise HTTPException(400,detail={"error":{"code":"EMPTY_SCRIPT","message":"Enter a script for narration.","retryable":False,"details":{}}})
            ap=folder/"narration.mp3"
            await tts(transcript,ap,voice)
        else:
            if not audio or not audio.filename:
                raise HTTPException(400,detail={"error":{"code":"MISSING_AUDIO","message":"Choose an audio file or finish recording your voice first.","retryable":False,"details":{}}})
            ext=Path(audio.filename).suffix.lower()
            if ext not in {".mp3",".wav",".m4a",".aac",".ogg",".webm"}:
                raise HTTPException(400,detail={"error":{"code":"UNSUPPORTED_AUDIO_FORMAT","message":"Supported audio: mp3, wav, m4a, aac, ogg, webm.","retryable":False,"details":{}}})
            uploaded=folder/f"source_audio{ext}"
            uploaded.write_bytes(await audio.read())
            try:
                dur=duration(uploaded)
            except Exception as e:
                raise HTTPException(400,detail={"error":{"code":"INVALID_AUDIO","message":"Audio file is invalid or unreadable. Try another MP3, WAV, M4A or WebM recording.","retryable":False,"details":{}}}) from e
            if dur>600:
                raise HTTPException(400,detail={"error":{"code":"AUDIO_TOO_LONG","message":"Audio must be 10 minutes or shorter.","retryable":False,"details":{"duration_seconds":dur}}})
            # Audio modes always transcribe the selected audio; script text is intentionally ignored.
            transcript=transcript_text.strip() or await asyncio.to_thread(transcribe_audio,uploaded)
            if audio_voice_mode=="replace":
                ap=folder/"narration_revoiced.mp3"
                await tts(transcript,ap,voice)
            else:
                ap=uploaded
        try: overrides=json.loads(scene_overrides or "[]")
        except Exception: overrides=[]
        try: effects=json.loads(caption_effects or "{}")
        except Exception: effects={}
        output,timeline=await asyncio.to_thread(render,folder,transcript,ap,ratio,captions=="on",font,max(16,min(48,font_size)),caption_color,overrides,effects)
        elapsed=round(time.time()-started,2)
        (folder/"transcript.txt").write_text(transcript,encoding="utf-8")
        manifest_path=folder/"manifest.json"
        manifest=json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.update({"transcription":{"provider":"faster-whisper" if input_mode in {"upload","record"} else "not-required","model":ASR_MODEL if input_mode in {"upload","record"} else None},
            "tts":{"provider":"edge-tts" if input_mode=="script" or (input_mode in {"upload","record"} and audio_voice_mode=="replace") else None,"voice":voice if input_mode=="script" or (input_mode in {"upload","record"} and audio_voice_mode=="replace") else None,"audio_mode":audio_voice_mode if input_mode in {"upload","record"} else None},
            "settings":{"aspect_ratio":ratio,"captions_burned_in":captions=="on","font":font,"font_size":font_size,"caption_color":caption_color,"caption_effects":effects},
            "timings":{"total_seconds":elapsed},"cost_estimate_usd":None,"warnings":["Local clip licensing must be verified before commercial use."]})
        manifest_path.write_text(json.dumps(manifest,indent=2),encoding="utf-8")
        return {"status":"completed","job_id":job,"transcript":transcript,"video_url":f"/outputs/{job}/{output.name}","audio_url":f"/outputs/{job}/{ap.name}","captions_url":f"/outputs/{job}/captions.srt","timeline_url":f"/outputs/{job}/timeline.json","manifest_url":f"/outputs/{job}/manifest.json","timeline":timeline}
    except HTTPException: raise
    except Exception as e:
        logging.exception("Video generation failed job_id=%s",job)
        raise HTTPException(500,detail={"error":{"code":"GENERATION_FAILED","message":str(e),"retryable":False,"details":{"job_id":job}}})
@app.get("/outputs/{job}/{filename}")
def output_file(job:str,filename:str):
    root=(OUT/job).resolve(); target=(root/filename).resolve()
    if root not in target.parents or not target.is_file():raise HTTPException(404,"Output not found")
    return FileResponse(target,filename=target.name)
