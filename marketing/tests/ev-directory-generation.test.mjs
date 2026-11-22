import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {buildEVDirectory} from '../scripts/build-ev-directory.mjs';
import {buildMarketingSite} from '../scripts/build.mjs';
import {providerReferralUrl} from '../scripts/provider-referrals.mjs';
const root=new URL('../',import.meta.url).pathname;
const read=p=>readFileSync(join(root,p),'utf8');
const data=JSON.parse(read('data/directory/ev-charger-installation.json'));
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'jobhackai-ev-build-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));cpSync(join(root,'data'),join(dir,'data'),{recursive:true});cpSync(join(root,'directory'),join(dir,'directory'),{recursive:true});cpSync(join(root,'css'),join(dir,'css'),{recursive:true});cpSync(join(root,'sitemap.xml'),join(dir,'sitemap.xml'));return dir;}
test('all22 EV records keep explicit fields, valid discovery, internal links and existing provider referral tags',()=>{
 const sitemap=read('sitemap.xml'),manifest=JSON.parse(read('agent-index.json'));
 assert.equal(data.listings.length,22);
 const files=['index',...data.listings.map(l=>l.id)];
 for(const id of files){
  const $=load(read(`directory/ev-charger-installation/${id}.html`));const url=$('link[rel="canonical"]').attr('href');assert.equal(sitemap.split(`<loc>${url}</loc>`).length-1,1);assert.ok(manifest.pages.some(p=>p.url===url));
  assert.equal($('body').attr('data-directory-category'),'ev-charger-installation');
  for(const el of $('[href],[src]').toArray()){
   const href=$(el).attr('href')||$(el).attr('src');if(!href.startsWith('/')||href.startsWith('//'))continue;
   const path=join(root,new URL(href,'https://jobhackai.io').pathname);assert.ok([path,path+'.html',join(path,'index.html')].some(x=>existsSync(x)),href);
   if(/^\/directory\/.*\.(js|css)/.test(href))assert.match(href,/\?v=[a-f0-9]{12}$/);
  }
  if(id==='index')continue;
  const listing=data.listings.find(l=>l.id===id);assert.equal($('body').attr('data-listing'),id);
  if(Object.values(listing.details).includes(null))assert.ok($('main').text().includes('Unknown in the checked sources.'));
  for(const el of $('a[data-directory-contact]').toArray()){
   const u=new URL($(el).attr('href'));assert.equal(u.searchParams.get('utm_source'),'jobhackai_local');assert.equal(u.searchParams.get('utm_medium'),'referral');assert.equal(u.searchParams.get('utm_campaign'),'directory_ev_charger_installation_nky_2026_09');assert.ok(u.searchParams.get('utm_content').startsWith(id+'_profile_'));
  }
 }
 assert.match(read('_headers'),/https:\/\/:preview\.jobhackai-app-marketing-seo\.pages\.dev\/\*\n  X-Robots-Tag: noindex, nofollow/);
});
test('EV generation is repeatable, replaces stale runtime URLs and preserves unrelated sitemap entries',t=>{
 const dir=fixture(t);const old=readFileSync(join(dir,'sitemap.xml'),'utf8');buildEVDirectory({root:dir});const first=readFileSync(join(dir,'sitemap.xml'),'utf8');buildEVDirectory({root:dir});assert.equal(readFileSync(join(dir,'sitemap.xml'),'utf8'),first);
 for(const [,url]of old.matchAll(/<loc>(.*?)<\/loc>/g))assert.ok(first.includes(`<loc>${url}</loc>`));
 const page=join(dir,'directory/ev-charger-installation/leitner-electric.html');const before=readFileSync(page,'utf8').match(/directory\.js\?v=([a-f0-9]+)/)[1];const runtime=join(dir,'directory/directory.js');writeFileSync(runtime,readFileSync(runtime,'utf8')+'\n// cache test\n');buildEVDirectory({root:dir});assert.notEqual(readFileSync(page,'utf8').match(/directory\.js\?v=([a-f0-9]+)/)[1],before);
});
test('normal site build regenerates a changed EV source into HTML, Markdown and manifest',t=>{
 const dir=fixture(t);const sentinel='Unique synthetic quote fixture for generation regression';const f=join(dir,'data/directory/ev-charger-installation.json');const d=JSON.parse(readFileSync(f,'utf8'));d.listings.find(l=>l.id==='leitner-electric').details.quote=sentinel;writeFileSync(f,JSON.stringify(d));
 // A bounded sitemap containing EV alone avoids needing the unrelated Core tree.
 cpSync(join(root,'index.html'),join(dir,'index.html'));writeFileSync(join(dir,'sitemap.xml'),'<urlset><url><loc>https://jobhackai.io/</loc></url></urlset>');writeFileSync(join(dir,'_headers'),'');
 buildMarketingSite({root:dir});for(const ext of ['html','md'])assert.ok(readFileSync(join(dir,`dist/directory/ev-charger-installation/leitner-electric.${ext}`),'utf8').includes(sentinel));
 assert.equal(JSON.parse(readFileSync(join(dir,'dist/agent-index.json'),'utf8')).pages.length,24);
});
test('missing required source fields fail before overwriting existing pages',t=>{
 const dir=fixture(t),f=join(dir,'data/directory/ev-charger-installation.json');const d=JSON.parse(readFileSync(f,'utf8'));delete d.listings[0].details.permits;writeFileSync(f,JSON.stringify(d));const page=join(dir,'directory/ev-charger-installation/index.html'),before=readFileSync(page,'utf8');assert.throws(()=>buildEVDirectory({root:dir}),/Missing comparison field/);assert.equal(readFileSync(page,'utf8'),before);
});
test('referral helper preserves existing tags, query and fragment and rejects private or unsafe contexts',()=>{
 const u=new URL(providerReferralUrl('https://provider.example/quote?utm_source=existing&service=ev#form','ev-charger-installation','leitner-electric','website'));assert.equal(u.searchParams.get('utm_source'),'existing');assert.equal(u.searchParams.get('service'),'ev');assert.equal(u.hash,'#form');assert.throws(()=>providerReferralUrl('mailto:private@example.com','ev-charger-installation','leitner-electric','website'));assert.throws(()=>providerReferralUrl('https://provider.example','ev-charger-installation','private@example.com','website'));
});
test('generated intake cannot retain an older request runtime asset',()=>{
 const hash=createHash('sha256').update(read('directory/request-form.js')).digest('hex').slice(0,12);assert.ok(read('directory/get-listed.html').includes(`/directory/request-form.js?v=${hash}`));
});
