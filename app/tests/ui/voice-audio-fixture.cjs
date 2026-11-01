// Visual-only local fixture. Real page/client, synthetic audio/auth/HTTP.
// No microphone, external provider, real credits or browser permission changes.
const {startFixtureServer}=require('./fixture-server.cjs');
const bootstrap=`
(() => {
  const params=new URLSearchParams(location.search);
  let plays=0, serial=0;
  const media=new MediaStream();
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{enabled:true,stop(){}}],getAudioTracks:()=>[]})},configurable:true});
  HTMLMediaElement.prototype.play=async function(){if(params.get('audio')==='blocked'&&plays++===0)throw new DOMException('Fixture blocked','NotAllowedError');};
  HTMLMediaElement.prototype.pause=function(){};
  window.AudioContext=undefined;window.webkitAudioContext=undefined;
  window.RTCPeerConnection=class {
    constructor(){this.connectionState='connected';}
    addTrack(){}
    async createOffer(){return {sdp:'v=0 fixture offer',type:'offer'};}
    async setLocalDescription(){}
    async setRemoteDescription(){
      setTimeout(()=>{this.ontrack?.({streams:[media]});this.dc.onopen?.();},30);
    }
    createDataChannel(){
      const emit=event=>this.dc.onmessage?.({data:JSON.stringify(event)});
      this.dc={readyState:'open',close(){this.readyState='closed';},send:raw=>{
        const event=JSON.parse(raw);
        if(event.type==='session.update')setTimeout(()=>emit({type:'session.updated',session:event.session}),10);
        if(event.type==='response.create'){
          const id='fixture-'+(++serial),setup=event.response.metadata.jobhackai_purpose==='audio_check';
          setTimeout(()=>{
            emit({type:'response.created',response:{id}});
            emit({type:'conversation.item.created',item:{id,role:'assistant'}});
            emit({type:'response.output_audio_transcript.done',item_id:id,response_id:id,transcript:setup?'Can you hear this clearly? Say a few words to check your microphone, then choose I can hear you on the page.':'Tell me about a process you improved and how you measured the result.'});
            emit({type:'response.done',response:{id,status:'completed'}});
            if(setup&&params.get('mic')!=='silent'){
              emit({type:'conversation.item.created',item:{id:'mic-'+id,role:'user'}});
              emit({type:'input_audio_buffer.committed',item_id:'mic-'+id});
              emit({type:'conversation.item.input_audio_transcription.completed',item_id:'mic-'+id,transcript:'Synthetic microphone check.'});
            }
          },50);
        }
      }};return this.dc;
    }
    close(){this.connectionState='closed';}
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const banner=document.createElement('p');banner.textContent='LOCAL UI FIXTURE: simulated audio and account. No microphone or credits used.';
    banner.style.cssText='background:#fff2cc;color:#332b00;padding:8px;text-align:center';document.querySelector('main')?.prepend(banner);
  });
})();`;
let activated=false;
startFixtureServer({port:8770,bootstrap,apiHandler:async(req,res,url)=>{
  res.setHeader('Content-Security-Policy',"connect-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';");
  const send=body=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true,...body}));return true;};
  if(url.pathname==='/api/plan/me')return send({plan:'free',voice:{enabled:true,transport:'managed',canStart:true,mode:'free',sessionsRemaining:1}});
  if(url.pathname==='/api/voice/sessions')return send({sessions:[]});
  if(url.pathname==='/api/voice/connection'){
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
    if(body.action==='close')return send({connectionClosed:true,sessionReserved:activated});
    if(body.action==='activate'){activated=true;return send({...body,activated:true,deadlineAt:new Date(Date.now()+1200000).toISOString()});}
    activated=false;return send({sessionId:body.sessionId,attemptId:'fixture-attempt',sdp:'v=0 fixture answer',requiresAudioCheck:true,
      interviewInstructions:'Audio check passed. Begin the first interview question.',model:'fixture',mode:'free',maxMinutes:20,deadlineAt:new Date(Date.now()+120000).toISOString()});
  }
  if(url.pathname.endsWith('/complete'))return send({status:activated?'completed':'cancelled',saved:activated,connectionClosed:true});
  return false;
}});
