// Local candidate UI surface. Serves the real HTML/CSS/JS with deterministic
// Firebase and HTTP boundaries; no production test seams or remote writes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const plans = ['free','weekly','monthly','pack','trial','essential','pro','premium','visitor'];
const saved = {
  success:true, sessionId:101, title:'QA Engineer — synthetic saved resume', role:'QA Engineer',
  createdAt:new Date().toISOString(), atsScore:82, resumeId:'synthetic-resume',
  fileName:'Synthetic_QA_Engineer_Resume_With_A_Long_Unbroken_Filename_For_Mobile_Layout.txt',
  atsRubric:[{category:'Keyword Matching',score:32,feedback:'Add measurable outcomes to your testing work.',suggestions:['Describe the release checks you owned.']}],
  roleSpecificFeedback:{targetRoleUsed:'QA Engineer',sections:[{section:'Experience',tips:['Explain your test strategy and measurable quality improvements.']}]},
  originalResume:'Synthetic QA engineer. Designed regression tests and coordinated release checks.',
  rewrittenResume:'QA engineer who designed regression coverage and coordinated release checks across three teams.',
  rewriteLocked:false, rewriteChangeSummary:null, atsIssues:[{category:'Keywords',suggestion:'Describe your test strategy.'}]
};
function authScript(plan) {
  return `(() => {
    const plan = ${JSON.stringify(plan)};
    // Reset only this isolated localhost fixture's own storage on navigation.
    sessionStorage.clear(); localStorage.clear();
    const user = plan === 'visitor' ? null : {uid:'ui-fixture-'+plan,email:'ui-fixture@example.test',displayName:'UI Test',emailVerified:true,getIdToken:async()=> 'fixture-token'};
    if(user) {
      const data=JSON.stringify({...user,stsTokenManager:{accessToken:'fixture-token',expirationTime:Date.now()+3600000}});
      sessionStorage.setItem('firebase:authUser:fixture:[DEFAULT]',data);
      sessionStorage.setItem('user-authenticated','true'); localStorage.setItem('user-authenticated','true');
      localStorage.setItem('firebase-id-token','fixture-token');
      localStorage.setItem('creditsByUid:'+user.uid,JSON.stringify({ats_free_lifetime:1}));
    } else { sessionStorage.setItem('user-authenticated','false'); }
    localStorage.setItem('user-plan',plan);
    window.FirebaseAuthManager={getCurrentUser:()=>user,waitForAuthReady:async()=>user,isAuthenticated:()=>!!user,requireAuth:()=>!!user,requireVerifiedEmail:async()=>!!user,getIdToken:async()=>user?'fixture-token':null,onAuthStateChanged:fn=>{fn(user);return()=>{};}};
    document.addEventListener('DOMContentLoaded',()=>{document.dispatchEvent(new CustomEvent('firebase-auth-ready',{detail:{user}}));window.dispatchEvent(new CustomEvent('firebase-auth-ready',{detail:{user}}));});
  })();`;
}
function startFixtureServer({port=3003, apiHandler}={}) {
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url,'http://localhost');
      const referer = new URL(req.headers.referer || req.url,'http://localhost');
      const candidatePlan = url.searchParams.get('plan') || referer.searchParams.get('plan') || 'free';
      const plan = plans.includes(candidatePlan) ? candidatePlan : 'free';
      const history = (url.searchParams.get('state') || referer.searchParams.get('state')) === 'saved';
      res.setHeader('Cache-Control','no-store');
      const json = (body,status=200) => {res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
      if (url.pathname.startsWith('/api/')) {
        if (apiHandler && await apiHandler(req,res,url)) return;
        if (plan === 'visitor') return json({error:'Unauthorized'},401);
        if (url.pathname === '/api/plan/me') return json({plan,subscriptionStatus:'active',voice:{enabled:true},isAuthenticated:true});
        if (url.pathname === '/api/usage') {
          const unlimited={used:0,limit:null,remaining:null,unlimited:true,cooldown:0};
          return json({success:true,plan,usage:{atsScoring:{used:0,limit:plan==='free'?1:null,remaining:1},resumeFeedback:{used:history?1:0,limit:['free','pack','essential','trial'].includes(plan)?3:null,remaining:history?2:3},resumeRewrite:unlimited,interviewQuestions:unlimited,mockInterview:{used:0,limit:20,remaining:20}}});
        }
        if (url.pathname === '/api/roles') return json({roles:[{name:'QA Engineer',category:'software_engineering'},{name:'Software Engineer',category:'software_engineering'}]});
        if (url.pathname === '/api/resume-feedback/history') return json({success:true,items:history?[saved]:[],total:history?1:0});
        if (url.pathname === '/api/resume-feedback/history/101') return json(saved);
        if (url.pathname === '/api/resume-rewrite') return json({success:true,rewrittenResume:saved.rewrittenResume,changeSummary:null});
        if (url.pathname === '/api/interview-questions/generate') return json({success:true,role:'QA Engineer',type:'mixed',seed:'synthetic',questions:Array.from({length:10},(_,i)=>({q:`Synthetic practice question ${i+1}: how do you test a release?`,hint:'Describe a concrete example.'}))});
        if (url.pathname === '/api/interview-questions/history') return json(req.method==='GET'?{success:true,items:[]}:{success:true,id:202});
        if (url.pathname === '/api/interview-questions/save-set') return json({success:true,id:202});
        if (url.pathname === '/api/ats-score-persist') return json({success:true,data:null});
        return json({success:true,items:[],data:null});
      }
      if (url.pathname === '/js/firebase-auth.js') {
        res.writeHead(200,{'Content-Type':'text/javascript'});
        return res.end('const auth = {currentUser:window.FirebaseAuthManager.getCurrentUser()}; const UserDatabase={}; const AUTH_PENDING={_authPending:true}; export {auth,UserDatabase,AUTH_PENDING}; export default window.FirebaseAuthManager; export const waitForAuthReady=window.FirebaseAuthManager.waitForAuthReady;');
      }
      // Serve public site assets only; never expose checkout secrets or evidence.
      let file = path.resolve(root,'.'+decodeURIComponent(url.pathname));
      const publicPath = path.relative(root,file);
      if (!/^(?:[\w-]+(?:\.html)?$|(?:css|js|assets)\/)/.test(publicPath)) return json({error:'Not found'},404);
      if (!path.extname(file)) file += '.html';
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json({error:'Not found'},404);
      let content = fs.readFileSync(file);
      if (path.extname(file)==='.html') content = content.toString().replace('<head>','<head><script>'+authScript(plan)+'</script>');
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}); res.end(content);
    } catch { res.writeHead(500); res.end('Fixture request failed'); }
  });
  server.listen(port,'127.0.0.1',()=>console.log(`Candidate fixture: http://localhost:${port}/resume-feedback-pro.html?plan=free&state=saved`));
  return server;
}
module.exports = {startFixtureServer};
if (require.main===module) startFixtureServer();
