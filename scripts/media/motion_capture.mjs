import * as fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const out='/tmp/quoteplate-motion-tour/captures';
export async function recorder(browser,label,options={}) {
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,recordVideo:{dir:'/tmp/quoteplate-motion-tour/raw',size:{width:1440,height:900}},...options});
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
 const page=await context.newPage();const began=performance.now();const shots=[];
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function move(locator){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();if(!b)throw Error('Cannot move to absent control');await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:22});await pause(140);}
 async function click(locator){await move(locator);await locator.click();await pause(160);}
 async function type(locator,value){await move(locator);await locator.click();await locator.fill('');await locator.pressSequentially(String(value),{delay:60});await pause(130);}
 async function clip(name,duration,act){await page.evaluate(()=>document.fonts.ready);const start=(performance.now()-began)/1000;await act({page,click,type,move,pause});let elapsed=(performance.now()-began)/1000-start;if(elapsed<duration)await pause((duration-elapsed)*1000);elapsed=(performance.now()-began)/1000-start;if(elapsed>duration*1.5)throw Error(name+' action too long '+elapsed+' for '+duration);shots.push({name,duration,start,elapsed});console.log('Recorded',name,elapsed.toFixed(2));
 // Keep the current result untouched after the measured interval. Browser video
 // can lag the wall clock; the caller must not prepare the next scene yet.
 await pause(500);
 }
 async function finish(){await pause(300);const ended=(performance.now()-began)/1000;const video=page.video();await context.close();const raw=await video.path();const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',raw]));const rawDuration=+probe.format.duration;
 // Closing the recorder can append a tail. It is not a leading time offset:
 // rawDuration - ended must never be added to every shot's start.
 const offset=0;const trailingDurationDelta=rawDuration-ended;
 await fs.mkdir(out,{recursive:true});
 for(const shot of shots){const start=shot.start;const rate=shot.elapsed/shot.duration;execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-ss',String(start),'-i',raw,'-t',String(shot.elapsed),'-vf',`setpts=PTS/${rate},fps=30`,'-an','-c:v','libx264','-preset','fast','-crf','18','-t',String(shot.duration),'-movflags','+faststart',`${out}/${shot.name}.mp4`]);}
 await fs.writeFile(`/tmp/quoteplate-motion-tour/${label}-recording.json`,JSON.stringify({raw,rawDuration,ended,offset,trailingDurationDelta,timeOrigin:'performance.now immediately after context.newPage',shots},null,2));
 }
 return {context,page,clip,finish,click,type,move,pause};
}
