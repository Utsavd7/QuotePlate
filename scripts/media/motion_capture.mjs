import * as fs from 'node:fs/promises';
import childProcess, {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('@playwright/test');
const work=process.env.QUOTEPLATE_FILM_WORK || '/tmp/quoteplate-first-purchase';
const out=work+'/captures';
// The bundled recorder targets 1 Mbps by default, which smears 4K interface text.
// Adjust only this process's Playwright VP8 recorder, never installed dependencies.
const originalSpawn=childProcess.spawn;
childProcess.spawn=function(command,args,options){
 if(args?.includes('vp8') && args.includes('-b:v') && args.includes('-qmax')){
  args=[...args]; args[args.indexOf('-b:v')+1]='24M'; args[args.indexOf('-qmax')+1]='20'; args[args.indexOf('-threads')+1]='4';
 }
 return originalSpawn.call(this,command,args,options);
};
export async function recorder(_browser,label,options={}) {
 const {captureMode='desktop', ...requestedOptions}=options;
 if(!['desktop','phone'].includes(captureMode)) throw Error('Unknown capture mode');
 const native=captureMode==='phone'?{width:1560,height:2400}:{width:3840,height:2400};
 const css=captureMode==='phone'?{width:390,height:600}:{width:1440,height:900};
 const zoom=captureMode==='phone'?4:8/3;
 // Native browser zoom preserves a 1440x900 CSS layout on a 3840x2400 surface.
 // deviceScaleFactor alone leaves the browser's video at CSS-pixel resolution.
 if(!/^[a-z0-9-]+$/.test(label)) throw Error('Use a plain recording label');
 await fs.mkdir(work+'/profiles',{recursive:true});
 const profile=await fs.mkdtemp(work+'/profiles/'+label+'-');
 const extension=profile+'/zoom-extension'; await fs.mkdir(extension);
 await fs.writeFile(extension+'/manifest.json',JSON.stringify({manifest_version:3,name:'Local 4K recording zoom',version:'1.0',permissions:['tabs'],background:{service_worker:'worker.js'}}));
 await fs.writeFile(extension+'/worker.js',`chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(change.status==='complete' && /^https?:/.test(tab.url||'')) chrome.tabs.setZoom(id,${zoom});});`);
 const {storageState, ...contextOptions}=requestedOptions;
 if(typeof storageState==='string') throw Error('Recording auth state must stay in memory');
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,...contextOptions,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:native,deviceScaleFactor:1,recordVideo:{dir:work+'/raw',size:native}});
 if(storageState?.cookies) await context.addCookies(storageState.cookies);
 await context.addInitScript(()=>{
  addEventListener('DOMContentLoaded',()=>{
   const dot=document.createElement('div');dot.id='film-cursor';dot.style.cssText='position:fixed;left:0;top:0;width:16px;height:16px;border:2px solid white;border-radius:50%;background:#285e4d;box-shadow:0 1px 7px #0008;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);display:none';document.body.append(dot);
   addEventListener('mousemove',e=>{dot.style.display='block';dot.style.left=e.clientX+'px';dot.style.top=e.clientY+'px'});
   addEventListener('mousedown',()=>{dot.style.background='#101817';dot.style.scale='1.5'});
   addEventListener('mouseup',()=>{dot.style.background='#285e4d';dot.style.scale='1'});
  });
 });
 // Shot times share this monotonic origin immediately after page creation.
 // Check raw opening frames when using a different browser/recorder version.
 const startupPages=context.pages();
 const page=await context.newPage();const began=performance.now();const shots=[];
 // Stop recording Chromium’s unused startup tab alongside the actual capture.
 await Promise.all(startupPages.map(tab=>tab.close()));
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function move(locator){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();if(!b)throw Error('Cannot move to absent control');await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:22});await pause(140);}
 async function click(locator){await move(locator);await locator.click();await pause(160);}
 async function type(locator,value){await move(locator);await locator.click();await locator.fill('');await locator.pressSequentially(String(value),{delay:60});await pause(130);}
 async function clip(name,duration,act){await page.waitForFunction(({css,zoom})=>innerWidth===css.width && innerHeight===css.height && devicePixelRatio>zoom-.05,{css,zoom});await page.evaluate(()=>document.fonts.ready);const start=(performance.now()-began)/1000;await act({page,click,type,move,pause});let elapsed=(performance.now()-began)/1000-start;if(elapsed<duration)await pause((duration-elapsed)*1000);elapsed=(performance.now()-began)/1000-start;if(elapsed>duration*1.5)throw Error(name+' action too long '+elapsed+' for '+duration);shots.push({name,duration,start,elapsed});console.log('Recorded',name,elapsed.toFixed(2));
 // Keep the current result untouched after the measured interval. Browser video
 // can lag the wall clock; the caller must not prepare the next scene yet.
 await pause(500);
 }
 async function abort(){try{await context.close();}finally{await fs.rm(profile,{recursive:true,force:true});}}
 async function finish(){await pause(300);const ended=(performance.now()-began)/1000;const video=page.video();await abort();const raw=await video.path();const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',raw]));const rawDuration=+probe.format.duration;
 // Closing the recorder can append a tail. It is not a leading time offset:
 // rawDuration - ended must never be added to every shot's start.
 const offset=0;const trailingDurationDelta=rawDuration-ended;
 await fs.mkdir(out,{recursive:true});
 for(const shot of shots){const start=shot.start;const rate=shot.elapsed/shot.duration;execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-ss',String(start),'-t',String(shot.elapsed+.15),'-i',raw,'-vf',`setpts=(PTS-STARTPTS)/${rate},fps=30`,'-an','-frames:v',String(Math.round(shot.duration*30)),'-c:v','libx264','-preset','fast','-crf','18','-t',String(shot.duration),'-movflags','+faststart',`${out}/${shot.name}.mp4`]);}
 await fs.writeFile(`${work}/${label}-recording.json`,JSON.stringify({raw,rawDuration,ended,offset,trailingDurationDelta,timeOrigin:'performance.now immediately after context.newPage',nativeResolution:[native.width,native.height],cssViewport:[css.width,css.height],browserZoom:zoom,recordingBitrate:'24M',shots},null,2));
 }
 return {context,page,clip,finish,abort,click,type,move,pause};
}
