import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {categoryDefinitions,validateCategory,buildAdditionalCategories} from '../scripts/directory-categories.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(join(root,p),'utf8');
const categories=Object.keys(categoryDefinitions);

test('each category has six sourced businesses and every comparison field is explicit or unknown',()=>{
 for(const category of categories){
  const data=JSON.parse(read(`data/directory/${category}.json`));validateCategory(data,categoryDefinitions[category]);
  assert.equal(data.listings.length,6);
  for(const l of data.listings){
   const html=read(`directory/${category}/${l.id}.html`);
   assert.ok(html.includes(`https://jobhackai.io/directory/${category}/${l.id}`));
   assert.ok(html.includes(`data-directory-category="${category}"`));
   if(Object.values(l.details).includes(null))assert.ok(html.includes('Unknown in the checked sources.'));
   for(const source of l.sources)assert.ok(html.includes(source.url.replaceAll('&','&amp;')));
   for(const label of Object.values(categoryDefinitions[category].fields))assert.ok(html.includes(label));
  }
 }
});
test('generator rejects duplicate providers, unreviewed source URLs and omitted fields',()=>{
 const original=JSON.parse(read('data/directory/junk-removal.json'));
 for(const mutate of [d=>d.listings[1].id=d.listings[0].id,d=>d.listings[0].website='javascript:alert(1)',d=>d.listings[0].sources=[],d=>delete d.listings[0].details.quote,d=>d.listings[0].regions=['Made up'],d=>d.listings[0].sources[0].checkedAt='']){
  const data=structuredClone(original);mutate(data);assert.throws(()=>validateCategory(data,categoryDefinitions['junk-removal']));
 }
});
test('all generated directory links resolve and production canonicals occur once in the sitemap',()=>{
 const sitemap=read('sitemap.xml');
 const files=['directory/index.html','directory/get-listed.html'];
 for(const category of ['mobile-detailing',...categories]){
  const data=JSON.parse(read(`data/directory/${category}.json`));
  if(category!=='mobile-detailing')files.push(`directory/${category}/index.html`);
  files.push(...data.listings.map(l=>`directory/${category}/${l.id}.html`));
 }
 for(const file of files){
  const html=read(file),canonical=html.match(/rel="canonical" href="([^"]+)"/)[1];
  assert.equal(sitemap.split(`<loc>${canonical}</loc>`).length-1,1,canonical);
  assert.equal(html.includes('noindex'),false);
  for(const [,href] of html.matchAll(/href="(\/directory[^"?#]*)/g)){
   const path=join(root,href.slice(1));
   assert.ok(existsSync(path+'.html')||existsSync(join(path,'index.html'))||existsSync(path),file+' '+href);
  }
 }
 assert.ok(read('_headers').includes('https://:preview.jobhackai-app-marketing-seo.pages.dev/*\n  X-Robots-Tag: noindex, nofollow'));
});
test('additional generation is repeatable and preserves existing sitemap entries',t=>{
 const temp=mkdtempSync(join(tmpdir(),'directory-build-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 cpSync(root+'/data',temp+'/data',{recursive:true});cpSync(root+'/sitemap.xml',temp+'/sitemap.xml');
 const args={root:temp,out:temp+'/directory',esc:s=>String(s),shell:(...args)=>JSON.stringify(args)};
 buildAdditionalCategories(args);const first=readFileSync(temp+'/sitemap.xml','utf8');
 buildAdditionalCategories(args);assert.equal(readFileSync(temp+'/sitemap.xml','utf8'),first);
 for(const [,loc] of read('sitemap.xml').matchAll(/<loc>(.*?)<\/loc>/g))assert.ok(first.includes(`<loc>${loc}</loc>`));
});
test('mobile-detailing links, filters and published claims remain available',()=>{
 const hub=read('directory/index.html');
 assert.ok(hub.includes('A cleaner car.<br>Fewer tabs to open.'));
 assert.ok(hub.includes('name="utilities"'));assert.ok(hub.includes('value="boats"'));
 const data=JSON.parse(read('data/directory/mobile-detailing.json'));
 for(const l of data.listings){
  assert.ok(hub.includes(`/directory/mobile-detailing/${l.id}`));
  const page=read(`directory/mobile-detailing/${l.id}.html`);
  assert.ok(page.includes(l.website));assert.ok(page.includes(l.waterPowerNote));
  assert.ok(page.includes('data-directory-category="mobile-detailing"'));
 }
});
