/* ====================
   Data & Services
   ==================== */
const Store = {
  get(key, fallback){ try{ return JSON.parse(localStorage.getItem(key)) ?? fallback }catch{ return fallback } },
  set(key, value){ localStorage.setItem(key, JSON.stringify(value)); },
  del(key){ localStorage.removeItem(key) }
};

const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();
const daysFromNow = (hours)=> new Date(Date.now() + hours*3600000).toISOString();
const priorityRank = p => ({Low:1, Medium:2, High:3, Urgent:4}[p]||0);

const Plans = {
  Free: { ticketLimit: 25, cannedLimit: 3 },
  Pro:  { ticketLimit: Infinity, cannedLimit: Infinity },
  Team: { ticketLimit: Infinity, cannedLimit: Infinity }
};

const AppState = {
  settings: Store.get('settings', { fromName:'Your Support', fromEmail:'support@example.com', signature:'Thanks,\nSupport Team' }),
  plan: Store.get('plan', 'Free'),
  users: Store.get('users', [ { id: 'u-admin', name: 'Admin', email: 'admin@example.com' } ]),
  tickets: Store.get('tickets', []),
  canned: Store.get('canned', [
    { id: uid(), title: 'Welcome', shortcut: '/welcome', body: 'Hi {{name}},\n\nThanks for reaching out! We\'re on it.\n\n— {{agent}}' },
  ]),
  inbox: Store.get('inbox', []),
  drafts: Store.get('drafts', {})
};

function saveAll(){
  Store.set('settings', AppState.settings);
  Store.set('plan', AppState.plan);
  Store.set('users', AppState.users);
  Store.set('tickets', AppState.tickets);
  Store.set('canned', AppState.canned);
  Store.set('inbox', AppState.inbox);
  Store.set('drafts', AppState.drafts);
}

/* ====================
   DOM Helpers
   ==================== */
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];
const toast = (msg)=>{ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'), 1600) }
const fmt = (iso)=> new Date(iso).toLocaleString();

/* ====================
   Tickets
   ==================== */
function createTicket({to, subject, body, priority, tags, slaHrs, assignTo, starred}){
  const limit = Plans[AppState.plan].ticketLimit;
  if(AppState.tickets.length >= limit){ toast('Ticket limit reached. Upgrade to create more.'); return null }

  const t = {
    id: uid(),
    subject,
    customer: to,
    priority,
    tags: (tags||[]).filter(Boolean),
    status: 'Open',
    createdAt: now(),
    updatedAt: now(),
    dueAt: daysFromNow(slaHrs || 24),
    starred: !!starred,
    assignedTo: assignTo || null,
    messages: [{ from: AppState.settings.fromEmail, body, at: now() }],
    firstReplyMins: Math.round((Math.random()*30)+5)
  };
  AppState.tickets.unshift(t);
  // also push to inbox simulation
  AppState.inbox.unshift({ id: uid(), subject, from: AppState.settings.fromEmail, to, body, at: now(), starred: !!starred });
  saveAll();
  return t;
}

function updateTicketStatus(ids, status){
  if(!ids.length) return toast('No tickets selected');
  AppState.tickets = AppState.tickets.map(t=> ids.includes(t.id) ? ({...t, status, updatedAt: now()}) : t);
  saveAll(); renderTickets(); renderPipeline();
}

function snoozeTickets(ids, hours){
  if(!ids.length) return toast('No tickets selected');
  AppState.tickets = AppState.tickets.map(t=> ids.includes(t.id) ? ({...t, status:'Snoozed', dueAt: daysFromNow(hours), updatedAt: now()}) : t);
  saveAll(); renderTickets(); renderPipeline();
}

function exportTicketsCSV(){
  const rows = [ ['id','subject','customer','status','priority','tags','dueAt','updatedAt'] ]
    .concat(AppState.tickets.map(t=> [t.id, t.subject, t.customer, t.status, t.priority, (t.tags||[]).join('|'), t.dueAt, t.updatedAt]));
  const csv = rows.map(r=> r.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='tickets.csv'; a.click();
}

/* ====================
   Canned Replies
   ==================== */
function addCanned(title, shortcut, body){
  const limit = Plans[AppState.plan].cannedLimit;
  if(AppState.canned.length >= limit){ toast('Canned limit reached on current plan.'); return }
  AppState.canned.unshift({ id: uid(), title, shortcut, body }); saveAll(); renderCanned();
}

function exportCanned(){
  const blob = new Blob([JSON.stringify(AppState.canned,null,2)], {type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='canned.json'; a.click();
}

function importCanned(file){
  const reader = new FileReader(); reader.onload = () => {
    try{
      const items = JSON.parse(reader.result);
      if(!Array.isArray(items)) throw new Error('Invalid JSON');
      items.forEach(it=> addCanned(it.title, it.shortcut, it.body));
      toast('Imported canned replies');
    }catch(e){ alert('Import failed: '+e.message) }
  };
  reader.readAsText(file);
}

/* ====================
   Rendering
   ==================== */
function updatePlanUI(){
  $('#planBadge').textContent = 'Plan: ' + AppState.plan;
  $('#upgradeBtn').classList.toggle('hidden', AppState.plan !== 'Free');
}

function renderTickets(){
  const tbody = $('#ticketsTable tbody');
  const q = ($('#globalSearch').value||'').toLowerCase();
  const status = $('#statusFilter').value;
  const prio = $('#priorityFilter').value;
  const sort = $('#sortSelect').value;

  let list = [...AppState.tickets].filter(t=> {
    const hay = (t.subject + ' ' + t.customer + ' ' + (t.tags||[]).join(' ')).toLowerCase();
    const matches = hay.includes(q);
    const matchesStatus = !status || t.status === status;
    const matchesPrio = !prio || t.priority === prio;
    return matches && matchesStatus && matchesPrio;
  });

  list.sort((a,b)=>{
    const [key, dir] = sort.split('-');
    const d = dir==='asc' ? 1 : -1;
    if(key==='priority'){ return (priorityRank(a.priority) - priorityRank(b.priority)) * d }
    if(key==='dueAt'){ return (new Date(a.dueAt) - new Date(b.dueAt)) * d }
    if(key==='updatedAt'){ return (new Date(a.updatedAt) - new Date(b.updatedAt)) * d }
    return 0;
  });

  tbody.innerHTML = list.map(t=> `
    <tr>
      <td><input type="checkbox" data-id="${t.id}"></td>
      <td>${t.starred ? '⭐ ' : ''}${t.subject}</td>
      <td>${t.customer}</td>
      <td><span class="chip ${t.status==='Open'?'ok': t.status==='Pending'?'warn': t.status==='Closed'?'danger':'warn'}">${t.status}</span></td>
      <td>${t.priority}</td>
      <td>${(t.tags||[]).map(x=>`<span class="tag">${x}</span>`).join(' ')}</td>
      <td>${fmt(t.dueAt)}</td>
      <td>${fmt(t.updatedAt)}</td>
    </tr>
  `).join('');

  // Metrics
  const open = AppState.tickets.filter(t=> t.status==='Open').length;
  const atRisk = AppState.tickets.filter(t=> (new Date(t.dueAt) - Date.now()) < (2*3600000) && t.status!=='Closed').length;
  $('#metric-open').textContent = open + ' open';
  $('#metric-sla').textContent = 'SLA at risk: ' + atRisk;
  const afr = Math.round((AppState.tickets.reduce((s,t)=> s + (t.firstReplyMins||0), 0) / (AppState.tickets.length||1)));
  $('#metric-avg').textContent = 'Avg. First Reply: ' + (isNaN(afr)?'—': (afr+' mins'));

  // Today stats
  const today = new Date().toDateString();
  const createdToday = AppState.tickets.filter(t=> new Date(t.createdAt).toDateString() === today).length;
  const closedToday = AppState.tickets.filter(t=> new Date(t.updatedAt).toDateString() === today && t.status==='Closed').length;
  $('#todayStats').textContent = `${createdToday} created • ${closedToday} closed today`;

  // Pipeline tiles
  renderPipeline();
}

function renderCanned(){
  const target = $('#cannedList');
  if(!AppState.canned.length){ target.textContent='No canned replies yet.'; return }
  target.innerHTML = AppState.canned.map(c=>`
    <div class="panel" style="margin:8px 0">
      <div class="panel-header">
        <strong>${c.title}</strong> <span class="chip">${c.shortcut}</span>
        <div class="row">
          <button class="btn" data-copy="${c.id}">Copy</button>
          <button class="btn danger" data-del="${c.id}">Delete</button>
        </div>
      </div>
      <div class="panel-body"><pre style="white-space:pre-wrap; margin:0">${c.body}</pre></div>
    </div>
  `).join('');
}

function renderInbox(){
  const q = ($('#inboxSearch').value||'').toLowerCase();
  const list = AppState.inbox.filter(m=> (m.subject + ' ' + m.from + ' ' + m.to + ' ' + m.body).toLowerCase().includes(q));
  $('#inboxList').innerHTML = list.map(m=> `
    <div class="panel" style="margin:8px 0">
      <div class="panel-header">
        <strong>${m.subject}</strong>
        <span class="chip">from: ${m.from}</span>
        <span class="chip">to: ${m.to}</span>
        ${m.starred?'⭐':''}
        <div class="row"><span class="chip">${fmt(m.at)}</span></div>
      </div>
      <div class="panel-body">${m.body.replace(/\n/g,'<br>')}</div>
    </div>
  `).join('') || 'No messages.';
}

function renderSettings(){
  $('#set-fromName').value = AppState.settings.fromName;
  $('#set-fromEmail').value = AppState.settings.fromEmail;
  $('#set-signature').value = AppState.settings.signature;
}

/* ====================
   Pipelines (Drag & Drop)
   ==================== */
function renderPipeline(){
  // Clear dropzones
  ['stage-open','stage-pending','stage-closed'].forEach(id=> $('#'+id).innerHTML='');
  AppState.tickets.forEach(t=>{
    const el = document.createElement('div');
    el.className = 'card';
    el.draggable = true;
    el.dataset.id = t.id;
    el.innerHTML = `<strong>${t.subject}</strong><div class="row"><span class="tag">${t.priority}</span>${(t.tags||[]).slice(0,2).map(x=>`<span class="tag">${x}</span>`).join('')}</div>`;
    el.addEventListener('dragstart', e=> { e.dataTransfer.setData('text/plain', t.id); });
    if(t.status==='Open') $('#stage-open').appendChild(el);
    else if(t.status==='Pending') $('#stage-pending').appendChild(el);
    else if(t.status==='Closed') $('#stage-closed').appendChild(el);
  });
}

['stage-open','stage-pending','stage-closed'].forEach(id=>{
  const zone = $('#'+id);
  zone.addEventListener('dragover', e=> e.preventDefault());
  zone.addEventListener('drop', e=>{
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const t = AppState.tickets.find(x=> x.id===id);
    if(!t) return;
    const newStatus = zone.id==='stage-open' ? 'Open' : zone.id==='stage-pending' ? 'Pending' : 'Closed';
    t.status = newStatus; t.updatedAt = now(); saveAll(); renderTickets();
  });
});

/* ====================
   View Router
   ==================== */
function view(name){
  $$('.nav .item').forEach(it=> it.classList.toggle('active', it.dataset.view===name));
  ['dashboard','inbox','compose','canned','pipelines','analytics','settings','pricing','about'].forEach(v=>{
    $('#view-'+v).classList.toggle('hidden', v!==name);
  });
  if(name==='dashboard'){ renderTickets() }
  if(name==='canned'){ renderCanned() }
  if(name==='inbox'){ renderInbox() }
  if(name==='settings'){ renderSettings() }
  if(name==='pipelines'){ renderPipeline() }
}

/* ====================
   Event bindings
   ==================== */
// Sidebar nav
$$('.nav .item').forEach(it=> it.addEventListener('click', ()=> view(it.dataset.view)) );

// Theme
$('#themeToggle').addEventListener('click', ()=>{
  const root = $('#app');
  root.dataset.theme = (root.dataset.theme === 'dark') ? 'light' : 'dark';
});

// Filters & search
['globalSearch','statusFilter','priorityFilter','sortSelect'].forEach(id=> $('#'+id).addEventListener('input', renderTickets));

// Select all
$('#selectAll').addEventListener('change', (e)=> {
  $$('#ticketsTable tbody input[type="checkbox"]').forEach(cb=> cb.checked = e.target.checked);
});

// Helpers
const selectedTicketIds = ()=> $$('#ticketsTable tbody input[type="checkbox"]:checked').map(cb=> cb.dataset.id);

// Quick actions
$('#quickOpen').addEventListener('click', ()=> updateTicketStatus(selectedTicketIds(),'Open'));
$('#quickPending').addEventListener('click', ()=> updateTicketStatus(selectedTicketIds(),'Pending'));
$('#quickClose').addEventListener('click', ()=> updateTicketStatus(selectedTicketIds(),'Closed'));
$('#quickSnooze').addEventListener('click', ()=> snoozeTickets(selectedTicketIds(), 24));

// Export
$('#exportCsvBtn').addEventListener('click', exportTicketsCSV);

// Compose actions
$('#insertCanned').addEventListener('click', ()=>{
  if(!AppState.canned.length) return alert('No canned replies yet.');
  const choice = prompt('Type shortcut to insert (e.g., /welcome)') || '';
  const c = AppState.canned.find(x=> x.shortcut === choice.trim());
  if(!c) return alert('Not found.');
  const agent = 'Agent';
  const body = c.body.replaceAll('{{agent}}', agent).replaceAll('{{name}}', ($('#to').value||'Customer'));
  $('#body').value = ($('#body').value + '\n\n' + body).trim();
});

function readCompose(){
  return {
    to: $('#to').value.trim(),
    subject: $('#subject').value.trim(),
    body: ($('#body').value + '\n\n' + AppState.settings.signature).trim(),
    priority: $('#priority').value,
    tags: ($('#tags').value||'').split(',').map(s=> s.trim()).filter(Boolean),
    slaHrs: parseInt($('#slaHours').value||'24',10),
    assignTo: $('#assignTo').value || null,
    starred: $('#starred').checked
  }
}

function clearCompose(){ ['to','subject','body','tags'].forEach(id=> $('#'+id).value=''); $('#starred').checked=false }

$('#sendBtn').addEventListener('click', ()=>{
  const data = readCompose(); if(!data.to || !data.subject) return alert('To and Subject are required');
  const t = createTicket(data);
  if(t){ toast('Sent & ticket created'); clearCompose(); renderTickets(); renderInbox(); view('dashboard') }
});

$('#saveDraft').addEventListener('click', ()=>{ AppState.drafts['compose']=readCompose(); saveAll(); toast('Draft saved') });
$('#loadDraft').addEventListener('click', ()=>{
  const d = AppState.drafts['compose']; if(!d) return toast('No draft');
  $('#to').value=d.to||''; $('#subject').value=d.subject||''; $('#body').value=d.body?.replace(AppState.settings.signature,'')||''; $('#priority').value=d.priority||'Medium'; $('#tags').value=(d.tags||[]).join(', '); $('#slaHours').value=d.slaHrs||24; $('#starred').checked=!!d.starred;
  toast('Draft loaded');
});
$('#clearDraft').addEventListener('click', ()=>{ delete AppState.drafts['compose']; saveAll(); toast('Draft cleared') });

// Canned
$('#addCanned').addEventListener('click', ()=>{
  const t = $('#cannedTitle').value.trim();
  const s = $('#cannedShortcut').value.trim();
  const b = $('#cannedBody').value.trim();
  if(!t || !s || !b) return alert('Fill in title, shortcut, and body.');
  addCanned(t,s,b); $('#cannedTitle').value=''; $('#cannedShortcut').value=''; $('#cannedBody').value=''; toast('Canned added');
});
$('#cannedList').addEventListener('click', (e)=>{
  const copyId = e.target.getAttribute('data-copy');
  const delId = e.target.getAttribute('data-del');
  if(copyId){
    const c = AppState.canned.find(x=> x.id===copyId);
    navigator.clipboard.writeText(c.body); toast('Copied to clipboard');
  }
  if(delId){ AppState.canned = AppState.canned.filter(x=> x.id!==delId); saveAll(); renderCanned(); toast('Deleted') }
});
$('#exportCanned').addEventListener('click', exportCanned);
$('#importCanned').addEventListener('change', (e)=>{ const f=e.target.files?.[0]; if(f) importCanned(f) });

// Inbox
$('#refreshInbox').addEventListener('click', renderInbox);

// Pricing
$('#view-pricing').addEventListener('click', (e)=>{
  const plan = e.target.getAttribute('data-plan');
  if(!plan) return;
  AppState.plan = plan; saveAll(); updatePlanUI(); toast('Plan set to '+plan);
});

// Upgrade button
$('#upgradeBtn').addEventListener('click', ()=> view('pricing') );

// Populate assignees
$('#assignTo').innerHTML = AppState.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');

// Global keyboard shortcut for canned insertion (type /shortcut in body)
$('#body').addEventListener('keydown', (e)=>{
  if(e.key===' ' || e.key==='Enter'){
    const val = e.target.value;
    const m = val.match(/\/(\w+)$/);
    if(m){
      const shortcut = '/'+m[1];
      const c = AppState.canned.find(x=> x.shortcut===shortcut);
      if(c){
        const agent = 'Agent';
        const body = c.body.replaceAll('{{agent}}', agent).replaceAll('{{name}}', ($('#to').value||'Customer'));
        e.target.value = val.replace(/\/(\w+)$/, body + '\n');
      }
    }
  }
});

// Modal — Quick Create Ticket
const modal = $('#ticketModal');
const openModal = ()=> modal.classList.remove('hidden');
const closeModal = ()=> modal.classList.add('hidden');
$('#newTicketBtn').addEventListener('click', openModal);
$('#modalClose').addEventListener('click', closeModal);
$('#modalCancel').addEventListener('click', closeModal);
$('#modalCreate').addEventListener('click', ()=>{
  const data = {
    to: $('#m_to').value.trim(),
    subject: $('#m_subject').value.trim(),
    body: $('#m_body').value.trim(),
    priority: $('#m_priority').value,
    tags: ($('#m_tags').value||'').split(',').map(s=> s.trim()).filter(Boolean),
    slaHrs: parseInt($('#m_sla').value||'24',10),
    assignTo: AppState.users[0]?.id,
    starred: false
  };
  if(!data.to || !data.subject) return alert('Email and Subject required');
  const t = createTicket(data);
  if(t){ toast('Ticket created'); renderTickets(); renderInbox(); closeModal();
    // reset fields
    ['m_to','m_subject','m_body','m_tags'].forEach(id=> $('#'+id).value=''); $('#m_priority').value='Medium'; $('#m_sla').value='24';
  }
});

// Initial seed if empty
if(AppState.tickets.length === 0){
  ['Password reset not working','Billing issue: double charge','Feature request: dark mode','Unable to login on mobile'].forEach((s,i)=>{
    createTicket({
      to: ['sam@acme.com','lisa@blue.co','ceo@start.io','mike@retail.me'][i],
      subject: s,
      body: 'Hi, we\'re investigating this issue and will update you shortly.',
      priority: ['Low','Medium','High','Urgent'][i%4],
      tags: ['onboarding','billing','feature','bug'][i%4].split(','),
      slaHrs: [72,48,24,8][i%4],
      assignTo: AppState.users[0].id,
      starred: i===2
    });
  });
}

// Boot
updatePlanUI();
renderTickets();
renderInbox();
renderCanned();
renderSettings();
view('dashboard');
