const DB_NAME = 'project-hub-local';
const DB_VERSION = 3;
const $ = (selector, root = document) => root.querySelector(selector);
const projectsView = $('#projects-view');
const projectView = $('#project-view');
const projectList = $('#project-list');
const notice = $('#notice');
const projectForm = $('#project-form');
let db;
let activeProjectId = null;
let pendingSubmoduleModuleId = null;
let textEditField = 'details';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB is unavailable')); return; }
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
    request.onsuccess = () => { const database = request.result; database.onversionchange = () => database.close(); resolve(database); };
    request.onerror = () => reject(request.error || new Error('Unable to open local project storage'));
    request.onblocked = () => reject(new Error('Project storage is busy in another open tab. Close other app tabs and reload.'));
  });
}
function dbRequest(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('Storage request failed')); });
}
function store(name, mode = 'readonly') { return db.transaction(name, mode).objectStore(name); }
function id() { return globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function showNotice(message, isError = false) {
  notice.textContent = message; notice.hidden = false; notice.classList.toggle('notice-error', isError);
  clearTimeout(showNotice.timer); showNotice.timer = setTimeout(() => { notice.hidden = true; }, 7000);
}
function readForm(form) { return Object.fromEntries(new FormData(form).entries()); }
function readNamed(form, name) { return form.querySelector(`[name="${name}"]`); }
function openDialog(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}
function closeDialog(dialog) { if (typeof dialog.close === 'function' && dialog.open) dialog.close(); else dialog.removeAttribute('open'); }
function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).format(date).replace(/ /g, '-');
}
function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
function readableStatus(status) { return ({ planning: 'Planning', 'in-progress': 'In progress', 'on-hold': 'On hold', complete: 'Complete' })[status] || 'Planning'; }
function createAction(label, className, handler, ariaLabel = '') {
  const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = label;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', handler); return button;
}
async function getProject(projectId = activeProjectId) { return dbRequest(store('projects').get(projectId)); }
async function getProjects() { return dbRequest(store('projects').getAll()); }
async function saveProject(project) { return dbRequest(store('projects', 'readwrite').put(project)); }
function setView(view) {
  projectList.classList.toggle('list-layout', view === 'list');
  $('#grid-view').classList.toggle('is-active', view === 'grid'); $('#list-view').classList.toggle('is-active', view === 'list');
  $('#grid-view').setAttribute('aria-pressed', String(view === 'grid')); $('#list-view').setAttribute('aria-pressed', String(view === 'list'));
  try { localStorage.setItem('project-layout', view); } catch { /* Optional preference */ }
}
async function renderProjects() {
  const projects = (await getProjects()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const query = $('#project-search').value.trim().toLocaleLowerCase(); const status = $('#status-filter').value;
  const filtered = projects.filter((project) => project.name.toLocaleLowerCase().includes(query) && (status === 'all' || (project.status || 'planning') === status));
  projectList.replaceChildren(); $('#empty-projects').hidden = projects.length > 0; $('#empty-filter-results').hidden = !projects.length || filtered.length > 0;
  filtered.forEach((project) => {
    const item = document.createElement('li'); item.className = 'project-card-item';
    const link = document.createElement('a'); link.className = 'project-card'; link.href = `#project-${encodeURIComponent(project.id)}`;
    const top = document.createElement('div'); top.className = 'card-topline'; const name = document.createElement('h2'); name.textContent = project.name;
    const badge = document.createElement('span'); badge.className = `status-badge status-${project.status || 'planning'}`; badge.textContent = readableStatus(project.status); top.append(name, badge);
    const dates = document.createElement('p'); dates.className = 'project-card-dates'; dates.textContent = project.startDate || project.endDate ? `${formatDate(project.startDate) || 'Start date not set'}${project.endDate ? ` – ${formatDate(project.endDate)}` : ''}` : 'Dates not set';
    const summary = document.createElement('p'); summary.className = 'project-card-summary'; summary.textContent = project.details || 'Open project workspace';
    link.append(top, dates, summary); link.addEventListener('click', async (event) => { event.preventDefault(); await selectProject(project.id); }); item.append(link); projectList.append(item);
  });
}
async function selectProject(projectId) {
  const project = await getProject(projectId); if (!project) { showNotice('That project could not be found in this browser.', true); return; }
  activeProjectId = projectId; projectsView.hidden = true; projectView.hidden = false;
  try { history.replaceState(null, '', `${location.pathname}${location.search}#project-${encodeURIComponent(projectId)}`); } catch { location.hash = `project-${encodeURIComponent(projectId)}`; }
  renderProjectDetails(project); window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderProjectDetails(project) {
  $('#project-title').textContent = project.name;
  const badge = $('#project-status'); badge.textContent = readableStatus(project.status); badge.className = `status-badge status-${project.status || 'planning'}`;
  $('#project-dates').textContent = [project.startDate && `Start: ${formatDate(project.startDate)}`, project.endDate && `End: ${formatDate(project.endDate)}`].filter(Boolean).join(' · ') || 'No project dates set';
  renderTeam(project); renderModules(project); renderLinks(project); renderMilestones(project);
  for (const [field, emptyId] of [['details', 'empty-details'], ['defectReport', 'empty-defects']]) {
    const element = field === 'details' ? $('#details-content') : $('#defects-content'); const value = project[field] || '';
    element.textContent = value; element.hidden = !value; $(`#${emptyId}`).hidden = Boolean(value);
  }
}
function renderTeam(project) {
  const list = $('#team-list'); list.replaceChildren(); const people = project.team || []; $('#empty-team').hidden = people.length > 0;
  people.forEach((person) => {
    const item = document.createElement('li'); item.className = 'chip'; const label = document.createElement('span'); label.textContent = person.name;
    item.append(label, createAction('Edit', 'mini-remove', async () => { const name = prompt('Update resource name:', person.name); if (name?.trim()) await updateProject((p) => { const entry = p.team.find((resource) => resource.id === person.id); if (entry) entry.name = name.trim(); }); }, `Edit ${person.name}`));
    item.append(createAction('Remove', 'mini-remove', () => updateProject((p) => { p.team = p.team.filter((resource) => resource.id !== person.id); }), `Remove ${person.name}`)); list.append(item);
  });
}
function renderModules(project) {
  const list = $('#module-list'); list.replaceChildren(); const modules = project.modules || []; $('#empty-modules').hidden = modules.length > 0;
  modules.forEach((module) => {
    const item = document.createElement('li'); item.className = 'module-item'; const header = document.createElement('div'); header.className = 'module-header'; const name = document.createElement('h3'); name.textContent = module.name;
    const actions = document.createElement('div'); actions.className = 'inline-actions';
    actions.append(createAction('Edit', 'text-button', async () => { const moduleName = prompt('Module name:', module.name); if (moduleName === null) return; const subs = prompt('Submodules (one per line):', (module.submodules || []).join('\n')); if (subs === null) return; await updateProject((p) => { const target = p.modules.find((entry) => entry.id === module.id); if (target) { target.name = moduleName.trim() || target.name; target.submodules = subs.split('\n').map((part) => part.trim()).filter(Boolean); } }); }));
    actions.append(createAction('Add submodule', 'text-button', () => { pendingSubmoduleModuleId = module.id; $('#submodule-form').reset(); openDialog('submodule-dialog'); readNamed($('#submodule-form'), 'name').focus(); }));
    actions.append(createAction('Remove', 'text-button danger-text', () => updateProject((p) => { p.modules = p.modules.filter((entry) => entry.id !== module.id); })));
    header.append(name, actions); item.append(header); const subs = document.createElement('ul'); subs.className = 'submodule-list';
    (module.submodules || []).forEach((sub, index) => { const subItem = document.createElement('li'); const subName = document.createElement('span'); subName.textContent = sub; subItem.append(subName, createAction('Edit', 'mini-remove', async () => { const value = prompt('Submodule name:', sub); if (value?.trim()) await updateProject((p) => { const target = p.modules.find((entry) => entry.id === module.id); if (target) target.submodules[index] = value.trim(); }); }), createAction('×', 'mini-remove', () => updateProject((p) => { const target = p.modules.find((entry) => entry.id === module.id); if (target) target.submodules.splice(index, 1); }), `Remove submodule ${sub}`)); subs.append(subItem); });
    if (!module.submodules?.length) { const empty = document.createElement('li'); empty.className = 'muted'; empty.textContent = 'No submodules yet.'; subs.append(empty); } item.append(subs); list.append(item);
  });
}
function renderLinks(project) {
  const list = $('#link-list'); list.replaceChildren(); const links = project.links || []; $('#empty-links').hidden = links.length > 0;
  links.forEach((entry) => { const item = document.createElement('li'); item.className = 'resource-row'; const link = document.createElement('a'); link.href = safeUrl(entry.url) || '#'; link.textContent = entry.label; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const actions = document.createElement('div'); actions.className = 'inline-actions'; actions.append(createAction('Edit', 'mini-remove', async () => { const label = prompt('Visual text:', entry.label); if (label === null) return; const urlValue = prompt('URL (http or https):', entry.url); if (urlValue === null) return; const url = safeUrl(urlValue.trim()); if (!url) { showNotice('Please enter a valid http or https URL.', true); return; } await updateProject((p) => { const target = p.links.find((linkEntry) => linkEntry.id === entry.id); if (target) { target.label = label.trim() || target.label; target.url = url; } }); })); actions.append(createAction('Remove', 'mini-remove', () => updateProject((p) => { p.links = p.links.filter((linkEntry) => linkEntry.id !== entry.id); }))); item.append(link, actions); list.append(item); });
}
function renderMilestones(project) {
  const list = $('#milestone-list'); list.replaceChildren(); const milestones = project.milestones || []; $('#empty-milestones').hidden = milestones.length > 0;
  milestones.forEach((milestone, index) => { const item = document.createElement('li'); item.className = 'milestone-item'; const number = document.createElement('span'); number.className = 'milestone-number'; number.textContent = String(index + 1).padStart(2, '0'); const content = document.createElement('div'); content.className = 'milestone-main'; const title = document.createElement('strong'); title.textContent = milestone.name; content.append(title); if (milestone.date) { const date = document.createElement('small'); date.textContent = formatDate(milestone.date); content.append(date); } item.append(number, content);
    if (milestone.url && safeUrl(milestone.url)) { const link = document.createElement('a'); link.href = safeUrl(milestone.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open link'; item.append(link); } else { item.append(document.createElement('span')); }
    const actions = document.createElement('div'); actions.className = 'inline-actions'; actions.append(createAction('Edit', 'mini-remove', async () => { const name = prompt('Milestone:', milestone.name); if (name === null) return; const rawDate = prompt('Date (YYYY-MM-DD, optional):', milestone.date || ''); if (rawDate === null) return; const rawUrl = prompt('URL (optional):', milestone.url || ''); if (rawUrl === null) return; const url = rawUrl.trim() ? safeUrl(rawUrl.trim()) : ''; if (rawUrl.trim() && !url) { showNotice('Please enter a valid http or https URL.', true); return; } await updateProject((p) => { const target = p.milestones.find((entry) => entry.id === milestone.id); if (target) Object.assign(target, { name: name.trim() || target.name, date: rawDate.trim(), url }); }); })); actions.append(createAction('Remove', 'mini-remove', () => updateProject((p) => { p.milestones = p.milestones.filter((entry) => entry.id !== milestone.id); }))); item.append(actions); list.append(item); });
}
async function updateProject(mutator) {
  try { const project = await getProject(); if (!project) return; mutator(project); project.updatedAt = Date.now(); await saveProject(project); renderProjectDetails(project); await renderProjects(); }
  catch (error) { console.error(error); showNotice(`Could not save this update: ${error.message || 'storage error'}`, true); }
}
function prepareProjectForm(project = null) {
  projectForm.reset(); projectForm.dataset.editId = project?.id || '';
  readNamed(projectForm, 'name').value = project?.name || ''; readNamed(projectForm, 'startDate').value = project?.startDate || ''; readNamed(projectForm, 'endDate').value = project?.endDate || ''; readNamed(projectForm, 'status').value = project?.status || 'planning';
  $('#project-dialog-title').textContent = project ? 'Edit project' : 'Create project'; $('button[type="submit"]', projectForm).textContent = project ? 'Save changes' : 'Save project';
}
$('#open-create-project').addEventListener('click', () => { prepareProjectForm(); openDialog('project-dialog'); readNamed(projectForm, 'name').focus(); });
$('#edit-project').addEventListener('click', async () => { try { prepareProjectForm(await getProject()); openDialog('project-dialog'); readNamed(projectForm, 'name').focus(); } catch (error) { showNotice(error.message, true); } });
projectForm.addEventListener('submit', async (event) => {
  event.preventDefault(); const submit = $('button[type="submit"]', projectForm); submit.disabled = true;
  try {
    const values = readForm(projectForm); const name = String(values.name || '').trim(); if (!name) { readNamed(projectForm, 'name').focus(); return; }
    if (values.startDate && values.endDate && values.endDate < values.startDate) { readNamed(projectForm, 'endDate').setCustomValidity('End date must be on or after the start date.'); readNamed(projectForm, 'endDate').reportValidity(); readNamed(projectForm, 'endDate').setCustomValidity(''); return; }
    const editId = projectForm.dataset.editId; const existing = editId ? await getProject(editId) : null;
    const project = { ...(existing || {}), id: editId || id(), name, startDate: values.startDate || '', endDate: values.endDate || '', status: values.status || 'planning', team: existing?.team || [], details: existing?.details || '', modules: existing?.modules || [], defectReport: existing?.defectReport || '', links: existing?.links || [], milestones: existing?.milestones || [], createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() };
    await saveProject(project); closeDialog($('#project-dialog')); await renderProjects();
    if (editId) { renderProjectDetails(project); showNotice('Project updated.'); } else { await selectProject(project.id); showNotice('Project created.'); }
  } catch (error) { console.error(error); showNotice(`Project could not be saved: ${error.message || 'check browser storage settings and try again'}`, true); }
  finally { submit.disabled = false; }
});
$('#back-to-projects').addEventListener('click', async () => { activeProjectId = null; projectView.hidden = true; projectsView.hidden = false; history.replaceState(null, '', location.pathname + location.search); await renderProjects(); });
$('#grid-view').addEventListener('click', () => setView('grid')); $('#list-view').addEventListener('click', () => setView('list'));
$('#project-search').addEventListener('input', () => renderProjects()); $('#status-filter').addEventListener('change', () => renderProjects());
$('#delete-project').addEventListener('click', async () => {
  const project = await getProject(); if (!project || !confirm(`Delete “${project.name}” and its local project record? This cannot be undone.`)) return;
  try { await dbRequest(store('projects', 'readwrite').delete(project.id)); activeProjectId = null; projectView.hidden = true; projectsView.hidden = false; history.replaceState(null, '', location.pathname + location.search); await renderProjects(); showNotice('Project deleted from this browser.'); }
  catch (error) { showNotice(`Could not delete the project: ${error.message}`, true); }
});
$('#add-resource').addEventListener('click', () => { $('#resource-form').reset(); openDialog('resource-dialog'); readNamed($('#resource-form'), 'name').focus(); });
$('#resource-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = readNamed(event.currentTarget, 'name').value.trim(); if (!name) return; await updateProject((p) => { p.team ||= []; p.team.push({ id: id(), name }); }); closeDialog($('#resource-dialog')); event.currentTarget.reset(); showNotice('Team resource added.'); });
function openTextEditor(field) { textEditField = field; const title = field === 'details' ? 'Project details' : 'Defect report'; $('#text-dialog-title').textContent = title; $('#text-field-label').childNodes[0].textContent = title; readNamed($('#text-form'), 'text').value = activeProjectCache?.[field] || ''; openDialog('text-dialog'); }
let activeProjectCache = null;
$('#edit-details').addEventListener('click', async () => { activeProjectCache = await getProject(); openTextEditor('details'); });
$('#edit-defects').addEventListener('click', async () => { activeProjectCache = await getProject(); openTextEditor('defectReport'); });
$('#text-form').addEventListener('submit', async (event) => { event.preventDefault(); const text = readNamed(event.currentTarget, 'text').value.trim(); await updateProject((p) => { p[textEditField] = text; }); activeProjectCache = await getProject(); closeDialog($('#text-dialog')); showNotice(textEditField === 'details' ? 'Project details saved.' : 'Defect report saved.'); });
$('#add-module').addEventListener('click', () => { $('#module-form').reset(); openDialog('module-dialog'); readNamed($('#module-form'), 'name').focus(); });
$('#module-form').addEventListener('submit', async (event) => { event.preventDefault(); const values = readForm(event.currentTarget); const name = values.name.trim(); if (!name) return; const submodules = values.submodules.split('\n').map((part) => part.trim()).filter(Boolean); await updateProject((p) => { p.modules ||= []; p.modules.push({ id: id(), name, submodules }); }); closeDialog($('#module-dialog')); event.currentTarget.reset(); showNotice('Module added.'); });
$('#submodule-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = readNamed(event.currentTarget, 'name').value.trim(); if (!name || !pendingSubmoduleModuleId) return; await updateProject((p) => { const module = p.modules.find((entry) => entry.id === pendingSubmoduleModuleId); if (module) { module.submodules ||= []; module.submodules.push(name); } }); pendingSubmoduleModuleId = null; closeDialog($('#submodule-dialog')); event.currentTarget.reset(); showNotice('Submodule added.'); });
$('#add-link').addEventListener('click', () => { $('#link-form').reset(); openDialog('link-dialog'); readNamed($('#link-form'), 'label').focus(); });
$('#link-form').addEventListener('submit', async (event) => { event.preventDefault(); const values = readForm(event.currentTarget); const label = values.label.trim(); const url = safeUrl(values.url.trim()); if (!label || !url) { readNamed(event.currentTarget, 'url').setCustomValidity('Enter a valid http or https URL.'); readNamed(event.currentTarget, 'url').reportValidity(); readNamed(event.currentTarget, 'url').setCustomValidity(''); return; } await updateProject((p) => { p.links ||= []; p.links.push({ id: id(), label, url }); }); closeDialog($('#link-dialog')); event.currentTarget.reset(); showNotice('IMP link added.'); });
$('#add-milestone').addEventListener('click', () => { $('#milestone-form').reset(); openDialog('milestone-dialog'); readNamed($('#milestone-form'), 'name').focus(); });
$('#milestone-form').addEventListener('submit', async (event) => { event.preventDefault(); const values = readForm(event.currentTarget); const name = values.name.trim(); const url = values.url.trim() ? safeUrl(values.url.trim()) : ''; if (!name || (values.url.trim() && !url)) { if (values.url.trim() && !url) { readNamed(event.currentTarget, 'url').setCustomValidity('Enter a valid http or https URL.'); readNamed(event.currentTarget, 'url').reportValidity(); readNamed(event.currentTarget, 'url').setCustomValidity(''); } return; } await updateProject((p) => { p.milestones ||= []; p.milestones.push({ id: id(), name, date: values.date || '', url }); }); closeDialog($('#milestone-dialog')); event.currentTarget.reset(); showNotice('Milestone added.'); });
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(document.getElementById(button.dataset.close))));
$('#export-projects').addEventListener('click', async () => { try { const data = await getProjects(); const blob = new Blob([JSON.stringify({ format: 'project-hub-backup', version: 1, exportedAt: new Date().toISOString(), projects: data }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `project-hub-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); showNotice('Project backup exported.'); } catch (error) { showNotice(`Export failed: ${error.message}`, true); } });
$('#import-projects').addEventListener('change', async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const backup = JSON.parse(await file.text()); const projects = Array.isArray(backup) ? backup : backup.projects; if (!Array.isArray(projects)) throw new Error('This file does not contain a project backup.'); const existing = await getProjects(); const known = new Set(existing.map((project) => project.id)); let imported = 0; for (const source of projects) { if (!source || typeof source.name !== 'string' || !source.name.trim()) continue; const project = { ...source, id: source.id && !known.has(source.id) ? source.id : id(), name: source.name.trim(), team: Array.isArray(source.team) ? source.team : [], modules: Array.isArray(source.modules) ? source.modules : [], links: Array.isArray(source.links) ? source.links : [], milestones: Array.isArray(source.milestones) ? source.milestones : [], createdAt: source.createdAt || Date.now(), updatedAt: Date.now() }; await saveProject(project); known.add(project.id); imported += 1; } await renderProjects(); showNotice(`${imported} project${imported === 1 ? '' : 's'} imported.`); } catch (error) { showNotice(`Import failed: ${error.message}`, true); } finally { event.target.value = ''; } });
window.addEventListener('hashchange', async () => { if (!db || !location.hash.startsWith('#project-')) return; const projectId = decodeURIComponent(location.hash.slice('#project-'.length)); const project = await getProject(projectId); if (project) { activeProjectId = projectId; projectsView.hidden = true; projectView.hidden = false; renderProjectDetails(project); } });
(async function initialize() {
  try { db = await openDatabase(); let view = 'grid'; try { view = localStorage.getItem('project-layout') === 'list' ? 'list' : 'grid'; } catch { /* optional */ } setView(view); await renderProjects(); if (location.hash.startsWith('#project-')) { const projectId = decodeURIComponent(location.hash.slice('#project-'.length)); await selectProject(projectId); } }
  catch (error) { console.error('Project Hub startup failed:', error); showNotice(`Project Hub could not start: ${error.message || 'check browser storage permissions and reload the page'}`, true); }
})();
