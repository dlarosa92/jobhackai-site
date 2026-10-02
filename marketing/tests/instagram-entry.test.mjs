import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../js/instagram-entry.js',import.meta.url),'utf8');
function visit(url){const redirects=[],meta=[];vm.runInNewContext(source,{URL,window:{location:{href:url,replace:x=>redirects.push(x)}},document:{createElement:()=>({}),head:{appendChild:x=>meta.push(x)}}});return {redirects,meta};}
const legacy='https://jobhackai.io/?utm_source=ig&utm_medium=social&utm_content=link_in_bio';
test('exact saved Instagram profile link resolves before analytics with complete campaign tags',()=>{
 const result=visit(legacy+'&fbclid=external-click');assert.equal(result.redirects.length,1);
 const target=new URL(result.redirects[0]);assert.equal(target.pathname,'/features');
 assert.equal(target.searchParams.get('utm_source'),'instagram');assert.equal(target.searchParams.get('utm_medium'),'organic_social');
 assert.equal(target.searchParams.get('utm_campaign'),'voice_beta_2026_09');assert.equal(target.searchParams.get('utm_content'),'voice_instagram_profile_01');
 assert.equal(result.meta[0].name,'referrer');assert.equal(result.meta[0].content,'no-referrer');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.ok(html.indexOf('instagram-entry.js')<html.indexOf('cookie-consent.js'));
});
test('ordinary visits, Local links, explicit campaigns, duplicate parameters and previews are unchanged',()=>{
 for(const url of ['https://jobhackai.io/',legacy+'&utm_campaign=existing',legacy+'&utm_campaign=',legacy+'&utm_source=facebook',legacy.replace('/?','/directory/junk-removal?'),legacy.replace('link_in_bio','local_profile'),legacy.replace('jobhackai.io','preview.pages.dev')])assert.deepEqual(visit(url).redirects,[]);
});
