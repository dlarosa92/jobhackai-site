#!/usr/bin/env node
// Read-only evidence capture. Prior dashboard source-health prose is deliberately excluded.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const exec=promisify(execFile),repo='dlarosa92/jobhackai-site';
const client=fileURLToPath(new URL('./dashboard-client.mjs',import.meta.url));
const nativeRead=async(kind,path)=>{
  const result=kind==='dashboard'?await exec(process.execPath,[client,'GET',path],{timeout:40000,maxBuffer:8*1024*1024}):await exec('gh',['api',`repos/${repo}/${path}`],{timeout:40000,maxBuffer:8*1024*1024});
  return JSON.parse(result.stdout);
};
export async function captureInputs(read=nativeRead,clock=()=>new Date().toISOString()) {
  const startedAt=clock(),observations={};
  const requests=[['board','dashboard','/api/work-items'],['analytics','dashboard','/api/analytics'],...['dev0','develop','main'].map(b=>[b,'github',`branches/${b}`]),['pulls','github','pulls?state=all&sort=updated&direction=desc&per_page=30']];
  await Promise.all(requests.map(async([name,kind,path])=>{
    try{observations[name]={observedAt:clock(),kind,path,data:await read(kind,path)};observations[name].observedAt=clock();}
    catch{observations[name]={observedAt:clock(),kind,path,error:'Source request failed. No current evidence was captured.'};}
  }));
  const b=observations.board.data,branches={};
  for(const name of ['dev0','develop','main']){
    const d=observations[name].data;
    if(d?.name===name&&/^[a-f0-9]{40}$/.test(d?.commit?.sha||''))branches[name]={sha:d.commit.sha,observedAt:observations[name].observedAt};
  }
  const pulls=Array.isArray(observations.pulls.data)?observations.pulls.data.map(p=>({number:p.number,url:p.html_url,state:p.state,mergedAt:p.merged_at,base:p.base?.ref,head:p.head?.sha,updatedAt:p.updated_at})):null;
  return {startedAt,finishedAt:clock(),readOnly:true,
    github:{status:Object.keys(branches).length===3&&pulls?'current':'incomplete',branches,pulls,scope:'Fresh branch heads and 30 recently updated PRs only. CI, deployments and human acceptance are separate checks.'},
    board:b?{observedAt:observations.board.observedAt,asOf:b.asOf,sourceVersions:(b.sources||[]).map(s=>({source:s.source,version:s.version})),gmailSync:b.gmailSync,directorySource:b.directorySource,directoryCount:(b.items||[]).filter(i=>i.source==='directory').length,productReferences:(b.items||[]).filter(i=>i.department==='product'&&i.boardLane!=='done').map(i=>({id:i.id,sourceId:i.sourceId,sourceRevision:i.sourceRevision,candidate:i.candidate,sourceRefs:i.sourceRefs}))}:null,
    analytics:observations.analytics.data?{status:observations.analytics.data.status,previousReportCheckedAt:observations.analytics.data.report?.checkedAt,scope:'Stored report metadata only. These are not new GA4 observations.'}:null,
    requests:requests.map(([name,kind,path])=>({name,kind,path,observedAt:observations[name].observedAt,error:observations[name].error||null}))};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    if(process.argv.length!==3)throw Error('Usage: node capture-source-inputs.mjs /private/evidence/directory');
    const directory=resolve(process.argv[2]);await mkdir(directory,{recursive:true,mode:0o700});
    const captured=await captureInputs(),file=resolve(directory,`api-inputs-${captured.startedAt.replaceAll(':','-')}.json`);
    await writeFile(file,JSON.stringify(captured,null,2),{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({evidenceFile:file,...captured}));
    if(captured.github.status!=='current'||!captured.board)process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
