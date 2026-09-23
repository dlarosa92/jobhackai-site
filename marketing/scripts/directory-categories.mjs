import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

export const categoryDefinitions = {
  'junk-removal': {
    title:'Junk removal in Northern Kentucky & Cincinnati', label:'Junk removal', noun:'provider',
    headline:'Clear the space.<br>Know what the quote covers.',
    description:'Compare local junk removal by accepted items, loading, service area and quote method. Check municipal pickup before paying for a haul.',
    serviceLabel:'Items to remove', services:['furniture','appliances','yard-waste','construction-debris','electronics'],
    fields:{items:'Accepted items',loading:'Carrying and loading',area:'Service area',quote:'How to get a quote',exclusions:'Exclusions'},
    questions:['Send an item list and photos. Identify stairs, parking restrictions, heavy items and anything still connected to utilities.',
      'Ask whether the quote includes carrying from inside, labor, transport, disposal charges and cleanup. Ask what could change the price.',
      'Confirm hazardous-material and appliance restrictions before pickup. Published acceptance of a general item type does not cover every condition.'],
    guide:`<section class="guide" id="municipal-pickup"><h2>Check municipal pickup first</h2>
      <p>Paid removal may help with carrying from inside or a larger cleanout. For eligible items and addresses, your regular collection service may already offer an option.</p>
      <h3>Inside Cincinnati city limits</h3><p>The city offers free scheduled bulk pickup to eligible homes receiving city garbage collection. A Cincinnati mailing address alone does not establish eligibility; private-hauler customers and addresses outside city limits are excluded. Check item restrictions, schedule through 311 and follow curb-placement instructions.</p>
      <p><a href="https://www.cincinnati-oh.gov/311/requests/mtl-frn/">Check Cincinnati eligibility and request instructions</a>.</p>
      <h3>Covington</h3><p>The city describes one bulk item per week for residents, subject to preparation rules. Mattresses and upholstered furniture must be wrapped and sealed. Hazardous materials, construction debris and appliances still containing refrigerant are among curbside exclusions. Larger loads can require a paid special pickup or a transfer-station trip; residents may apply for a monthly drop-off voucher with vehicle and material limits.</p>
      <p><a href="https://www.covingtonky.gov/government/departments/public-works/solid-waste-recycling/trash-guidelines">Read Covington preparation rules and voucher eligibility</a>.</p>
      <p>Elsewhere in Northern Kentucky or Greater Cincinnati, check your municipality and regular hauler. These two programs are not region-wide services. Rules checked September 23, 2026.</p></section>`
  },
  'ev-charger-installation': {
    title:'Home Level 2 EV charger installation in Northern Kentucky & Cincinnati',label:'Home Level 2 EV charger installation',noun:'installer',
    headline:'Plan home charging.<br>Compare the whole installation.',
    description:'Compare local home Level 2 EV charger installers by panel assessment, charger supply, permits, service area and written quote scope.',
    serviceLabel:'Additional work mentioned',services:['panel-upgrade','multi-vehicle','indoor-outdoor'],
    fields:{panel:'Panel assessment',charger:'Who supplies the charger?',permits:'Permits and inspections',area:'Service area',quote:'How to get a quote',scope:'Published installation scope',license:'License verification'},
    questions:['Ask for the legal business name, applicable license numbers and current registration for your address. Independently check the issuing authority; a provider website claim is not verification.',
      'Have the installer assess service capacity, panel condition, cable route and your charging needs before recommending equipment or a panel upgrade. A spare breaker space alone does not establish capacity.',
      'Request a written quote separating charger hardware, circuit and wiring work, mounting, panel work, permit and inspection fees, testing, and any trenching or wall repair. Specify who supplies the charger and who handles inspection sign-off.'],
    guide:`<section class="guide" id="installation-checklist"><h2>Verify the contractor and the installation plan</h2>
      <p>These listings confirm that a business advertises local home EV installation. They do not certify its current license, insurance or workmanship. A published license number is a starting point for a check, not an endorsement.</p>
      <p>For Kentucky, use the <a href="https://dhbc.ky.gov/">Department of Housing, Buildings and Construction</a> and its License Search and Verification service. Confirm the contractor authority as well as the electrician credential for the work.</p>
      <p>For a Cincinnati address, check the city's <a href="https://www.cincinnati-oh.gov/buildings/building-permit-forms-applications/contractor-registration/">contractor registration guidance</a>. For other Ohio jurisdictions, ask the local building department which credentials and registration apply to your residential project.</p>
      <p>Have the contractor identify the permit issuer, who applies, which inspections are needed and what completion record you receive. Cincinnati's <a href="https://www.cincinnati-oh.gov/buildings/consumer-affairs-assistance/manage-residential-construction-project/">residential project guidance</a> explains contractor and permit checks. Confirm the requirements for your actual address before work begins. Official guidance checked September 23, 2026.</p>
      <h3>Buying a charger is a separate decision</h3><p>Ask whether the quote includes the charger or installation only. Confirm the model, vehicle connector, placement, warranty responsibility and commissioning. Ask the installer to explain the proposed load calculation and any options for managing demand. Do not assume every home needs a panel replacement or that every charger will suit the existing circuit.</p></section>`
  }
};

export function validateCategory(data,definition) {
  if(!definition || !Array.isArray(data.listings) || data.listings.length<6 || data.listings.length>10) throw Error('Expected 6 to 10 category listings');
  const seen=new Set();
  for(const l of data.listings){
    if(!/^[a-z0-9-]+$/.test(l.id) || seen.has(l.id) || !l.name) throw Error('Invalid or duplicate listing');
    seen.add(l.id);
    if(!l.regions?.length || l.regions.some(r=>!['Cincinnati','Northern Kentucky'].includes(r))) throw Error('Invalid service region');
    if(!Array.isArray(l.services) || l.services.some(s=>!definition.services.includes(s))) throw Error('Invalid service filter');
    for(const key of Object.keys(definition.fields)) if(l.details?.[key]!==null && (typeof l.details?.[key]!=='string' || !l.details[key].trim())) throw Error('Missing comparison field: '+key);
    if(!l.sources?.length) throw Error('Missing provider sources');
    for(const source of [{url:l.website},...l.sources]){
      const u=new URL(source.url);if(u.protocol!=='https:' || u.username || u.password) throw Error('Unsafe provider source');
    }
    for(const s of l.sources) if(!/^\d{4}-\d{2}-\d{2}$/.test(s.checkedAt) || !s.label) throw Error('Missing source check date');
    if(data.category==='junk-removal' && (!l.loading?.length || l.loading.some(s=>!['full-service','curbside','self-load'].includes(s)))) throw Error('Invalid loading filter');
  }
}

export function buildAdditionalCategories({root,out,shell,esc}) {
  const urls=[];
  const unknown='Unknown in the checked sources. Ask the provider to confirm in writing.';
  const text=value=>esc(value===null?unknown:value);
  const labels={'panel-upgrade':'Panel work','multi-vehicle':'Multiple vehicles','indoor-outdoor':'Indoor / outdoor','yard-waste':'Yard waste','construction-debris':'Construction debris','full-service':'Crew carries and loads','curbside':'Curbside pickup offered','self-load':'Self-loaded dumpster also offered'};
  const options=values=>values.map(v=>`<option value="${esc(v)}">${esc(labels[v] || v.charAt(0).toUpperCase()+v.slice(1))}</option>`).join('');
  for(const [category,d] of Object.entries(categoryDefinitions)){
    const data=JSON.parse(readFileSync(join(root,'data/directory',category+'.json'),'utf8'));
    if(data.category!==category) throw Error('Category does not match filename');
    validateCategory(data,d);
    mkdirSync(join(out,category),{recursive:true});
    const hub='/directory/'+category;
    const path=l=>hub+'/'+l.id;
    const sourceList=l=>`<ul>${l.sources.map(s=>`<li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.label)}</a>, checked ${esc(s.checkedAt)}</li>`).join('')}</ul>`;
    const details=l=>Object.entries(d.fields).map(([key,label])=>`<dt>${esc(label)}</dt><dd>${text(l.details[key])}</dd>`).join('');
    const rows=data.listings.slice().sort((a,b)=>a.name.localeCompare(b.name));
    const cards=rows.map(l=>`<article class="listing" data-region="${esc(l.regions.join('|'))}" data-service="${esc(l.services.join('|'))}" data-loading="${esc((l.loading||[]).join('|'))}"><span class="eyebrow">${esc(d.label)}</span><h2><a href="${path(l)}">${esc(l.name)}</a></h2><p>${esc(l.regions.join(' · '))}</p><dl>${details(l)}</dl><a class="more" href="${path(l)}">Compare provider details <span aria-hidden="true">→</span></a></article>`).join('\n');
    const filters=`<form id="filters" class="filters" role="search" aria-label="Filter ${esc(d.noun)}s"><label>Service area<select name="region"><option value="">All published service areas</option><option>Cincinnati</option><option>Northern Kentucky</option></select></label><label>${esc(d.serviceLabel)}<select name="service"><option value="">Any listed service</option>${options(d.services)}</select></label>${category==='junk-removal'?`<label>Loading options<select name="loading"><option value="">Any loading arrangement</option>${options(['full-service','curbside','self-load'])}</select></label>`:''}<button type="reset">Reset filters</button></form>`;
    const disclaimer=`<aside class="notice">Provider-published information checked ${esc(data.checkedAt)}. Listings are alphabetical, unpaid and not endorsements. Service quality and current credentials have not been independently verified. Confirm your address, scope and final quote directly.</aside>`;
    const questions=`<section class="guide"><h2>Before you request a quote</h2><ol>${d.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ol></section>`;
    writeFileSync(join(out,category,'index.html'),shell(d.title,d.description,`<section class="hero"><span class="eyebrow">Northern Kentucky + Cincinnati · ${esc(d.label)}</span><h1>${d.headline}</h1><p class="lead">${esc(d.description)}</p><p>Browse freely. Contact providers directly.</p><a href="#${category==='junk-removal'?'municipal-pickup':'installation-checklist'}">${category==='junk-removal'?'Check municipal pickup options':'Read the installation checklist'}</a></section>${disclaimer}${filters}<p id="result-count" role="status" aria-live="polite">${rows.length} ${d.noun}s · alphabetical order</p><p class="small">Filters show only services and areas mentioned in the checked sources. Unknown does not mean unavailable.</p><div class="grid">${cards}</div><p id="no-results" hidden>No providers match those filters. Try a broader service or area.</p>${d.guide}${questions}<section class="business"><h2>Provide this service locally?</h2><p>Suggest your business or a correction for private editorial review.</p><a class="button" href="/directory/get-listed?category=${category}">Get listed</a></section>`,'',hub,category,d.noun));
    urls.push(hub);
    for(const l of rows){
      const body=`<p class="breadcrumb"><a href="${hub}">All ${d.noun}s</a> / ${esc(l.name)}</p><section class="hero compact"><span class="eyebrow">${esc(d.label)}</span><h1>${esc(l.name)}</h1><p class="lead">${esc(l.regions.join(' + '))}</p><a class="button" href="${esc(l.website)}" rel="noopener noreferrer" data-directory-contact="${esc(l.id)}">Visit provider &amp; request a quote <span aria-hidden="true">↗</span></a></section>${disclaimer}<section class="details"><h2>Compare the scope</h2><dl>${details(l)}</dl><h2>Sources and check dates</h2>${sourceList(l)}<p><a href="/directory/get-listed?category=${category}">Suggest a correction for review</a></p></section>${questions}<p><a href="${hub}#${category==='junk-removal'?'municipal-pickup':'installation-checklist'}">${category==='junk-removal'?'Check municipal pickup eligibility':'Check licensing, permits and inspection guidance'}</a></p>`;
      writeFileSync(join(out,category,l.id+'.html'),shell(l.name+' | '+d.label,`Published service and quote details for ${l.name}. Confirm availability, scope and current credentials directly.`,body,l.id,path(l),category,d.noun));
      urls.push(path(l));
    }
  }
  const sitemapPath=join(root,'sitemap.xml');
  const sitemap=readFileSync(sitemapPath,'utf8').replace(/\s*<!-- DIRECTORY CATEGORIES START -->[\s\S]*?<!-- DIRECTORY CATEGORIES END -->/,'');
  const block=`\n  <!-- DIRECTORY CATEGORIES START -->\n${urls.map(p=>`  <url><loc>https://jobhackai.io${p}</loc><changefreq>weekly</changefreq></url>`).join('\n')}\n  <!-- DIRECTORY CATEGORIES END -->\n`;
  writeFileSync(sitemapPath,sitemap.replace('</urlset>',block+'</urlset>'));
  console.log(`Built ${urls.length} additional directory pages and production sitemap entries.`);
}
