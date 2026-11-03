#!/usr/bin/env node
// Read-only evidence capture. Prior dashboard source-health prose is deliberately excluded.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const exec=promisify(execFile),repo='dlarosa92/jobhackai-site';
const client=fileURLToPath(new URL('./dashboard-client.mjs',import.meta.url));
const shaPattern=/^[a-f0-9]{40}$/;
const treePattern=/^dashboard-tree-([a-f0-9]{40})$/;
const candidatePath=candidate=>shaPattern.test(candidate||'')?`commits/${candidate}/pulls?per_page=100`:treePattern.test(candidate||'')?`git/trees/${candidate.match(treePattern)[1]}`:null;
const pullRecord=p=>({number:p.number,url:p.html_url,state:p.state,mergedAt:p.merged_at,mergeCommit:p.merge_commit_sha,base:p.base?.ref,head:p.head?.sha,updatedAt:p.updated_at});
export function candidateIdentity(candidate,pulls) {
  if(!shaPattern.test(candidate||'')||!Array.isArray(pulls))return {status:'incomplete',matches:[],reason:'Exact candidate identity could not be established.'};
  const matches=pulls.flatMap(p=>{
    const basis=p.merged_at&&p.merge_commit_sha===candidate?'merged_commit':p.head?.sha===candidate?'head':null;
    return basis?[{...pullRecord(p),basis}]:[];
  });
  return {status:matches.length?'verified':'incomplete',matches,reason:matches.length?'The exact receipt candidate matches these native PR fields. This verifies identity, not deployment or acceptance.':'No exact head or completed merge match. Inspect candidate ancestry and deployment evidence before declaring a conflict.'};
}
export function treeIdentity(candidate,tree) {
  const sha=candidate?.match(treePattern)?.[1],verified=!!sha&&tree?.sha===sha&&Array.isArray(tree.tree)&&tree.truncated===false;
  return {status:verified?'verified':'incomplete',kind:'git_tree',sha:sha||null,matches:[],reason:verified?'The exact content tree exists in the native repository. This verifies content identity, not PR approval, deployment or acceptance.':'The exact complete content tree was not read. Keep this candidate unverified.'};
}
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
  const pulls=Array.isArray(observations.pulls.data)?observations.pulls.data.map(pullRecord):null;
  const productItems=(b?.items||[]).filter(i=>i.department==='product'&&i.boardLane!=='completed');
  const candidates=[...new Set(productItems.filter(i=>i.source==='github'&&candidatePath(i.candidate)).map(i=>i.candidate))];
  await Promise.all(candidates.map(async candidate=>{
    const name=`candidate-${candidate}`,kind='github',path=candidatePath(candidate);requests.push([name,kind,path]);
    try{observations[name]={kind,path,data:await read(kind,path),observedAt:clock()};}
    catch{observations[name]={kind,path,observedAt:clock(),error:'Candidate PR lookup failed. No current identity evidence was captured.'};}
  }));
  const candidateChecks=productItems.filter(i=>i.source==='github'&&i.candidate).map(i=>{
    const observation=observations[`candidate-${i.candidate}`];
    return {itemId:i.id,candidate:i.candidate,observedAt:observation?.observedAt||null,path:observation?.path||null,...(treePattern.test(i.candidate)?treeIdentity(i.candidate,observation?.data):candidateIdentity(i.candidate,observation?.data))};
  });
  return {startedAt,finishedAt:clock(),readOnly:true,
    github:{status:Object.keys(branches).length===3&&pulls?'current':'incomplete',candidateStatus:b&&candidateChecks.every(c=>c.status==='verified')?'verified':'incomplete',branches,pulls,candidateChecks,scope:'Source status covers fresh branch heads and recent PR reads. Candidate checks separately identify exact commits or content trees. An unfinished identity, failed CI, missing deployment or pending acceptance does not turn a successful source read into a failure.'},
    board:b?{observedAt:observations.board.observedAt,asOf:b.asOf,sourceVersions:(b.sources||[]).map(s=>({source:s.source,version:s.version})),gmailSync:b.gmailSync,directorySource:b.directorySource,directoryCount:(b.items||[]).filter(i=>i.source==='directory').length,productReferences:productItems.map(i=>({id:i.id,sourceId:i.sourceId,sourceRevision:i.sourceRevision,candidate:i.candidate,sourceRefs:i.sourceRefs}))}:null,
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
