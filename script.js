const DB_NAME = 'project-hub-local';
const DB_VERSION = 3;
const projectsView = document.getElementById('projects-view');
const projectView = document.getElementById('project-view');
const projectList = document.getElementById('project-list');
const emptyProjects = document.getElementById('empty-projects');
const notice = document.getElementById('notice');
const projectForm = document.getElementById('project-form');
let db;
let activeProjectId = null;
let pendingSubmoduleModuleId = null;
let textEditField = 'details';
let projectLayout = 'grid';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('files')) {
        const files = database.createObjectStore('files', { keyPath: 'id' });
        files.createIndex('projectId', 'projectId', { unique: false });
        files.createIndex('taskId', 'taskId', { unique: false });
      } else {
        const files = request.transaction.objectStore('files');
        if (!files.indexNames.contains('taskId')) files.createIndex('taskId', 'taskId', { unique: false });
      }
      if (!database.objectStoreNames.contains('tasks')) {
        const tasks = database.createObjectStore('tasks', { keyPath: 'id' });
        tasks.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function requestResult(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function store(name, mode = 'readonly') { return db.transaction(name, mode).objectStore(name); }
function getProject(id = activeProjectId) { return requestResult(store('projects').get(id)); }
function getProjects() { return requestResult(store('projects').getAll()); }
function saveProject(project) { return requestResult(store('projects', 'readwrite').put(project)); }
function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => { notice.hidden = true; }, 4500);
}
function openDialog(id) { document.getElementById(id).showModal(); }
function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).format(date).replace(/ /g, '-');
}
function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
function createAction(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}
function setView(view) {
  projectLayout = view;
  projectList.classList.toggle('list-layout', view === 'list');
  document.getElementById('grid-view').classList.toggle('is-active', view === 'grid');
  document.getElementById('list-view').classList.toggle('is-active', view === 'list');
  document.getElementById('grid-view').setAttribute('aria-pressed', String(view === 'grid'));
  document.getElementById('list-view').setAttribute('aria-pressed', String(view === 'list'));
  try { localStorage.setItem('project-layout', view); } catch { /* Storage preference is optional. */ }
}
async function renderProjects() {
  const projects = (await getProjects()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  projectList.replaceChildren();
  emptyProjects.hidden = projects.length > 0;
  projects.forEach((project) => {
    const item = document.createElement('li'); item.className = 'project-card-item';
    const link = document.createElement('a'); link.className = 'project-card'; link.href = `#project-${encodeURIComponent(project.id)}`;
    const top = document.createElement('div'); top.className = 'card-topline';
    const name = document.createElement('h2'); name.textContent = project.name;
    const arrow = document.createElement('span'); arrow.className = 'card-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
    top.append(name, arrow);
    const dates = document.createElement('p'); dates.className = 'project-card-dates';
    if (project.startDate || project.endDate) dates.textContent = `${formatDate(project.startDate) || 'Start date not set'}${project.endDate ? ` – ${formatDate(project.endDate)}` : ''}`;
    else dates.textContent = 'Dates not set';
    const summary = document.createElement('p'); summary.className = 'project-card-summary'; summary.textContent = project.details || 'Open project workspace';
    link.append(top, dates, summary);
    link.addEventListener('click', async (event) => { event.preventDefault(); await selectProject(project.id); });
    item.append(link); projectList.append(item);
  });
}
async function selectProject(id) {
  const project = await getProject(id);
  if (!project) return;
  activeProjectId = id;
  projectsView.hidden = true; projectView.hidden = false;
  location.hash = `project-${encodeURIComponent(id)}`;
  renderProjectDetails(project);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderProjectDetails(project) {
  document.getElementById('project-title').textContent = project.name;
  const dates = [project.startDate && `Start: ${formatDate(project.startDate)}`, project.endDate && `End: ${formatDate(project.endDate)}`].filter(Boolean);
  document.getElementById('project-dates').textContent = dates.join(' · ') || 'No project dates set';
  renderTeam(project); renderModules(project); renderLinks(project); renderMilestones(project);
  const details = project.details || '';
  document.getElementById('details-content').textContent = details;
  document.getElementById('details-content').hidden = !details;
  document.getElementById('empty-details').hidden = Boolean(details);
  const defects = project.defectReport || '';
  document.getElementById('defects-content').textContent = defects;
  document.getElementById('defects-content').hidden = !defects;
  document.getElementById('empty-defects').hidden = Boolean(defects);
}
function renderTeam(project) {
  const list = document.getElementById('team-list'); list.replaceChildren();
  const people = project.team || [];
  document.getElementById('empty-team').hidden = people.length > 0;
  people.forEach((person, index) => {
    const item = document.createElement('li'); item.className = 'chip';
    const label = document.createElement('span'); label.textContent = person.name;
    const remove = createAction('Remove', 'mini-remove', () => updateProject((p) => { p.team.splice(index, 1); }));
    remove.setAttribute('aria-label', `Remove ${person.name}`); item.append(label, remove); list.append(item);
  });
}
function renderModules(project) {
  const list = document.getElementById('module-list'); list.replaceChildren();
  const modules = project.modules || [];
  document.getElementById('empty-modules').hidden = modules.length > 0;
  modules.forEach((module) => {
    const item = document.createElement('li'); item.className = 'module-item';
    const header = document.createElement('div'); header.className = 'module-header';
    const name = document.createElement('h3'); name.textContent = module.name;
    const actions = document.createElement('div'); actions.className = 'inline-actions';
    actions.append(createAction('Add submodule', 'text-button', () => { pendingSubmoduleModuleId = module.id; openDialog('submodule-dialog'); document.querySelector('#submodule-form [name="name"]').focus(); }));
    actions.append(createAction('Remove', 'text-button danger-text', () => updateProject((p) => { p.modules.splice(p.modules.findIndex((entry) => entry.id === module.id), 1); })));
    header.append(name, actions); item.append(header);
    const subs = document.createElement('ul'); subs.className = 'submodule-list';
    (module.submodules || []).forEach((sub, index) => {
      const subItem = document.createElement('li'); const subName = document.createElement('span'); subName.textContent = sub;
      const removeSub = createAction('×', 'mini-remove', () => updateProject((p) => { const target = p.modules.find((entry) => entry.id === module.id); if (target) target.submodules.splice(index, 1); }));
      removeSub.setAttribute('aria-label', `Remove submodule ${sub}`); subItem.append(subName, removeSub); subs.append(subItem);
    });
    if ((module.submodules || []).length === 0) { const empty = document.createElement('li'); empty.className = 'muted'; empty.textContent = 'No submodules yet.'; subs.append(empty); }
    item.append(subs); list.append(item);
  });
}
function renderLinks(project) {
  const list = document.getElementById('link-list'); list.replaceChildren();
  const links = project.links || [];
  document.getElementById('empty-links').hidden = links.length > 0;
  links.forEach((entry, index) => {
    const item = document.createElement('li'); item.className = 'resource-row';
    const link = document.createElement('a'); link.href = safeUrl(entry.url) || '#'; link.textContent = entry.label; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const remove = createAction('Remove', 'mini-remove', () => updateProject((p) => { p.links.splice(index, 1); }));
    remove.setAttribute('aria-label', `Remove link ${entry.label}`); item.append(link, remove); list.append(item);
  });
}
function renderMilestones(project) {
  const list = document.getElementById('milestone-list'); list.replaceChildren();
  const milestones = project.milestones || [];
  document.getElementById('empty-milestones').hidden = milestones.length > 0;
  milestones.forEach((milestone, index) => {
    const item = document.createElement('li'); item.className = 'milestone-item';
    const number = document.createElement('span'); number.className = 'milestone-number'; number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('strong'); title.textContent = milestone.name;
    item.append(number, title);
    if (milestone.url && safeUrl(milestone.url)) { const link = document.createElement('a'); link.href = safeUrl(milestone.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open link'; item.append(link); }
    item.append(createAction('Remove', 'mini-remove', () => updateProject((p) => { p.milestones.splice(index, 1); })));
    list.append(item);
  });
}
async function updateProject(mutator) {
  const project = await getProject(); if (!project) return;
  mutator(project); project.updatedAt = Date.now(); await saveProject(project); renderProjectDetails(project); await renderProjects();
}
document.getElementById('open-create-project').addEventListener('click', () => {
  projectForm.reset(); projectForm.dataset.editId = ''; document.getElementById('project-dialog-title').textContent = 'Create project';
  projectForm.querySelector('[type="submit"]').textContent = 'Save project'; openDialog('project-dialog'); projectForm.elements.name.focus();
});
document.getElementById('edit-project').addEventListener('click', async () => {
  const project = await getProject(); if (!project) return;
  projectForm.reset(); projectForm.dataset.editId = project.id; projectForm.elements.name.value = project.name;
  projectForm.elements.startDate.value = project.startDate || ''; projectForm.elements.endDate.value = project.endDate || '';
  document.getElementById('project-dialog-title').textContent = 'Edit project'; projectForm.querySelector('[type="submit"]').textContent = 'Save changes'; openDialog('project-dialog');
});
projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = projectForm.elements.name.value.trim();
  if (!name) return;
  const startDate = projectForm.elements.startDate.value; const endDate = projectForm.elements.endDate.value;
  if (startDate && endDate && endDate < startDate) { projectForm.elements.endDate.setCustomValidity('End date must be on or after the start date.'); projectForm.elements.endDate.reportValidity(); projectForm.elements.endDate.setCustomValidity(''); return; }
  const editId = projectForm.dataset.editId;
  const existing = editId ? await getProject(editId) : null;
  const project = { ...(existing || {}), id: editId || crypto.randomUUID(), name, startDate, endDate, team: existing?.team || [], details: existing?.details || '', modules: existing?.modules || [], defectReport: existing?.defectReport || '', links: existing?.links || [], milestones: existing?.milestones || [], createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() };
  await saveProject(project); document.getElementById('project-dialog').close();
  if (editId) { renderProjectDetails(project); await renderProjects(); showNotice('Project updated.'); }
  else { await renderProjects(); await selectProject(project.id); showNotice('Project created. Add team resources and project information.'); }
});
document.getElementById('back-to-projects').addEventListener('click', async () => { activeProjectId = null; projectView.hidden = true; projectsView.hidden = false; history.replaceState(null, '', location.pathname + location.search); await renderProjects(); });
document.getElementById('grid-view').addEventListener('click', () => setView('grid'));
document.getElementById('list-view').addEventListener('click', () => setView('list'));

document.getElementById('add-resource').addEventListener('click', () => { document.getElementById('resource-form').reset(); openDialog('resource-dialog'); document.querySelector('#resource-form [name="name"]').focus(); });
document.getElementById('resource-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const name = event.currentTarget.elements.name.value.trim(); if (!name) return;
  await updateProject((p) => { p.team ||= []; p.team.push({ id: crypto.randomUUID(), name }); });
  event.currentTarget.closest('dialog').close(); event.currentTarget.reset(); showNotice('Team resource added.');
});
document.getElementById('edit-details').addEventListener('click', async () => {
  textEditField = 'details'; const p = await getProject(); document.getElementById('text-dialog-title').textContent = 'Project details';
  document.getElementById('text-field-label').firstChild.textContent = 'Project details'; document.querySelector('#text-form [name="text"]').value = p?.details || ''; openDialog('text-dialog');
});
document.getElementById('edit-defects').addEventListener('click', async () => {
  textEditField = 'defectReport'; const p = await getProject(); document.getElementById('text-dialog-title').textContent = 'Defect report';
  document.getElementById('text-field-label').firstChild.textContent = 'Defect report'; document.querySelector('#text-form [name="text"]').value = p?.defectReport || ''; openDialog('text-dialog');
});
document.getElementById('text-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const value = event.currentTarget.elements.text.value.trim();
  await updateProject((p) => { p[textEditField] = value; }); event.currentTarget.closest('dialog').close(); showNotice(textEditField === 'details' ? 'Project details saved.' : 'Defect report saved.');
});
document.getElementById('add-module').addEventListener('click', () => { document.getElementById('module-form').reset(); openDialog('module-dialog'); document.querySelector('#module-form [name="name"]').focus(); });
document.getElementById('module-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const name = event.currentTarget.elements.name.value.trim(); if (!name) return;
  const submodules = event.currentTarget.elements.submodules.value.split('\n').map((item) => item.trim()).filter(Boolean);
  await updateProject((p) => { p.modules ||= []; p.modules.push({ id: crypto.randomUUID(), name, submodules }); });
  event.currentTarget.closest('dialog').close(); event.currentTarget.reset(); showNotice('Module added.');
});
document.getElementById('submodule-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const name = event.currentTarget.elements.name.value.trim(); if (!name || !pendingSubmoduleModuleId) return;
  await updateProject((p) => { const module = p.modules.find((entry) => entry.id === pendingSubmoduleModuleId); if (module) { module.submodules ||= []; module.submodules.push(name); } });
  pendingSubmoduleModuleId = null; event.currentTarget.closest('dialog').close(); event.currentTarget.reset(); showNotice('Submodule added.');
});
document.getElementById('add-link').addEventListener('click', () => { document.getElementById('link-form').reset(); openDialog('link-dialog'); document.querySelector('#link-form [name="label"]').focus(); });
document.getElementById('link-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const label = event.currentTarget.elements.label.value.trim(); const url = safeUrl(event.currentTarget.elements.url.value.trim());
  if (!label || !url) { event.currentTarget.elements.url.setCustomValidity('Enter a valid http or https URL.'); event.currentTarget.elements.url.reportValidity(); event.currentTarget.elements.url.setCustomValidity(''); return; }
  await updateProject((p) => { p.links ||= []; p.links.push({ id: crypto.randomUUID(), label, url }); });
  event.currentTarget.closest('dialog').close(); event.currentTarget.reset(); showNotice('IMP link added.');
});
document.getElementById('add-milestone').addEventListener('click', () => { document.getElementById('milestone-form').reset(); openDialog('milestone-dialog'); document.querySelector('#milestone-form [name="name"]').focus(); });
document.getElementById('milestone-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const name = event.currentTarget.elements.name.value.trim(); const rawUrl = event.currentTarget.elements.url.value.trim();
  const url = rawUrl ? safeUrl(rawUrl) : '';
  if (!name || (rawUrl && !url)) { if (rawUrl && !url) { event.currentTarget.elements.url.setCustomValidity('Enter a valid http or https URL.'); event.currentTarget.elements.url.reportValidity(); event.currentTarget.elements.url.setCustomValidity(''); } return; }
  await updateProject((p) => { p.milestones ||= []; p.milestones.push({ id: crypto.randomUUID(), name, url }); });
  event.currentTarget.closest('dialog').close(); event.currentTarget.reset(); showNotice('Milestone added.');
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));

(async function initialize() {
  try {
    db = await openDatabase();
    try { setView(localStorage.getItem('project-layout') === 'list' ? 'list' : 'grid'); } catch { setView('grid'); }
    await renderProjects();
    if (location.hash.startsWith('#project-')) {
      const id = decodeURIComponent(location.hash.slice('#project-'.length)); await selectProject(id);
    }
  } catch (error) { console.error(error); showNotice('Could not open project storage. Check browser privacy settings and reload.'); }
})();
